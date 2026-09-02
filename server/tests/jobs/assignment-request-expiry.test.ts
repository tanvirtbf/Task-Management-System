import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeList,
    makeSpace,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    notifications,
    taskAssignees,
    taskAssignmentRequestEvents,
    taskAssignmentRequests,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";

/**
 * Tests for `POST /api/v1/jobs/assignment-request-expiry` (Team-access P8, Q6).
 *
 * P5 wrote these: `assignmentRequestExpiry` was the ONLY job in the system with
 * no test of any kind, and it is the one that closes a cross-team negotiation
 * nobody answered. Its HTTP trigger was untested too (KI-34), so driving the
 * job through the route covers both.
 *
 * Private DB `tms_jobs_test`, per-test DELETE reset. 🤖 internal-token auth.
 *
 * Rows are seeded directly rather than negotiated through the API: the job's
 * contract is "a pending row whose `expires_at` has passed", and reaching that
 * state through the gate would need the whole cross-team RBAC setup to say
 * anything about a janitor that never consults it.
 */

const URL = "/api/v1/jobs/assignment-request-expiry";
const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";
const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60 * 1000);
const minutesAhead = (n: number): Date => new Date(Date.now() + n * 60 * 1000);

const post = async (qs = "") =>
    (await oneOff())
        .post(`${URL}${qs}`)
        .set("X-Internal-Token", token())
        .send({});

type Status = "pending" | "accepted" | "declined" | "expired" | "cancelled";

/** One workspace with the rows a request needs to point at. */
const scene = async () => {
    const ws = await makeWorkspace();
    const requester = await makeUser({ workspaceId: ws.id });
    const target = await makeUser({ workspaceId: ws.id });
    const space = await makeSpace({
        workspaceId: ws.id,
        createdBy: requester.id,
    });
    const list = await makeList({
        workspaceId: ws.id,
        spaceId: space.id,
        createdBy: requester.id,
    });
    const task = await makeTask({
        workspaceId: ws.id,
        listId: list.id,
        createdBy: requester.id,
        name: "Shoot the Eid campaign",
    });
    return { ws, requester, target, space, task };
};

const seedRequest = async (input: {
    workspaceId: string;
    spaceId: string;
    taskId: string;
    targetUserId: string;
    requestedBy: string;
    expiresAt: Date;
    status?: Status;
}): Promise<string> => {
    const id = fakeId("areq");
    const now = new Date();
    await getDb()
        .insert(taskAssignmentRequests)
        .values({
            id,
            workspaceId: input.workspaceId,
            spaceId: input.spaceId,
            taskId: input.taskId,
            targetUserId: input.targetUserId,
            requestedBy: input.requestedBy,
            status: input.status ?? "pending",
            expiresAt: input.expiresAt,
            createdAt: now,
            updatedAt: now,
        });
    return id;
};

const requestById = async (id: string) =>
    (
        await getDb()
            .select()
            .from(taskAssignmentRequests)
            .where(eq(taskAssignmentRequests.id, id))
    )[0];

const eventsFor = async (requestId: string) =>
    getDb()
        .select()
        .from(taskAssignmentRequestEvents)
        .where(eq(taskAssignmentRequestEvents.requestId, requestId));

const notifsFor = async (userId: string) =>
    getDb()
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId));

describe("POST /api/v1/jobs/assignment-request-expiry", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("expires a lapsed pending request and leaves a future one alone", async () => {
            const s = await scene();
            // `uq_tar_one_pending` allows only ONE pending request per
            // (task, target), so the second one needs a task of its own.
            const other = await makeTask({
                workspaceId: s.ws.id,
                listId: s.task.listId,
                createdBy: s.requester.id,
                name: "Restock the serum shelf",
            });
            const lapsed = await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAgo(1),
            });
            const fresh = await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: other.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAhead(60),
            });

            const res = await post();

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.expired).toBe(1);
            expect(res.body.processed).toBe(1);

            expect((await requestById(lapsed)).status).toBe("expired");
            expect((await requestById(fresh)).status).toBe("pending");
        });

        it("records the decision as the SYSTEM — decided_by stays NULL", async () => {
            const s = await scene();
            const id = await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAgo(1),
            });

            await post();

            const row = await requestById(id);
            expect(row.status).toBe("expired");
            expect(row.decidedBy).toBeNull();
            expect(row.decidedAt).not.toBeNull();
        });

        it("appends one `expired` ledger row with a NULL actor", async () => {
            const s = await scene();
            const id = await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAgo(1),
            });

            await post();

            const events = await eventsFor(id);
            expect(events).toHaveLength(1);
            expect(events[0].action).toBe("expired");
            expect(events[0].actorId).toBeNull();
        });

        it("tells the REQUESTER, not the person who was asked", async () => {
            const s = await scene();
            await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAgo(1),
            });

            await post();

            const toRequester = await notifsFor(s.requester.id);
            expect(toRequester).toHaveLength(1);
            expect(toRequester[0].type).toBe("assignment_request_decided");
            expect(toRequester[0].title).toContain("expired");
            // The name is what makes the bell readable; a bare id is not.
            expect(toRequester[0].title).toContain("Shoot the Eid campaign");
            expect(toRequester[0].actorId).toBeNull();

            expect(await notifsFor(s.target.id)).toHaveLength(0);
        });

        it("does NOT assign the task — an unanswered ask leaves it unassigned", async () => {
            const s = await scene();
            await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAgo(1),
            });

            await post();

            const assignees = await getDb()
                .select()
                .from(taskAssignees)
                .where(eq(taskAssignees.taskId, s.task.id));
            expect(assignees).toHaveLength(0);
        });

        it("returns 0 when nothing has lapsed", async () => {
            const s = await scene();
            await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAhead(30),
            });

            const res = await post();

            expect(res.body.expired).toBe(0);
            expect(res.body.processed).toBe(0);
        });
    });

    // ─── b. Only pending rows are claimable ─────────────────────────────────
    describe("Already-decided requests", () => {
        it.each(["accepted", "declined", "cancelled", "expired"] as const)(
            "leaves a %s request alone even when it is past expires_at",
            async (status) => {
                const s = await scene();
                const id = await seedRequest({
                    workspaceId: s.ws.id,
                    spaceId: s.space.id,
                    taskId: s.task.id,
                    targetUserId: s.target.id,
                    requestedBy: s.requester.id,
                    expiresAt: minutesAgo(120),
                    status,
                });

                const res = await post();

                expect(res.body.expired).toBe(0);
                expect((await requestById(id)).status).toBe(status);
                expect(await eventsFor(id)).toHaveLength(0);
                expect(await notifsFor(s.requester.id)).toHaveLength(0);
            },
        );
    });

    // ─── c. dry_run ─────────────────────────────────────────────────────────
    describe("dry_run", () => {
        it("counts what it would expire and writes nothing", async () => {
            const s = await scene();
            const id = await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAgo(1),
            });

            const res = await post("?dry_run=true");

            expect(res.body.dry_run).toBe(true);
            expect(res.body.wouldExpire).toBe(1);
            expect((await requestById(id)).status).toBe("pending");
            expect(await eventsFor(id)).toHaveLength(0);
            expect(await notifsFor(s.requester.id)).toHaveLength(0);
        });
    });

    // ─── d. Idempotency ─────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("a second run expires nothing and does not re-notify", async () => {
            const s = await scene();
            await seedRequest({
                workspaceId: s.ws.id,
                spaceId: s.space.id,
                taskId: s.task.id,
                targetUserId: s.target.id,
                requestedBy: s.requester.id,
                expiresAt: minutesAgo(1),
            });

            const first = await post();
            const second = await post();

            expect(first.body.expired).toBe(1);
            expect(second.body.expired).toBe(0);
            // The requester is told once, not once per tick.
            expect(await notifsFor(s.requester.id)).toHaveLength(1);
        });
    });

    // ─── e. The janitor is workspace-blind, deliberately ────────────────────
    describe("Across workspaces", () => {
        it("expires lapsed requests in every workspace in one run", async () => {
            const a = await scene();
            const b = await scene();
            const inA = await seedRequest({
                workspaceId: a.ws.id,
                spaceId: a.space.id,
                taskId: a.task.id,
                targetUserId: a.target.id,
                requestedBy: a.requester.id,
                expiresAt: minutesAgo(1),
            });
            const inB = await seedRequest({
                workspaceId: b.ws.id,
                spaceId: b.space.id,
                taskId: b.task.id,
                targetUserId: b.target.id,
                requestedBy: b.requester.id,
                expiresAt: minutesAgo(1),
            });

            const res = await post();

            expect(res.body.expired).toBe(2);
            expect((await requestById(inA)).status).toBe("expired");
            expect((await requestById(inB)).status).toBe("expired");
            // Each requester hears about their own, and only their own.
            expect(await notifsFor(a.requester.id)).toHaveLength(1);
            expect(await notifsFor(b.requester.id)).toHaveLength(1);
        });
    });

    // ─── f. Auth ────────────────────────────────────────────────────────────
    describe("Auth", () => {
        it("401 auth.unauthorized without the internal token", async () => {
            const res = await (await oneOff()).post(URL).send({});
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.unauthorized");
        });
    });

    // ─── g. Cross-cutting ───────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const res = await post();
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
