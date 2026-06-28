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
    makeTag,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    tasks,
    lists,
    taskActivity,
    taskAssignees,
    taskWatchers,
    taskTags,
    notifications,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/tasks` (§10 #4) — create a task. 🔐 any member.
 *
 * NOTE: the `makeList` factory does NOT seed statuses (only the real POST /lists
 * does), so the seed helper creates an explicit status; tests that omit
 * `status_id` rely on it being the list's lowest-position status.
 *
 * N/A categories (documented): Idempotency-Key (no idempotency layer in V1 —
 * a retried create makes a second task; ETag/If-Match is for PATCH).
 */

jest.setTimeout(30_000);

const PATH = "/api/v1/tasks";

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
const assigneesFor = async (taskId: string) =>
    db()
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, taskId));
const watchersFor = async (taskId: string) =>
    db()
        .select({ userId: taskWatchers.userId })
        .from(taskWatchers)
        .where(eq(taskWatchers.taskId, taskId));
const tagsFor = async (taskId: string) =>
    db()
        .select({ tagId: taskTags.tagId })
        .from(taskTags)
        .where(eq(taskTags.taskId, taskId));
const notifsForUser = async (userId: string) =>
    db()
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId));

/**
 * A workspace + member client + a list with ONE not_started status + a task
 * type. The body must pass `task_type_id` (the list has no default) unless a
 * test sets `lists.default_task_type_id` itself.
 */
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
    return { ws, user, client, list, taskType, status };
};

/** The minimal valid body for a seeded context. */
const body = (
    ctx: { list: { id: string }; taskType: { id: string } },
    extra: Record<string, unknown> = {},
) => ({
    primary_list_id: ctx.list.id,
    name: "Ship the thing",
    task_type_id: ctx.taskType.id,
    ...extra,
});

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/tasks", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("creates a task with the minimal body (201 + ETag + defaults)", async () => {
            const ctx = await seed();

            const res = await ctx.client.post(PATH).send(body(ctx));

            expect(res.status).toBe(201);
            expect(res.body.id).toMatch(/^t-/);
            expect(res.body.name).toBe("Ship the thing");
            expect(res.body.primary_list_id).toBe(ctx.list.id);
            expect(res.body.status_id).toBe(ctx.status.id);
            expect(res.body.task_type_id).toBe(ctx.taskType.id);
            expect(res.body.priority).toBe(0);
            expect(res.body.nesting_depth).toBe(0);
            expect(res.body.custom_id).toBeNull();
            expect(res.body.recurrence_pattern).toBe("none");
            expect(res.body.subtasks_count).toBe(0);
            expect(res.body.assignees).toEqual([]);
            expect(res.body.tags).toEqual([]);
            expect(res.body.task_number).toBe(1);
            expect(res.headers.etag).toBe(res.body.updated_at);
        });

        it("uses the list's default task type when task_type_id is omitted", async () => {
            const ctx = await seed();
            await db()
                .update(lists)
                .set({ defaultTaskTypeId: ctx.taskType.id })
                .where(eq(lists.id, ctx.list.id));

            const res = await ctx.client
                .post(PATH)
                .send({ primary_list_id: ctx.list.id, name: "Defaulted" });

            expect(res.status).toBe(201);
            expect(res.body.task_type_id).toBe(ctx.taskType.id);
        });

        it("reflects explicit scalar fields", async () => {
            const ctx = await seed();

            const res = await ctx.client.post(PATH).send(
                body(ctx, {
                    description: "details",
                    priority: 3,
                    is_milestone: true,
                    due_date: "2026-06-15",
                    start_date: "2026-06-10",
                    status_id: ctx.status.id,
                }),
            );

            expect(res.status).toBe(201);
            expect(res.body.description).toBe("details");
            expect(res.body.priority).toBe(3);
            expect(res.body.is_milestone).toBe(true);
            expect(res.body.due_date).toBe("2026-06-15");
            expect(res.body.start_date).toBe("2026-06-10");
        });

        it("adds initial assignees (+ auto-watch + notification + activity)", async () => {
            const ctx = await seed();
            const u2 = await makeUser({ workspaceId: ctx.ws.id, role: "member" });

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { assignees: [u2.id] }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toEqual([u2.id]);
            expect((await assigneesFor(res.body.id)).map((r) => r.userId)).toEqual(
                [u2.id],
            );
            expect((await watchersFor(res.body.id)).map((r) => r.userId)).toEqual(
                [u2.id],
            );
            const acts = await activityFor(res.body.id);
            expect(acts.map((a) => a.action).sort()).toEqual([
                "assignee_added",
                "task_created",
            ]);
            const notifs = await notifsForUser(u2.id);
            expect(notifs).toHaveLength(1);
            expect(notifs[0].type).toBe("assigned");
        });

        it("does not notify the actor about a self-assignment", async () => {
            const ctx = await seed();

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { assignees: [ctx.user.id] }));

            expect(res.status).toBe(201);
            expect(res.body.assignees).toEqual([ctx.user.id]);
            expect(await notifsForUser(ctx.user.id)).toHaveLength(0);
        });

        it("adds initial tags", async () => {
            const ctx = await seed();
            const tag = await makeTag({ workspaceId: ctx.ws.id });

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { tags: [tag.id] }));

            expect(res.status).toBe(201);
            expect(res.body.tags).toEqual([tag.id]);
            expect((await tagsFor(res.body.id)).map((r) => r.tagId)).toEqual([
                tag.id,
            ]);
        });

        it("creates a subtask under a parent (nesting_depth 1)", async () => {
            const ctx = await seed();
            const parent = await makeTask({
                workspaceId: ctx.ws.id,
                createdBy: ctx.user.id,
                listId: ctx.list.id,
                statusId: ctx.status.id,
                taskTypeId: ctx.taskType.id,
            });

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { parent_task_id: parent.id }));

            expect(res.status).toBe(201);
            expect(res.body.parent_task_id).toBe(parent.id);
            expect(res.body.nesting_depth).toBe(1);
        });

        it("honours a client-supplied custom_id", async () => {
            const ctx = await seed();

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { custom_id: "ORD-9000" }));

            expect(res.status).toBe(201);
            expect(res.body.custom_id).toBe("ORD-9000");
        });

        it("increments task_number per list", async () => {
            const ctx = await seed();

            const a = await ctx.client.post(PATH).send(body(ctx));
            const b = await ctx.client.post(PATH).send(body(ctx));

            expect(a.body.task_number).toBe(1);
            expect(b.body.task_number).toBe(2);
        });

        it("writes a task_created activity row", async () => {
            const ctx = await seed();

            const res = await ctx.client.post(PATH).send(body(ctx));

            const acts = await activityFor(res.body.id);
            expect(acts).toHaveLength(1);
            expect(acts[0].action).toBe("task_created");
            expect(acts[0].actorId).toBe(ctx.user.id);
        });

        it("leaves the trigger-maintained counters at 0", async () => {
            const ctx = await seed();

            const res = await ctx.client.post(PATH).send(body(ctx));

            const row = await taskRow(res.body.id);
            expect(row.subtasksCount).toBe(0);
            expect(row.commentsCount).toBe(0);
            expect(row.attachmentsCount).toBe(0);
        });
    });

    // ─── SLA + completed_at ──────────────────────────────────────────────────
    describe("SLA + completed_at", () => {
        it("defaults a Bug task's severity to S2 and sets a ~7d SLA", async () => {
            const ctx = await seed();
            const bug = await makeTaskType({ workspaceId: ctx.ws.id, name: "Bug" });

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { task_type_id: bug.id }));

            expect(res.status).toBe(201);
            expect(res.body.bug_severity).toBe("S2");
            expect(res.body.sla_due_at).not.toBeNull();
            const sla = new Date(res.body.sla_due_at).getTime();
            const sevenDays = Date.now() + 7 * 24 * 3600 * 1000;
            expect(Math.abs(sla - sevenDays)).toBeLessThan(5 * 60 * 1000);
        });

        it("sets a 2h SLA for a Bug S0", async () => {
            const ctx = await seed();
            const bug = await makeTaskType({ workspaceId: ctx.ws.id, name: "Bug" });

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { task_type_id: bug.id, bug_severity: "S0" }));

            const sla = new Date(res.body.sla_due_at).getTime();
            expect(Math.abs(sla - (Date.now() + 2 * 3600 * 1000))).toBeLessThan(
                5 * 60 * 1000,
            );
        });

        it("leaves sla_due_at null for a non-Bug/Complaint type", async () => {
            const ctx = await seed();

            const res = await ctx.client.post(PATH).send(body(ctx));

            expect(res.body.sla_due_at).toBeNull();
        });

        it("sets completed_at when the landing status is in a done group", async () => {
            const ctx = await seed();
            const done = await makeStatus({
                scopeId: ctx.list.id,
                statusGroup: "done",
            });

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { status_id: done.id }));

            expect(res.status).toBe(201);
            expect(res.body.completed_at).not.toBeNull();
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<[string, Record<string, unknown>]> = [
            ["missing name", { name: undefined }],
            ["missing primary_list_id", { primary_list_id: undefined }],
            ["name too long (501)", { name: "a".repeat(501) }],
            ["priority out of range", { priority: 5 }],
            ["bad recurrence_pattern", { recurrence_pattern: "monthly" }],
            ["bad bug_severity", { bug_severity: "S9" }],
            ["bad due_date", { due_date: "15-06-2026" }],
            ["custom_id too long (41)", { custom_id: "a".repeat(41) }],
        ];
        for (const [label, extra] of cases) {
            it(`returns 422 for ${label}`, async () => {
                const ctx = await seed();
                const b = body(ctx, extra);
                if ((extra as { name?: unknown }).name === undefined && "name" in extra)
                    delete (b as { name?: unknown }).name;
                if (
                    (extra as { primary_list_id?: unknown }).primary_list_id ===
                        undefined &&
                    "primary_list_id" in extra
                )
                    delete (b as { primary_list_id?: unknown }).primary_list_id;

                const res = await ctx.client.post(PATH).send(b);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
            });
        }
    });

    // ─── c. Authentication (401) ──────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http
                .post(PATH)
                .send({ primary_list_id: "l-x", name: "x" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 for an expired token", async () => {
            const { user } = await seed();
            const token = signAccess(
                { id: user.id, workspaceId: user.workspaceId, role: user.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .post(PATH)
                .set("Authorization", `Bearer ${token}`)
                .send({ primary_list_id: "l-x", name: "x" });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any member, incl. guest) ───────────────────────
    describe("Authorization", () => {
        it("allows a guest to create a task (201)", async () => {
            const ws = await makeWorkspace();
            const owner = await makeUser({ workspaceId: ws.id, role: "owner" });
            const list = await makeList({ workspaceId: ws.id, createdBy: owner.id });
            const taskType = await makeTaskType({ workspaceId: ws.id });
            await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
            const guest = await makeUser({ workspaceId: ws.id, role: "guest" });
            const client = await makeLoggedInClient(guest);

            const res = await client
                .post(PATH)
                .send({ primary_list_id: list.id, name: "G", task_type_id: taskType.id });

            expect(res.status).toBe(201);
        });
    });

    // ─── e/f. Invalid references ───────────────────────────────────────────────
    describe("Invalid references", () => {
        it("404 list.not_found for a non-existent primary_list_id", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .post(PATH)
                .send({ primary_list_id: "l-nope", name: "x", task_type_id: ctx.taskType.id });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("409 list.archived for an archived list", async () => {
            const ctx = await seed();
            await db()
                .update(lists)
                .set({ archivedAt: new Date() })
                .where(eq(lists.id, ctx.list.id));
            const res = await ctx.client.post(PATH).send(body(ctx));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("list.archived");
        });

        it("422 task.invalid_task_type for a bad task_type_id", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { task_type_id: "tt-nope" }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_task_type");
        });

        it("falls back to a workspace task type when omitted and the list has no default (201)", async () => {
            // seed()'s workspace has one task type (ctx.taskType) and the list
            // carries no default — the create flow DELIBERATELY falls back to a
            // workspace task type rather than dead-ending (quick-adds / form
            // submits), so this is a 201, not a 422.
            const ctx = await seed();
            const res = await ctx.client
                .post(PATH)
                .send({ primary_list_id: ctx.list.id, name: "x" });
            expect(res.status).toBe(201);
            expect(res.body.task_type_id).toBe(ctx.taskType.id);
        });

        it("422 task.invalid_task_type when omitted, no list default, and the workspace has NO task types", async () => {
            // A workspace with a list + status but ZERO task types — nothing to
            // fall back to, so creation is refused (the only path that 422s).
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id, role: "member" });
            const client = await makeLoggedInClient(user);
            const list = await makeList({
                workspaceId: ws.id,
                createdBy: user.id,
            });
            await makeStatus({ scopeId: list.id, statusGroup: "not_started" });
            const res = await client
                .post(PATH)
                .send({ primary_list_id: list.id, name: "x" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_task_type");
        });

        it("422 task.invalid_status for a status not in the list", async () => {
            const ctx = await seed();
            const otherList = await makeList({
                workspaceId: ctx.ws.id,
                createdBy: ctx.user.id,
            });
            const foreignStatus = await makeStatus({ scopeId: otherList.id });
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { status_id: foreignStatus.id }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_status");
        });

        it("422 task.invalid_parent for a parent in another workspace", async () => {
            const ctx = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const foreignParent = await makeTask({
                workspaceId: ws2.id,
                createdBy: u2.id,
            });
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { parent_task_id: foreignParent.id }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_parent");
        });

        it("422 task.nesting_too_deep when the parent is already at depth 2", async () => {
            const ctx = await seed();
            const p0 = await makeTask({
                workspaceId: ctx.ws.id,
                createdBy: ctx.user.id,
                listId: ctx.list.id,
                statusId: ctx.status.id,
                taskTypeId: ctx.taskType.id,
            });
            const p2 = await makeTask({
                workspaceId: ctx.ws.id,
                createdBy: ctx.user.id,
                listId: ctx.list.id,
                statusId: ctx.status.id,
                taskTypeId: ctx.taskType.id,
            });
            await db()
                .update(tasks)
                .set({ parentTaskId: p0.id, nestingDepth: 2 })
                .where(eq(tasks.id, p2.id));

            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { parent_task_id: p2.id }));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.nesting_too_deep");
        });

        it("422 task.invalid_assignee for a non-member assignee", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { assignees: ["u-outsider"] }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_assignee");
        });

        it("422 task.invalid_tag for a non-workspace tag", async () => {
            const ctx = await seed();
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { tags: ["tag-outsider"] }));
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_tag");
        });

        it("409 task.duplicate_custom_id for a custom_id already used in the workspace", async () => {
            const ctx = await seed();
            await ctx.client.post(PATH).send(body(ctx, { custom_id: "ORD-1" }));
            const res = await ctx.client
                .post(PATH)
                .send(body(ctx, { custom_id: "ORD-1" }));
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.duplicate_custom_id");
        });
    });

    // ─── g. Workspace isolation ────────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("404 list.not_found when the list belongs to another workspace", async () => {
            const ctx = await seed();
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const otherList = await makeList({
                workspaceId: ws2.id,
                createdBy: u2.id,
            });
            const res = await ctx.client
                .post(PATH)
                .send({ primary_list_id: otherList.id, name: "x", task_type_id: ctx.taskType.id });
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });
    });

    // ─── i. Concurrency ──────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two parallel creates in the same list get distinct task_numbers", async () => {
            const ctx = await seed();

            const [a, b] = await Promise.all([
                ctx.client.post(PATH).send(body(ctx)),
                ctx.client.post(PATH).send(body(ctx)),
            ]);

            expect(a.status).toBe(201);
            expect(b.status).toBe(201);
            const nums = [a.body.task_number, b.body.task_number].sort();
            expect(nums).toEqual([1, 2]);
        });
    });

    // ─── m. Cleanup / rollback ─────────────────────────────────────────────────
    describe("Cleanup / rollback", () => {
        it("creates no task row when an assignee is invalid", async () => {
            const ctx = await seed();
            const before = (
                await db().select({ id: tasks.id }).from(tasks)
            ).length;

            await ctx.client
                .post(PATH)
                .send(body(ctx, { assignees: ["u-outsider"] }));

            const after = (await db().select({ id: tasks.id }).from(tasks))
                .length;
            expect(after).toBe(before);
        });
    });

    // ─── n. Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id and ETag header", async () => {
            const ctx = await seed();
            const res = await ctx.client.post(PATH).send(body(ctx));
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
            expect(res.headers.etag).toBeDefined();
        });
    });
});
