import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeList,
    makeStatus,
    makeTaskType,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { tasks, taskActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for §10 #6 archive / #7 unarchive / #8 soft-delete / #9 hard-delete.
 * All addressed by `POST /tasks/:id/archive|unarchive` and `DELETE /tasks/:id`
 * (`?hard=true` → 👑). N/A: pagination, body validation (no body).
 */

jest.setTimeout(30_000);

const ARCHIVE = (id: string) => `/api/v1/tasks/${id}/archive`;
const UNARCHIVE = (id: string) => `/api/v1/tasks/${id}/unarchive`;
const DEL = (id: string) => `/api/v1/tasks/${id}`;

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

const db = () => getDb();
const taskRow = async (id: string) => {
    const [row] = await db().select().from(tasks).where(eq(tasks.id, id));
    return row;
};
const activityFor = async (taskId: string) =>
    db().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const list = await makeList({ workspaceId: ws.id, createdBy: user.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    const status = await makeStatus({
        scopeId: list.id,
        statusGroup: "not_started",
    });
    const mkTask = (over: { archivedAt?: Date | null } = {}) =>
        makeTask({
            workspaceId: ws.id,
            createdBy: user.id,
            listId: list.id,
            statusId: status.id,
            taskTypeId: taskType.id,
            ...over,
        });
    return { ws, user, client, list, taskType, status, mkTask };
};

/** Attach a fresh task to `parentId` (the error-1442 workaround). */
const makeChild = async (
    ctx: Awaited<ReturnType<typeof seed>>,
    parentId: string,
) => {
    const child = await ctx.mkTask();
    await db()
        .update(tasks)
        .set({ parentTaskId: parentId, nestingDepth: 1 })
        .where(eq(tasks.id, child.id));
    return child;
};

// ════════════════════════════════════════════════════════════════════════════
describe("§10 task lifecycle (archive / unarchive / delete)", () => {
    // ─── #6 archive ───────────────────────────────────────────────────────────
    describe("POST /tasks/:id/archive", () => {
        it("archives a task (204, archived_at set, activity row)", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask();

            const res = await ctx.client.post(ARCHIVE(t.id));

            expect(res.status).toBe(204);
            expect((await taskRow(t.id)).archivedAt).not.toBeNull();
            const acts = await activityFor(t.id);
            expect(acts.some((a) => a.action === "task_archived")).toBe(true);
        });

        it("cascades to subtasks", async () => {
            const ctx = await seed();
            const parent = await ctx.mkTask();
            const child = await makeChild(ctx, parent.id);

            await ctx.client.post(ARCHIVE(parent.id));

            expect((await taskRow(parent.id)).archivedAt).not.toBeNull();
            expect((await taskRow(child.id)).archivedAt).not.toBeNull();
        });

        it("is an idempotent no-op when already archived (no 2nd activity row)", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask({ archivedAt: new Date() });

            const res = await ctx.client.post(ARCHIVE(t.id));

            expect(res.status).toBe(204);
            expect(await activityFor(t.id)).toHaveLength(0);
        });

        it("404 for a task that does not exist", async () => {
            const ctx = await seed();
            const res = await ctx.client.post(ARCHIVE("t-nope"));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 for a task in another workspace", async () => {
            const ctx = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const other = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            const res = await ctx.client.post(ARCHIVE(other.id));
            expect(res.status).toBe(404);
        });

        it("401 with no token", async () => {
            const http = await oneOff();
            const res = await http.post(ARCHIVE("t-x"));
            expect(res.status).toBe(401);
        });

        it("allows a guest to archive (🔐, 204)", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask();
            const guest = await makeUser({ workspaceId: ctx.ws.id, role: "guest" });
            const gc = await makeLoggedInClient(guest);
            const res = await gc.post(ARCHIVE(t.id));
            expect(res.status).toBe(204);
        });
    });

    // ─── #7 unarchive ───────────────────────────────────────────────────────────
    describe("POST /tasks/:id/unarchive", () => {
        it("unarchives a task (204, archived_at cleared, activity row)", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask({ archivedAt: new Date() });

            const res = await ctx.client.post(UNARCHIVE(t.id));

            expect(res.status).toBe(204);
            expect((await taskRow(t.id)).archivedAt).toBeNull();
            const acts = await activityFor(t.id);
            expect(acts.some((a) => a.action === "task_unarchived")).toBe(true);
        });

        it("cascades to subtasks", async () => {
            const ctx = await seed();
            const parent = await ctx.mkTask({ archivedAt: new Date() });
            const child = await makeChild(ctx, parent.id);
            await db()
                .update(tasks)
                .set({ archivedAt: new Date() })
                .where(eq(tasks.id, child.id));

            await ctx.client.post(UNARCHIVE(parent.id));

            expect((await taskRow(parent.id)).archivedAt).toBeNull();
            expect((await taskRow(child.id)).archivedAt).toBeNull();
        });

        it("is an idempotent no-op when not archived (no activity row)", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask();

            const res = await ctx.client.post(UNARCHIVE(t.id));

            expect(res.status).toBe(204);
            expect(await activityFor(t.id)).toHaveLength(0);
        });

        it("404 for a non-existent task", async () => {
            const ctx = await seed();
            const res = await ctx.client.post(UNARCHIVE("t-nope"));
            expect(res.status).toBe(404);
        });
    });

    // ─── #8 soft delete ──────────────────────────────────────────────────────────
    describe("DELETE /tasks/:id (soft)", () => {
        it("soft-deletes = archive (204, archived_at set)", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask();

            const res = await ctx.client.delete(DEL(t.id));

            expect(res.status).toBe(204);
            expect((await taskRow(t.id)).archivedAt).not.toBeNull();
        });

        it("allows a member to soft-delete (🔐)", async () => {
            const ctx = await seed("member");
            const t = await ctx.mkTask();
            const res = await ctx.client.delete(DEL(t.id));
            expect(res.status).toBe(204);
        });

        it("404 for a non-existent task", async () => {
            const ctx = await seed();
            const res = await ctx.client.delete(DEL("t-nope"));
            expect(res.status).toBe(404);
        });
    });

    // ─── #9 hard delete ──────────────────────────────────────────────────────────
    describe("DELETE /tasks/:id?hard=true (hard)", () => {
        it("an admin permanently deletes the task (204, row gone)", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask();
            const admin = await makeUser({ workspaceId: ctx.ws.id, role: "admin" });
            const ac = await makeLoggedInClient(admin);

            const res = await ac.delete(`${DEL(t.id)}?hard=true`);

            expect(res.status).toBe(204);
            expect(await taskRow(t.id)).toBeUndefined();
        });

        it("an owner can hard-delete", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask();
            const owner = await makeUser({ workspaceId: ctx.ws.id, role: "owner" });
            const oc = await makeLoggedInClient(owner);
            const res = await oc.delete(`${DEL(t.id)}?hard=true`);
            expect(res.status).toBe(204);
            expect(await taskRow(t.id)).toBeUndefined();
        });

        it("forbids a member from hard-deleting (403, task kept)", async () => {
            const ctx = await seed("member");
            const t = await ctx.mkTask();

            const res = await ctx.client.delete(`${DEL(t.id)}?hard=true`);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("auth.forbidden");
            expect(await taskRow(t.id)).toBeDefined();
        });

        it("cascades the hard-delete to subtasks", async () => {
            const ctx = await seed();
            const parent = await ctx.mkTask();
            const child = await makeChild(ctx, parent.id);
            const admin = await makeUser({ workspaceId: ctx.ws.id, role: "admin" });
            const ac = await makeLoggedInClient(admin);

            await ac.delete(`${DEL(parent.id)}?hard=true`);

            expect(await taskRow(parent.id)).toBeUndefined();
            expect(await taskRow(child.id)).toBeUndefined();
        });

        it("404 for a non-existent task (admin, hard)", async () => {
            const ctx = await seed();
            const admin = await makeUser({ workspaceId: ctx.ws.id, role: "admin" });
            const ac = await makeLoggedInClient(admin);
            const res = await ac.delete(`${DEL("t-nope")}?hard=true`);
            expect(res.status).toBe(404);
        });
    });

    // ─── n. Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("archive returns 204 with an empty body + X-Request-Id", async () => {
            const ctx = await seed();
            const t = await ctx.mkTask();
            const res = await ctx.client.post(ARCHIVE(t.id));
            expect(res.status).toBe(204);
            expect(Object.keys(res.body)).toHaveLength(0);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
