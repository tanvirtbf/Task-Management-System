import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import {
    notifications,
    taskActivity,
    taskReviews,
    tasks,
} from "../../src/db/schema";
import { oneOff } from "../test-utils/app";
import { makeLoggedInClient, makeUser } from "../test-utils/factories";
import {
    makeDeptList,
    makeDoneTask,
    makeSpaceWithHead,
} from "./helpers";
import { fakeId } from "../../src/utils";

/**
 * Dept Review V1 — P8: `POST /api/v1/tasks/:id/review` (A-4).
 *
 * Covers: happy paths + the full atomic side-effect set (ledger row, denorm
 * trio, task_activity, assignee notifications with self-skip + guest-include),
 * the repeat-review undo chain, custom_id addressing (C5-regression-proof:
 * the denorm must land on the RESOLVED task), the 409/404/403 matrix, note
 * validation, and the updated_at (ETag) bump.
 *
 * NOTE: the reopen-vs-review RACE invariant (denorm cleared when a task
 * leaves done) is completed by P9's reset — the under-lock re-check here is
 * exercised on every request; the concurrency invariant test lands with P9.
 */

const reviewPath = (idOrKey: string) => `/api/v1/tasks/${idOrKey}/review`;

const REVIEW_KEYS = [
    "id",
    "task_id",
    "space_id",
    "status",
    "note",
    "reviewer_id",
    "created_at",
].sort();

const db = () => getDb();

const fetchTaskRow = async (taskId: string) => {
    const [row] = await db()
        .select({
            reviewStatus: tasks.reviewStatus,
            reviewedAt: tasks.reviewedAt,
            reviewedBy: tasks.reviewedBy,
            updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
    return row;
};

const fetchReviews = async (taskId: string) =>
    db()
        .select()
        .from(taskReviews)
        .where(eq(taskReviews.taskId, taskId))
        .orderBy(taskReviews.internalId);

const fetchActivity = async (taskId: string) =>
    db()
        .select({
            action: taskActivity.action,
            actorId: taskActivity.actorId,
            context: taskActivity.context,
        })
        .from(taskActivity)
        .where(eq(taskActivity.taskId, taskId));

const fetchNotifications = async () =>
    db()
        .select({
            userId: notifications.userId,
            type: notifications.type,
            entityType: notifications.entityType,
            entityId: notifications.entityId,
            actorId: notifications.actorId,
            title: notifications.title,
            body: notifications.body,
        })
        .from(notifications);

/** Owner + head(member) + one assignee + a done task in the head's space. */
const seed = async (opts: { assigneeRole?: "member" | "guest" } = {}) => {
    const owner = await makeUser({ role: "owner" });
    const head = await makeUser({
        workspaceId: owner.workspaceId,
        role: "member",
    });
    const assignee = await makeUser({
        workspaceId: owner.workspaceId,
        role: opts.assigneeRole ?? "member",
    });
    const sp = await makeSpaceWithHead({
        workspaceId: owner.workspaceId,
        headUserId: head.id,
        createdBy: owner.id,
    });
    const dl = await makeDeptList({
        workspaceId: owner.workspaceId,
        spaceId: sp.id,
        createdBy: owner.id,
    });
    const task = await makeDoneTask({
        workspaceId: owner.workspaceId,
        listId: dl.listId,
        doneStatusId: dl.doneStatusId,
        assigneeIds: [assignee.id],
        createdBy: owner.id,
    });
    const headClient = await makeLoggedInClient({ ...head, role: "member" });
    return { owner, head, assignee, sp, dl, task, headClient };
};

describe("POST /api/v1/tasks/:id/review (Dept Review V1)", () => {
    describe("Happy path", () => {
        it("head approves: 201 wire review + denorm trio + activity + assignee notification", async () => {
            const { head, assignee, sp, task, headClient } = await seed();

            const res = await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved", note: "clean work" });

            expect(res.status).toBe(201);
            expect(Object.keys(res.body).sort()).toEqual(REVIEW_KEYS);
            expect(res.body).toMatchObject({
                task_id: task.id,
                space_id: sp.id,
                status: "approved",
                note: "clean work",
                reviewer_id: head.id,
            });
            expect(res.body.id).toMatch(/^rev-/);

            const row = await fetchTaskRow(task.id);
            expect(row.reviewStatus).toBe("approved");
            expect(row.reviewedBy).toBe(head.id);
            expect(row.reviewedAt).not.toBeNull();

            const acts = await fetchActivity(task.id);
            const reviewActs = acts.filter(
                (a) => a.action === "task_reviewed",
            );
            expect(reviewActs).toHaveLength(1);
            expect(reviewActs[0].actorId).toBe(head.id);
            expect(reviewActs[0].context).toMatchObject({
                review_id: res.body.id,
                status: "approved",
                space_id: sp.id,
            });

            const ntfs = await fetchNotifications();
            expect(ntfs).toHaveLength(1);
            expect(ntfs[0]).toMatchObject({
                userId: assignee.id,
                type: "task_reviewed",
                entityType: "task",
                entityId: task.id,
                actorId: head.id,
                body: "clean work",
            });
            expect(ntfs[0].title).toContain("Task approved");
        });

        it("flag with a note; owner and admin may also review", async () => {
            const { owner, task } = await seed();
            const ownerClient = await makeLoggedInClient({
                ...owner,
                role: "owner",
            });

            const res = await ownerClient
                .post(reviewPath(task.id))
                .send({ status: "flagged", note: "missing screenshots" });
            expect(res.status).toBe(201);
            expect(res.body.status).toBe("flagged");

            const admin = await makeUser({
                workspaceId: owner.workspaceId,
                role: "admin",
            });
            const adminClient = await makeLoggedInClient({
                ...admin,
                role: "admin",
            });
            const res2 = await adminClient
                .post(reviewPath(task.id))
                .send({ status: "approved" });
            expect(res2.status).toBe(201);
        });

        it("repeat reviews = the undo chain: approve→flag→approve keeps 3 ledger rows, denorm = latest", async () => {
            const { head, task, headClient } = await seed();

            await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved" });
            await headClient
                .post(reviewPath(task.id))
                .send({ status: "flagged", note: "wait — check totals" });
            const last = await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved" });
            expect(last.status).toBe(201);

            const rows = await fetchReviews(task.id);
            expect(rows.map((r) => r.status)).toEqual([
                "approved",
                "flagged",
                "approved",
            ]);
            expect(rows[1].note).toBe("wait — check totals");

            const row = await fetchTaskRow(task.id);
            expect(row.reviewStatus).toBe("approved");
            expect(row.reviewedBy).toBe(head.id);
        });

        it("custom_id addressing resolves AND writes to the resolved task (C5 regression proof)", async () => {
            const { task, headClient } = await seed();
            await db()
                .update(tasks)
                .set({ customId: "REV-77" })
                .where(eq(tasks.id, task.id));

            const res = await headClient
                .post(reviewPath("REV-77"))
                .send({ status: "flagged" });

            expect(res.status).toBe(201);
            expect(res.body.task_id).toBe(task.id);
            const row = await fetchTaskRow(task.id);
            expect(row.reviewStatus).toBe("flagged"); // denorm landed — not a no-op
        });

        it("bumps tasks.updated_at (the wire ETag source)", async () => {
            const { task, headClient } = await seed();
            const before = (await fetchTaskRow(task.id)).updatedAt;

            await new Promise((r) => setTimeout(r, 1100)); // second-granular column
            await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved" });

            const after = (await fetchTaskRow(task.id)).updatedAt;
            expect(after.getTime()).toBeGreaterThan(before.getTime());
        });

        it("empty / whitespace note normalises to null; absent note is null", async () => {
            const { task, headClient } = await seed();

            const a = await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved", note: "   " });
            expect(a.status).toBe(201);
            expect(a.body.note).toBeNull();

            const b = await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved" });
            expect(b.body.note).toBeNull();

            const c = await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved", note: null });
            expect(c.status).toBe(201);
            expect(c.body.note).toBeNull();
        });

        it("self-review is allowed (D-6) but never self-notifies", async () => {
            const { head, sp, dl, headClient, owner } = await seed();
            const selfTask = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                assigneeIds: [head.id], // the head's own task
                createdBy: owner.id,
            });

            const res = await headClient
                .post(reviewPath(selfTask.id))
                .send({ status: "approved" });

            expect(res.status).toBe(201);
            expect(res.body.space_id).toBe(sp.id);
            expect(await fetchNotifications()).toHaveLength(0); // self-skip
        });

        it("guest assignees DO receive the notification (D-5, consistent with existing fanouts)", async () => {
            const { assignee, task, headClient } = await seed({
                assigneeRole: "guest",
            });

            await headClient
                .post(reviewPath(task.id))
                .send({ status: "flagged", note: "redo the export" });

            const ntfs = await fetchNotifications();
            expect(ntfs).toHaveLength(1);
            expect(ntfs[0].userId).toBe(assignee.id);
        });
    });

    describe("409 conflicts", () => {
        it("rejects a task that is not in a done status (review.not_completed)", async () => {
            const { owner, sp, dl, headClient } = await seed();
            const openTask = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.activeStatusId, // ACTIVE-group status
                createdBy: owner.id,
            });
            // makeDoneTask stamped completedAt — the LIVE status group is the
            // authority (D-4), so this must still 409.
            void sp;

            const res = await headClient
                .post(reviewPath(openTask.id))
                .send({ status: "approved" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("review.not_completed");
            expect(await fetchReviews(openTask.id)).toHaveLength(0);
            expect((await fetchTaskRow(openTask.id)).reviewStatus).toBeNull();
        });

        it("rejects an archived task (task.archived)", async () => {
            const { owner, dl, headClient } = await seed();
            const archived = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                createdBy: owner.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });

            const res = await headClient
                .post(reviewPath(archived.id))
                .send({ status: "approved" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });

        it("rejects a task whose space is archived (space.archived, via the guard)", async () => {
            const owner = await makeUser({ role: "owner" });
            const head = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            const sp = await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                headUserId: head.id,
                createdBy: owner.id,
                archivedAt: new Date("2026-01-02T03:04:05.000Z"),
            });
            const dl = await makeDeptList({
                workspaceId: owner.workspaceId,
                spaceId: sp.id,
                createdBy: owner.id,
            });
            const task = await makeDoneTask({
                workspaceId: owner.workspaceId,
                listId: dl.listId,
                doneStatusId: dl.doneStatusId,
                createdBy: owner.id,
            });
            const headClient = await makeLoggedInClient({
                ...head,
                role: "member",
            });

            const res = await headClient
                .post(reviewPath(task.id))
                .send({ status: "approved" });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("space.archived");
        });
    });

    describe("404 / 403 matrix", () => {
        it("404 task.not_found for an unknown id and for another workspace's task", async () => {
            const { headClient } = await seed();
            const foreign = await seed(); // fresh workspace with its own task

            const unknown = await headClient
                .post(reviewPath(fakeId("t")))
                .send({ status: "approved" });
            expect(unknown.status).toBe(404);
            expect(unknown.body.error.code).toBe("task.not_found");

            const cross = await headClient
                .post(reviewPath(foreign.task.id))
                .send({ status: "approved" });
            expect(cross.status).toBe(404);
            expect(cross.body.error.code).toBe("task.not_found");
        });

        it("403 review.not_head for a non-head member, a guest, and another space's head", async () => {
            const { owner, task } = await seed();

            const plainMember = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            const guest = await makeUser({
                workspaceId: owner.workspaceId,
                role: "guest",
            });
            const otherHead = await makeUser({
                workspaceId: owner.workspaceId,
                role: "member",
            });
            await makeSpaceWithHead({
                workspaceId: owner.workspaceId,
                headUserId: otherHead.id,
                createdBy: owner.id,
            });

            for (const u of [plainMember, guest, otherHead]) {
                const client = await makeLoggedInClient({
                    ...u,
                    role: u.role,
                });
                const res = await client
                    .post(reviewPath(task.id))
                    .send({ status: "approved" });
                expect(res.status).toBe(403);
                expect(res.body.error.code).toBe("review.not_head");
            }
            expect((await fetchTaskRow(task.id)).reviewStatus).toBeNull();
        });

        it("401 without a token", async () => {
            const http = await oneOff();
            const res = await http
                .post(reviewPath("t-anything"))
                .send({ status: "approved" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });
    });

    describe("Validation — 422 validation.failed", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["a bad status value", { status: "meh" }],
            ["a missing status", {}],
            ["a non-string status", { status: 7 }],
            ["an over-long note", { status: "approved", note: "x".repeat(501) }],
            ["a non-string note", { status: "approved", note: 42 }],
        ];
        for (const [label, body] of cases) {
            it(`rejects ${label}`, async () => {
                const { task, headClient } = await seed();
                const res = await headClient.post(reviewPath(task.id)).send(body);
                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(await fetchReviews(task.id)).toHaveLength(0);
            });
        }

        it("accepts a note at exactly 500 chars", async () => {
            const { task, headClient } = await seed();
            const res = await headClient
                .post(reviewPath(task.id))
                .send({ status: "flagged", note: "y".repeat(500) });
            expect(res.status).toBe(201);
            expect(res.body.note).toHaveLength(500);
        });
    });
});
