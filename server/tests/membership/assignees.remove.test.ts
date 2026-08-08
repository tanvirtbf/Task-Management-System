import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeTask,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    taskAssignees,
    taskWatchers,
    taskActivity,
    notifications,
    tasks,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `DELETE /api/v1/tasks/:id/assignees/:userId` (§11 #2).
 *
 * Built endpoint that had no test — this is its Prompt-4 sign-off. Runs on the
 * isolated `tms_membership_test` DB (jest.membership.config.cjs). ⚠️ ONE FILE
 * PER JEST PROCESS (see setup-each-membership.ts).
 */
jest.setTimeout(30000);

const PAST = new Date("2020-01-01T00:00:00.000Z");
const assigneePath = (taskId: string, userId: string) =>
    `/api/v1/tasks/${taskId}/assignees/${userId}`;

// ─── helpers ─────────────────────────────────────────────────────────────────
const seedAssignee = async (taskId: string, userId: string) => {
    await getDb()
        .insert(taskAssignees)
        .values({ taskId, userId, assignedBy: userId });
};
const seedWatcher = async (taskId: string, userId: string) => {
    await getDb().insert(taskWatchers).values({ taskId, userId });
};
const getAssignees = async (taskId: string) =>
    (
        await getDb()
            .select({ userId: taskAssignees.userId })
            .from(taskAssignees)
            .where(eq(taskAssignees.taskId, taskId))
    ).map((r) => r.userId);
const getWatchers = async (taskId: string) =>
    (
        await getDb()
            .select({ userId: taskWatchers.userId })
            .from(taskWatchers)
            .where(eq(taskWatchers.taskId, taskId))
    ).map((r) => r.userId);
const getActivity = async (taskId: string) =>
    getDb()
        .select({
            action: taskActivity.action,
            actorId: taskActivity.actorId,
            context: taskActivity.context,
        })
        .from(taskActivity)
        .where(eq(taskActivity.taskId, taskId));
const countNotifications = async () =>
    (await getDb().select({ id: notifications.id }).from(notifications)).length;
const setUpdatedAtPast = async (taskId: string) => {
    await getDb()
        .update(tasks)
        .set({ updatedAt: PAST })
        .where(eq(tasks.id, taskId));
};
const getUpdatedAt = async (taskId: string) => {
    const [row] = await getDb()
        .select({ updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row?.updatedAt ?? null;
};
const signAccess = (
    user: { id: string; workspaceId: string; role: string },
    secret: string,
    opts: jwt.SignOptions = { algorithm: "HS256", expiresIn: "15m" },
) =>
    jwt.sign(
        {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
            id: fakeId("ses"),
        },
        secret,
        opts,
    );

// ════════════════════════════════════════════════════════════════════════════
describe("DELETE /api/v1/tasks/:id/assignees/:userId", () => {
    describe("Happy path", () => {
        it("removes an assignee, returns 204, writes an assignee_removed activity row and bumps updated_at", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAssignee(t.id, u.id);
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(t.id, u.id));

            expect(res.status).toBe(204);
            expect(await getAssignees(t.id)).not.toContain(u.id);

            const acts = await getActivity(t.id);
            expect(acts).toHaveLength(1);
            expect(acts[0]).toMatchObject({
                action: "assignee_removed",
                actorId: u.id,
            });
            expect((acts[0].context as { user_id?: string }).user_id).toBe(
                u.id,
            );

            expect((await getUpdatedAt(t.id))!.getTime()).toBeGreaterThan(
                PAST.getTime(),
            );
        });

        it("fires NO notification and leaves the watcher row intact", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAssignee(t.id, u.id);
            await seedWatcher(t.id, u.id); // auto-watch from a prior assign
            const client = await makeLoggedInClient(u);

            const before = await countNotifications();
            await client.delete(assigneePath(t.id, u.id));

            expect(await countNotifications()).toBe(before);
            expect(await getWatchers(t.id)).toContain(u.id);
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAssignee(t.id, u.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(t.id, u.id));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    describe("Idempotency", () => {
        it("removing a user who is not assigned is a 204 no-op (no activity, no bump)", async () => {
            const u = await makeUser({ role: "admin" });
            const other = await makeUser({ workspaceId: u.workspaceId });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(t.id, other.id));

            expect(res.status).toBe(204);
            expect(await getActivity(t.id)).toHaveLength(0);
            expect((await getUpdatedAt(t.id))!.getTime()).toBe(PAST.getTime());
        });

        it("a second delete of the same assignee is a 204 no-op (exactly one activity row total)", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAssignee(t.id, u.id);
            const client = await makeLoggedInClient(u);

            const r1 = await client.delete(assigneePath(t.id, u.id));
            const r2 = await client.delete(assigneePath(t.id, u.id));

            expect(r1.status).toBe(204);
            expect(r2.status).toBe(204);
            expect(await getActivity(t.id)).toHaveLength(1);
        });

        it("removing an unknown/foreign userId is a 204 no-op (never an oracle)", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(t.id, fakeId("u")));
            expect(res.status).toBe(204);
        });
    });

    describe("Validation", () => {
        it("returns 422 for a task id longer than 64 chars", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath("x".repeat(65), u.id));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 for a userId longer than 64 chars", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(t.id, "x".repeat(65)));
            expect(res.status).toBe(422);
        });
    });

    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.delete(assigneePath("t-x", "u-x"));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .delete(assigneePath("t-x", "u-x"))
                .set("Authorization", "Bearer not-a-jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser({ role: "admin" });
            const expired = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                algorithm: "HS256",
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .delete(assigneePath("t-x", "u-x"))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Authorization (task.assign — every internal role holds it)", () => {
        for (const role of ["owner", "admin", "member"] as const) {
            it(`allows a ${role} to remove an assignee (204)`, async () => {
                const u = await makeUser({ role });
                const t = await makeTask({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                await seedAssignee(t.id, u.id);
                const client = await makeLoggedInClient(u);

                const res = await client.delete(assigneePath(t.id, u.id));
                expect(res.status).toBe(204);
            });
        }

        // F28 (ISS-094, D12.1): the seeded Guest role held `task.assign` at
        // scope=all — pre-RBAC, any authenticated user could re-staff any task.
        // Guest is a read-and-comment persona now; the route's gate makes this
        // 403. See tests/rbac/system-roles.test.ts for the full revocation.
        it("REFUSES a guest (403) — task.assign is no longer a guest grant", async () => {
            const u = await makeUser({ role: "guest" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAssignee(t.id, u.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(t.id, u.id));
            expect(res.status).toBe(403);
        });
    });

    describe("Resource lifecycle", () => {
        it("returns 404 task.not_found for an absent task", async () => {
            const u = await makeUser({ role: "admin" });
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(fakeId("t"), u.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 409 task.archived for an archived task", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            await seedAssignee(t.id, u.id);
            const client = await makeLoggedInClient(u);

            const res = await client.delete(assigneePath(t.id, u.id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });
    });

    describe("Tenant isolation", () => {
        it("returns 404 (not 403/204) when the task is in another workspace", async () => {
            const ua = await makeUser({ role: "admin" });
            const ub = await makeUser({ role: "admin" });
            const aTask = await makeTask({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });
            await seedAssignee(aTask.id, ua.id);

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.delete(assigneePath(aTask.id, ua.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            // The assignment is untouched.
            expect(await getAssignees(aTask.id)).toContain(ua.id);
        });
    });

    describe("Concurrency", () => {
        it("10 parallel deletes of the same assignee write exactly one activity row", async () => {
            const u = await makeUser({ role: "admin" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAssignee(t.id, u.id);
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    client.delete(assigneePath(t.id, u.id)),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await getActivity(t.id)).toHaveLength(1);
            expect(await getAssignees(t.id)).not.toContain(u.id);
        });
    });
});
