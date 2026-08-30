import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeTask,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    taskWatchers,
    taskActivity,
    notifications,
    tasks,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import { fakeId } from "../../src/utils";

/**
 * Tests for `POST /api/v1/tasks/:id/watchers/self` (§11 #3).
 *
 * Built endpoint that had no test — its Prompt-4 sign-off. A self-subscription:
 * 204, no task_activity, no notification, no ETag bump. Runs on the isolated
 * `tms_membership_test` DB. ⚠️ ONE FILE PER JEST PROCESS.
 */
jest.setTimeout(30000);

const PAST = new Date("2020-01-01T00:00:00.000Z");
const watchPath = (taskId: string) => `/api/v1/tasks/${taskId}/watchers/self`;

const getWatchers = async (taskId: string) =>
    (
        await getDb()
            .select({ userId: taskWatchers.userId })
            .from(taskWatchers)
            .where(eq(taskWatchers.taskId, taskId))
    ).map((r) => r.userId);
const countActivity = async (taskId: string) =>
    (
        await getDb()
            .select({ id: taskActivity.id })
            .from(taskActivity)
            .where(eq(taskActivity.taskId, taskId))
    ).length;
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
describe("POST /api/v1/tasks/:id/watchers/self", () => {
    describe("Happy path", () => {
        it("subscribes the caller as a watcher and returns 204", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(watchPath(t.id));

            expect(res.status).toBe(204);
            expect(await getWatchers(t.id)).toEqual([u.id]);
        });

        it("writes NO task_activity, fires NO notification, and does NOT bump updated_at", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await setUpdatedAtPast(t.id);
            const client = await makeLoggedInClient(u);

            const notifBefore = await countNotifications();
            await client.post(watchPath(t.id));

            expect(await countActivity(t.id)).toBe(0);
            expect(await countNotifications()).toBe(notifBefore);
            expect((await getUpdatedAt(t.id))!.getTime()).toBe(PAST.getTime());
        });

        it("carries an X-Request-Id header on the 204", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(watchPath(t.id));
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    describe("Idempotency", () => {
        it("re-watching is a 204 no-op — exactly one watcher row", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const r1 = await client.post(watchPath(t.id));
            const r2 = await client.post(watchPath(t.id));

            expect(r1.status).toBe(204);
            expect(r2.status).toBe(204);
            expect(await getWatchers(t.id)).toEqual([u.id]);
        });
    });

    describe("Self-only", () => {
        it("ignores a body and always watches the caller (req.auth.sub), never another user", async () => {
            const u = await makeUser({ role: "member" });
            const other = await makeUser({ workspaceId: u.workspaceId });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            await client.post(watchPath(t.id)).send({ user_id: other.id });

            const watchers = await getWatchers(t.id);
            expect(watchers).toEqual([u.id]);
            expect(watchers).not.toContain(other.id);
        });
    });

    describe("Validation", () => {
        it("returns 422 for a task id longer than 64 chars", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(watchPath("x".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("Authentication", () => {
        it("returns 401 auth.missing_token without a token", async () => {
            const http = await oneOff();
            const res = await http.post(watchPath("t-x"));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a non-JWT Bearer", async () => {
            const http = await oneOff();
            const res = await http
                .post(watchPath("t-x"))
                .set("Authorization", "Bearer not-a-jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired access token", async () => {
            const u = await makeUser({ role: "member" });
            const expired = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                algorithm: "HS256",
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .post(watchPath("t-x"))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    describe("Authorization (🔐 any member — no role gate)", () => {
        for (const role of ["owner", "admin", "member", "guest"] as const) {
            it(`allows a ${role} to watch (204)`, async () => {
                const u = await makeUser({ role });
                const t = await makeTask({
                    workspaceId: u.workspaceId,
                    createdBy: u.id,
                });
                const client = await makeLoggedInClient(u);

                const res = await client.post(watchPath(t.id));
                expect(res.status).toBe(204);
            });
        }
    });

    describe("Resource lifecycle", () => {
        it("returns 404 task.not_found for an absent task", async () => {
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);

            const res = await client.post(watchPath(fakeId("t")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("returns 409 task.archived for an archived task", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
                archivedAt: new Date(),
            });
            const client = await makeLoggedInClient(u);

            const res = await client.post(watchPath(t.id));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
        });
    });

    describe("Tenant isolation", () => {
        it("returns 404 when the task is in another workspace and creates no watch", async () => {
            const ua = await makeUser({ role: "member" });
            const ub = await makeUser({ role: "member" });
            const aTask = await makeTask({
                workspaceId: ua.workspaceId,
                createdBy: ua.id,
            });

            const clientB = await makeLoggedInClient(ub);
            const res = await clientB.post(watchPath(aTask.id));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            expect(await getWatchers(aTask.id)).toHaveLength(0);
        });
    });

    describe("Concurrency", () => {
        it("10 parallel self-watches leave exactly one watcher row", async () => {
            const u = await makeUser({ role: "member" });
            const t = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 10 }, () => client.post(watchPath(t.id))),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await getWatchers(t.id)).toEqual([u.id]);
        });
    });
});
