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
import { tasks, taskAssignees } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/tasks/my-work` (§10 #11) — the caller's task dashboard.
 * Buckets: done (status_group done/closed) → overdue / today / next(≤7d) /
 * unscheduled (by due_date); a task due >7d out and not done is in no bucket.
 * Only the caller's assigned, non-archived, same-workspace tasks count.
 */

jest.setTimeout(30_000);

const PATH = "/api/v1/tasks/my-work";

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
const dayOffset = (n: number): Date => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d;
};
const assign = async (taskId: string, userId: string) =>
    db().insert(taskAssignees).values({ taskId, userId });
const setDue = async (taskId: string, due: Date | null) =>
    db().update(tasks).set({ dueDate: due }).where(eq(tasks.id, taskId));

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
    const mk = async (statusId: string) =>
        makeTask({
            workspaceId: ws.id,
            createdBy: user.id,
            listId: list.id,
            statusId,
            taskTypeId: taskType.id,
        });
    return { ws, user, client, list, taskType, todo, done, mk };
};

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/tasks/my-work", () => {
    // ─── a. Happy path — bucketing ──────────────────────────────────────────
    describe("Bucketing", () => {
        it("places each assigned task in the correct bucket", async () => {
            const ctx = await seed();
            const overdue = await ctx.mk(ctx.todo.id);
            await setDue(overdue.id, dayOffset(-2));
            const today = await ctx.mk(ctx.todo.id);
            await setDue(today.id, dayOffset(0));
            const next = await ctx.mk(ctx.todo.id);
            await setDue(next.id, dayOffset(3));
            const unscheduled = await ctx.mk(ctx.todo.id); // no due date
            const doneTask = await ctx.mk(ctx.done.id);
            await setDue(doneTask.id, dayOffset(-5)); // done wins over overdue
            const farFuture = await ctx.mk(ctx.todo.id);
            await setDue(farFuture.id, dayOffset(30));
            for (const t of [overdue, today, next, unscheduled, doneTask, farFuture])
                await assign(t.id, ctx.user.id);

            const res = await ctx.client.get(PATH);

            expect(res.status).toBe(200);
            const ids = (b: string) =>
                res.body[b].map((t: { id: string }) => t.id);
            expect(ids("overdue")).toEqual([overdue.id]);
            expect(ids("today")).toEqual([today.id]);
            expect(ids("next")).toEqual([next.id]);
            expect(ids("unscheduled")).toEqual([unscheduled.id]);
            expect(ids("done")).toEqual([doneTask.id]);
            // far-future (due +30d, not done) is in no bucket.
            const all = ["overdue", "today", "next", "unscheduled", "done"]
                .flatMap((b) => ids(b));
            expect(all).not.toContain(farFuture.id);
        });

        it("returns hydrated Task objects", async () => {
            const ctx = await seed();
            const t = await ctx.mk(ctx.todo.id);
            await setDue(t.id, dayOffset(0));
            await assign(t.id, ctx.user.id);

            const res = await ctx.client.get(PATH);

            const task = res.body.today[0];
            expect(task.id).toBe(t.id);
            expect(task.assignees).toContain(ctx.user.id);
            expect(task).toHaveProperty("custom_field_values");
            expect(task).not.toHaveProperty("internal_id");
        });

        it("excludes tasks assigned to OTHER users", async () => {
            const ctx = await seed();
            const other = await makeUser({
                workspaceId: ctx.ws.id,
                role: "member",
            });
            const t = await ctx.mk(ctx.todo.id);
            await setDue(t.id, dayOffset(0));
            await assign(t.id, other.id); // not the caller

            const res = await ctx.client.get(PATH);

            expect(res.body.today).toEqual([]);
        });

        it("excludes archived assigned tasks", async () => {
            const ctx = await seed();
            const t = await ctx.mk(ctx.todo.id);
            await setDue(t.id, dayOffset(0));
            await assign(t.id, ctx.user.id);
            await db()
                .update(tasks)
                .set({ archivedAt: new Date() })
                .where(eq(tasks.id, t.id));

            const res = await ctx.client.get(PATH);

            expect(res.body.today).toEqual([]);
        });

        it("returns all five (empty) buckets for a user with no assigned tasks", async () => {
            const ctx = await seed();

            const res = await ctx.client.get(PATH);

            expect(res.body).toEqual({
                today: [],
                overdue: [],
                next: [],
                unscheduled: [],
                done: [],
            });
        });
    });

    // ─── ?bucket= ────────────────────────────────────────────────────────────
    describe("Single bucket", () => {
        it("returns only the requested bucket when ?bucket= is given", async () => {
            const ctx = await seed();
            const t = await ctx.mk(ctx.todo.id);
            await setDue(t.id, dayOffset(0));
            await assign(t.id, ctx.user.id);

            const res = await ctx.client.get(`${PATH}?bucket=today`);

            expect(res.status).toBe(200);
            expect(Object.keys(res.body)).toEqual(["today"]);
            expect(res.body.today.map((x: { id: string }) => x.id)).toEqual([
                t.id,
            ]);
        });

        it("422 for an unknown bucket value", async () => {
            const ctx = await seed();
            const res = await ctx.client.get(`${PATH}?bucket=someday`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication ─────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.get(PATH);
            expect(res.status).toBe(401);
        });

        it("401 for an expired token", async () => {
            const { user } = await seed();
            const token = signAccess(
                { id: user.id, workspaceId: user.workspaceId, role: user.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .get(PATH)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
        });
    });

    // ─── g. Workspace isolation ────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("only counts the caller's own workspace tasks", async () => {
            const ctx = await seed();
            // A task in another workspace, even if it shared the user id, must
            // not appear (the query is workspace-scoped).
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const t2 = await makeTask({ workspaceId: ws2.id, createdBy: u2.id });
            await setDue(t2.id, dayOffset(0));
            await assign(t2.id, ctx.user.id); // cross-tenant assignment (pathological)

            const res = await ctx.client.get(PATH);

            const all = [
                "overdue",
                "today",
                "next",
                "unscheduled",
                "done",
            ].flatMap((b) => res.body[b].map((x: { id: string }) => x.id));
            expect(all).not.toContain(t2.id);
        });
    });

    // ─── n. Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds json with an X-Request-Id header", async () => {
            const ctx = await seed();
            const res = await ctx.client.get(PATH);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
