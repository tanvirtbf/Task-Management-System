import jwt from "jsonwebtoken";
import { eq, inArray } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeList,
    makeStatus,
    makeTaskType,
    makeTask,
    makeTag,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    tasks,
    taskActivity,
    taskAssignees,
    taskTags,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/tasks/bulk` (§10 #10) — fail-atomic bulk edit.
 */

jest.setTimeout(60_000);

const PATH = "/api/v1/tasks/bulk";

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

const db = () => getDb();
const rowsByIds = async (ids: string[]) =>
    db().select().from(tasks).where(inArray(tasks.id, ids));
const assigneesFor = async (taskId: string) =>
    db()
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, taskId));
const tagsForTask = async (taskId: string) =>
    db()
        .select({ tagId: taskTags.tagId })
        .from(taskTags)
        .where(eq(taskTags.taskId, taskId));
const activityFor = async (taskId: string) =>
    db().select().from(taskActivity).where(eq(taskActivity.taskId, taskId));

const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const list = await makeList({ workspaceId: ws.id, createdBy: user.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    const todo = await makeStatus({
        scopeId: list.id,
        statusGroup: "not_started",
    });
    const done = await makeStatus({ scopeId: list.id, statusGroup: "done" });
    const mk = () =>
        makeTask({
            workspaceId: ws.id,
            createdBy: user.id,
            listId: list.id,
            statusId: todo.id,
            taskTypeId: taskType.id,
        });
    const mkN = async (n: number): Promise<string[]> => {
        const out: string[] = [];
        for (let i = 0; i < n; i += 1) out.push((await mk()).id);
        return out;
    };
    return { ws, user, client, list, taskType, todo, done, mk, mkN };
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/tasks/bulk", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("bulk-sets a scalar field on all targets (200 {updated, tasks})", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(3);

            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { priority: 4 } });

            expect(res.status).toBe(200);
            expect(res.body.updated).toBe(3);
            expect(res.body.tasks).toHaveLength(3);
            const rows = await rowsByIds(ids);
            expect(rows.every((r) => r.priority === 4)).toBe(true);
        });

        it("bulk-changes status and sets completed_at for a done group", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(2);

            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { status_id: ctx.done.id } });

            expect(res.status).toBe(200);
            const rows = await rowsByIds(ids);
            expect(rows.every((r) => r.statusId === ctx.done.id)).toBe(true);
            expect(rows.every((r) => r.completedAt !== null)).toBe(true);
        });

        it("bulk-adds an assignee (+ auto-watch) to every target", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(2);
            const u2 = await makeUser({ workspaceId: ctx.ws.id, role: "member" });

            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { assignee_add: [u2.id] } });

            expect(res.status).toBe(200);
            for (const id of ids) {
                expect((await assigneesFor(id)).map((r) => r.userId)).toContain(
                    u2.id,
                );
            }
        });

        it("bulk-adds and removes tags", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(2);
            const tag = await makeTag({ workspaceId: ctx.ws.id });

            await ctx.client.post(PATH).send({ ids, patch: { tag_add: [tag.id] } });
            for (const id of ids)
                expect((await tagsForTask(id)).map((r) => r.tagId)).toEqual([
                    tag.id,
                ]);

            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { tag_remove: [tag.id] } });
            expect(res.status).toBe(200);
            for (const id of ids)
                expect(await tagsForTask(id)).toHaveLength(0);
        });

        it("bulk-archives via archived_at, then unarchives via null", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(2);

            await ctx.client
                .post(PATH)
                .send({ ids, patch: { archived_at: new Date().toISOString() } });
            expect((await rowsByIds(ids)).every((r) => r.archivedAt !== null)).toBe(
                true,
            );

            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { archived_at: null } });
            expect(res.status).toBe(200);
            expect((await rowsByIds(ids)).every((r) => r.archivedAt === null)).toBe(
                true,
            );
        });

        it("writes a task_updated activity row per task", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(2);

            await ctx.client.post(PATH).send({ ids, patch: { priority: 2 } });

            for (const id of ids) {
                const acts = await activityFor(id);
                expect(acts.some((a) => a.action === "task_updated")).toBe(true);
            }
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 for an empty ids array", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .post(PATH)
                .send({ ids: [], patch: { priority: 1 } });
            expect(res.status).toBe(422);
        });

        it("422 for more than 200 ids", async () => {
            const ctx = await seed();
            const ids = Array.from({ length: 201 }, (_, i) => `t-${i}`);
            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { priority: 1 } });
            expect(res.status).toBe(422);
        });

        it("422 for a missing patch", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(1);
            const res = await ctx.client.post(PATH).send({ ids });
            expect(res.status).toBe(422);
        });

        it("422 for an empty patch (no keys)", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(1);
            const res = await ctx.client.post(PATH).send({ ids, patch: {} });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 for an unknown patch key", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(1);
            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { name: "nope" } });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 for a bad priority", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(1);
            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { priority: 9 } });
            expect(res.status).toBe(422);
        });
    });

    // ─── fail-atomic ───────────────────────────────────────────────────────────
    describe("Fail-atomic", () => {
        it("404 and NO change when one id is not in the workspace", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(2);

            const res = await ctx.client
                .post(PATH)
                .send({ ids: [...ids, "t-nope"], patch: { priority: 3 } });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            // The two valid tasks are unchanged (priority still default 0).
            expect((await rowsByIds(ids)).every((r) => r.priority === 0)).toBe(
                true,
            );
        });

        it("422 task.invalid_status and no change for a bad status_id", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(2);
            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { status_id: "s-nope" } });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_status");
        });

        it("422 task.invalid_assignee for a non-member assignee_add", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(1);
            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { assignee_add: ["u-outsider"] } });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_assignee");
        });

        it("422 task.invalid_tag for a non-workspace tag_add", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(1);
            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { tag_add: ["tag-outsider"] } });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_tag");
        });
    });

    // ─── g. Workspace isolation ────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("404 when an id belongs to another workspace", async () => {
            const ctx = await seed();
            const mine = await ctx.mkN(1);
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const theirs = await makeTask({
                workspaceId: ws2.id,
                createdBy: u2.id,
            });

            const res = await ctx.client
                .post(PATH)
                .send({ ids: [...mine, theirs.id], patch: { priority: 1 } });

            expect(res.status).toBe(404);
        });
    });

    // ─── c. Authentication ─────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http
                .post(PATH)
                .send({ ids: ["t-x"], patch: { priority: 1 } });
            expect(res.status).toBe(401);
        });
    });

    // ─── n. Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds json with an X-Request-Id header", async () => {
            const ctx = await seed();
            const ids = await ctx.mkN(1);
            const res = await ctx.client
                .post(PATH)
                .send({ ids, patch: { priority: 1 } });
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
