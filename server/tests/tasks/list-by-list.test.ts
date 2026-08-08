import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeList,
    makeTaskType,
    makeStatus,
    makeTag,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    tasks,
    taskAssignees,
    taskWatchers,
    taskTags,
    customFields,
    taskCustomFieldValues,
    sprints,
    taskActivity,
    workspaceActivity,
    lists,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/lists/:listId/tasks` (§10 "the big one").
 *
 * Combines the two sibling patterns:
 *   - list-scoped + workspace-isolation guard (cf. `statuses/list.test.ts`)
 *   - cursor pagination + filters + envelope (cf. `users/list.test.ts`)
 * plus task hydration (assignees / watchers / tags / custom_field_values).
 *
 * Real DB writes only; `beforeEach` (setup-each.ts) truncates between tests, so
 * `tasks.internal_id` (AUTO_INCREMENT) restarts each test — insertion order is
 * therefore the keyset order. Task/membership/custom-field seed helpers are
 * LOCAL (not in the shared factory file) to avoid colliding with the
 * concurrently-evolving factories.
 */

// The shared `resetTestDb` beforeEach TRUNCATEs all 31 tables; on a slow disk
// each TRUNCATE recreates a tablespace file (~200ms), so a reset can take ~6.5s
// — past Jest's default 5s hook timeout. Raise it so the (correct) reset fits.
jest.setTimeout(30000);

const PATH = (listId: string) => `/api/v1/lists/${listId}/tasks`;

// ─── the 47 wire fields (API_DESIGN.md §10 + Appendix A) ──────────────────────
const TASK_KEYS = [
    "id",
    "custom_id",
    "task_number",
    "workspace_id",
    "primary_list_id",
    "name",
    "description",
    "status_id",
    "priority",
    "task_type_id",
    "parent_task_id",
    "nesting_depth",
    "is_milestone",
    "start_date",
    "due_date",
    "completed_at",
    "review_status",
    "reviewed_at",
    "reviewed_by",
    "sla_due_at",
    "recurrence_pattern",
    "recurrence_days",
    "recurrence_ends_at",
    "time_estimate_seconds",
    "time_tracked_seconds",
    "subtasks_count",
    "subtasks_completed",
    "comments_count",
    "attachments_count",
    "sprint_id",
    "story_points",
    "reviewer_id",
    "branch_name",
    "pr_url",
    "pr_status",
    "bug_severity",
    "bug_reproducibility",
    "bug_environment",
    "bug_browser",
    "reporter_team",
    "deployed_at",
    "rollback_reason",
    "assignees",
    "watchers",
    "tags",
    "custom_field_values",
    "archived_at",
    "created_by",
    "created_at",
    "updated_at",
].sort();

interface WireTask {
    id: string;
    [key: string]: unknown;
}

const dataOf = (body: unknown): WireTask[] => (body as { data: WireTask[] }).data;
const idsOf = (body: unknown): string[] => dataOf(body).map((t) => t.id);
const pageOf = (body: unknown) =>
    (
        body as {
            pagination: {
                next_cursor: string | null;
                has_more: boolean;
                total_estimate: number | null;
            };
        }
    ).pagination;

// ─── context + seed helpers (real DB inserts) ─────────────────────────────────

interface Ctx {
    wsId: string;
    userId: string;
    listId: string;
    spaceId: string;
    taskTypeId: string;
    statusId: string;
}

/** A workspace + user + logged-in client + one list with a default status/type. */
const setup = async (opts: { role?: Role; status?: "active" | "invited" | "deactivated" } = {}) => {
    const ws = await makeWorkspace();
    const user = await makeUser({
        workspaceId: ws.id,
        role: opts.role ?? "member",
        status: opts.status ?? "active",
    });
    const client = await makeLoggedInClient(user);
    const list = await makeList({ workspaceId: ws.id, createdBy: user.id });
    const taskType = await makeTaskType({ workspaceId: ws.id });
    const status = await makeStatus({ scopeId: list.id });
    const ctx: Ctx = {
        wsId: ws.id,
        userId: user.id,
        listId: list.id,
        spaceId: list.spaceId,
        taskTypeId: taskType.id,
        statusId: status.id,
    };
    return { ws, user, client, ctx };
};

let _taskNo = 0;

interface TaskOverrides {
    id?: string;
    name?: string;
    priority?: number;
    dueDate?: string | null;
    startDate?: string | null;
    parentTaskId?: string | null;
    nestingDepth?: number;
    customId?: string | null;
    archivedAt?: Date | null;
    reviewerId?: string | null;
    sprintId?: string | null;
    bugSeverity?: "S0" | "S1" | "S2" | "S3" | null;
    statusId?: string;
    taskTypeId?: string;
}

/** Insert one task into the ctx list; insertion order === internal_id order. */
const insertTask = async (ctx: Ctx, o: TaskOverrides = {}): Promise<string> => {
    const db = getDb();
    const id = o.id ?? fakeId("t");
    const values: typeof tasks.$inferInsert = {
        id,
        workspaceId: ctx.wsId,
        primaryListId: ctx.listId,
        taskNumber: ++_taskNo,
        name: o.name ?? `Task ${_taskNo}`,
        statusId: o.statusId ?? ctx.statusId,
        taskTypeId: o.taskTypeId ?? ctx.taskTypeId,
        createdBy: ctx.userId,
    };
    if (o.priority !== undefined) values.priority = o.priority;
    if (o.dueDate !== undefined)
        values.dueDate =
            o.dueDate === null ? null : new Date(`${o.dueDate}T00:00:00.000Z`);
    if (o.startDate !== undefined)
        values.startDate =
            o.startDate === null
                ? null
                : new Date(`${o.startDate}T00:00:00.000Z`);
    if (o.parentTaskId !== undefined) values.parentTaskId = o.parentTaskId;
    if (o.nestingDepth !== undefined) values.nestingDepth = o.nestingDepth;
    if (o.customId !== undefined) values.customId = o.customId;
    if (o.archivedAt !== undefined) values.archivedAt = o.archivedAt;
    if (o.reviewerId !== undefined) values.reviewerId = o.reviewerId;
    if (o.sprintId !== undefined) values.sprintId = o.sprintId;
    if (o.bugSeverity !== undefined) values.bugSeverity = o.bugSeverity;
    await db.insert(tasks).values(values);
    return id;
};

const addAssignee = async (taskId: string, userId: string) =>
    getDb().insert(taskAssignees).values({ taskId, userId });
const addWatcher = async (taskId: string, userId: string) =>
    getDb().insert(taskWatchers).values({ taskId, userId });
const addTaskTag = async (taskId: string, tagId: string) =>
    getDb().insert(taskTags).values({ taskId, tagId });

const insertSprint = async (wsId: string): Promise<string> => {
    const id = fakeId("spr");
    await getDb()
        .insert(sprints)
        .values({
            id,
            workspaceId: wsId,
            name: `Sprint ${id.slice(-6)}`,
            startDate: new Date("2026-05-01T00:00:00.000Z"),
            endDate: new Date("2026-05-14T00:00:00.000Z"),
        });
    return id;
};

const insertCustomField = async (
    wsId: string,
    createdBy: string,
    o: { scopeId?: string; hiddenFromGuests?: boolean; name?: string } = {},
): Promise<string> => {
    const id = fakeId("cf");
    await getDb()
        .insert(customFields)
        .values({
            id,
            workspaceId: wsId,
            scopeType: "list",
            scopeId: o.scopeId ?? null,
            name: o.name ?? `Field ${id.slice(-6)}`,
            type: "text",
            hiddenFromGuests: o.hiddenFromGuests ?? false,
            createdBy,
        });
    return id;
};

const setCfv = async (taskId: string, fieldId: string, value: unknown) =>
    getDb()
        .insert(taskCustomFieldValues)
        .values({ taskId, customFieldId: fieldId, value });

/**
 * Seed a subtask row. NOTE: the schema's `trg_subtasks_after_insert` runs
 * `UPDATE tasks` from an `AFTER INSERT ON tasks` trigger, which MySQL rejects
 * (error 1442) — so a child CANNOT be INSERTed with `parent_task_id` set. We
 * insert it top-level, then attach the parent via `UPDATE` without touching
 * `status_id` (which the `AFTER UPDATE` trigger requires before it updates the
 * parent), sidestepping the broken trigger. This is a pre-existing schema bug
 * that breaks subtask creation generally (see the test report); it is unrelated
 * to this read endpoint, whose `include_subtasks` is a plain WHERE filter.
 */
const makeSubtask = async (ctx: Ctx, parentId: string, childId: string) => {
    await insertTask(ctx, { id: childId });
    await getDb()
        .update(tasks)
        .set({ parentTaskId: parentId, nestingDepth: 1 })
        .where(eq(tasks.id, childId));
};

const countTaskActivity = async () =>
    (await getDb().select({ id: taskActivity.id }).from(taskActivity)).length;
const countWorkspaceActivity = async () =>
    (await getDb().select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;
const countTasks = async () =>
    (await getDb().select({ id: tasks.id }).from(tasks)).length;

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

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/lists/:listId/tasks", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec list envelope", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);

            const res = await client.get(PATH(ctx.listId));

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(pageOf(res.body)).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 1,
            });
        });

        it("returns an empty page (not 404) for a list with no tasks", async () => {
            const { client, ctx } = await setup();

            const res = await client.get(PATH(ctx.listId));

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(pageOf(res.body)).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 0,
            });
        });

        it("shapes each row as exactly the 47 wire fields", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(Object.keys(row).sort()).toEqual(TASK_KEYS);
        });

        it("never leaks internal_id", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row).not.toHaveProperty("internal_id");
            expect(row).not.toHaveProperty("internalId");
        });

        it("returns the stored scalar fields verbatim", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, {
                id: "t-fixed-1",
                name: "Pack order ORD-1",
                customId: "ORD-1",
                priority: 2,
            });

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row.id).toBe("t-fixed-1");
            expect(row.name).toBe("Pack order ORD-1");
            expect(row.custom_id).toBe("ORD-1");
            expect(row.priority).toBe(2);
            expect(row.primary_list_id).toBe(ctx.listId);
            expect(row.workspace_id).toBe(ctx.wsId);
        });

        it("emits created_at/updated_at as ISO-8601 and unset timestamps as null", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            expect(row.completed_at).toBeNull();
            expect(row.sla_due_at).toBeNull();
            expect(row.archived_at).toBeNull();
        });

        it("round-trips due_date / start_date as YYYY-MM-DD", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, {
                startDate: "2026-05-28",
                dueDate: "2026-05-30",
            });

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row.start_date).toBe("2026-05-28");
            expect(row.due_date).toBe("2026-05-30");
        });

        it("reflects the trigger-maintained counters from their columns", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row.subtasks_count).toBe(0);
            expect(row.comments_count).toBe(0);
            expect(row.attachments_count).toBe(0);
            expect(row.time_tracked_seconds).toBe(0);
        });
    });

    // ─── Hydration ────────────────────────────────────────────────────────────
    describe("Hydration", () => {
        it("returns empty arrays / object when a task has no relations", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row.assignees).toEqual([]);
            expect(row.watchers).toEqual([]);
            expect(row.tags).toEqual([]);
            expect(row.custom_field_values).toEqual({});
        });

        it("inlines assignees, watchers and tags as id arrays", async () => {
            const { client, ctx, ws } = await setup();
            const u2 = await makeUser({ workspaceId: ws.id });
            const u3 = await makeUser({ workspaceId: ws.id });
            const tag = await makeTag({ workspaceId: ws.id });
            const taskId = await insertTask(ctx);
            await addAssignee(taskId, ctx.userId);
            await addAssignee(taskId, u2.id);
            await addWatcher(taskId, u3.id);
            await addTaskTag(taskId, tag.id);

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect((row.assignees as string[]).sort()).toEqual(
                [ctx.userId, u2.id].sort(),
            );
            expect(row.watchers).toEqual([u3.id]);
            expect(row.tags).toEqual([tag.id]);
        });

        it("inlines custom_field_values keyed by field id", async () => {
            const { client, ctx } = await setup();
            const field = await insertCustomField(ctx.wsId, ctx.userId, {
                scopeId: ctx.listId,
            });
            const taskId = await insertTask(ctx);
            await setCfv(taskId, field, { text: "FX12345" });

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row.custom_field_values).toEqual({
                [field]: { text: "FX12345" },
            });
        });

        it("scopes hydration to each task (no bleed across rows)", async () => {
            const { client, ctx, ws } = await setup();
            const u2 = await makeUser({ workspaceId: ws.id });
            const a = await insertTask(ctx, { id: "t-a" });
            const b = await insertTask(ctx, { id: "t-b" });
            await addAssignee(a, u2.id);

            const rows = dataOf((await client.get(PATH(ctx.listId))).body);
            const rowA = rows.find((r) => r.id === "t-a");
            const rowB = rows.find((r) => r.id === "t-b");

            expect(rowA?.assignees).toEqual([u2.id]);
            expect(rowB?.assignees).toEqual([]);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        const cases: Array<{ name: string; qs: string; field: string }> = [
            { name: "bad status_group member", qs: "status_group=nope", field: "status_group" },
            { name: "mixed-case status_group", qs: "status_group=DONE", field: "status_group" },
            { name: "priority out of range", qs: "priority=9", field: "priority" },
            { name: "non-numeric priority", qs: "priority=high", field: "priority" },
            { name: "bad bug_severity", qs: "bug_severity=S9", field: "bug_severity" },
            { name: "zero limit", qs: "limit=0", field: "limit" },
            { name: "negative limit", qs: "limit=-1", field: "limit" },
            { name: "non-numeric limit", qs: "limit=abc", field: "limit" },
            { name: "fractional limit", qs: "limit=2.5", field: "limit" },
            { name: "bad due_before format", qs: "due_before=2026/05/30", field: "due_before" },
            { name: "impossible due_before date", qs: "due_before=2026-13-40", field: "due_before" },
            { name: "bad due_after", qs: "due_after=nope", field: "due_after" },
            { name: "bad include_archived", qs: "include_archived=maybe", field: "include_archived" },
            { name: "bad include_subtasks", qs: "include_subtasks=yes", field: "include_subtasks" },
            { name: "empty cursor", qs: "cursor=", field: "cursor" },
            { name: "over-length reviewer", qs: `reviewer=${"a".repeat(65)}`, field: "reviewer" },
            { name: "over-length sprint", qs: `sprint=${"a".repeat(65)}`, field: "sprint" },
        ];
        for (const c of cases) {
            it(`returns 422 validation.failed for ${c.name}`, async () => {
                const { client, ctx } = await setup();
                const res = await client.get(`${PATH(ctx.listId)}?${c.qs}`);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === c.field,
                    ),
                ).toBe(true);
            });
        }

        it("returns 422 for an over-length q (201 chars)", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(`${PATH(ctx.listId)}?q=${"x".repeat(201)}`);
            expect(res.status).toBe(422);
        });

        it("accepts a q of exactly 200 chars (200)", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(`${PATH(ctx.listId)}?q=${"x".repeat(200)}`);
            expect(res.status).toBe(200);
        });

        it("returns 422 when listId exceeds 64 chars", async () => {
            const { client } = await setup();
            const res = await client.get(PATH("a".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("listId");
        });

        it("treats a 64-char listId as valid format (404, not 422)", async () => {
            const { client } = await setup();
            const res = await client.get(PATH("a".repeat(64)));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("returns 422 for a whitespace-only listId (trim → empty)", async () => {
            const { client } = await setup();
            const res = await client.get(PATH("%20%20"));
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("listId");
        });

        it("accepts all valid filters together (200)", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(
                `${PATH(ctx.listId)}?status_group=active,done&priority=1,2&bug_severity=S0,S1&include_archived=true&include_subtasks=true&due_after=2026-01-01&due_before=2026-12-31&q=hello&limit=10`,
            );
            expect(res.status).toBe(200);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token with no credentials", async () => {
            const { ctx } = await setup();
            const http = await oneOff();
            const res = await http.get(PATH(ctx.listId));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a garbage bearer token", async () => {
            const { ctx } = await setup();
            const http = await oneOff();
            const res = await http
                .get(PATH(ctx.listId))
                .set("Authorization", "Bearer not.a.jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a wrong-secret token", async () => {
            const { ctx, user } = await setup();
            const token = signAccess(
                { id: user.id, workspaceId: ctx.wsId, role: "member" },
                "the-wrong-secret-value-1234567890",
                { expiresIn: "15m" },
            );
            const http = await oneOff();
            const res = await http
                .get(PATH(ctx.listId))
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { ctx, user } = await setup();
            const token = signAccess(
                { id: user.id, workspaceId: ctx.wsId, role: "member" },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .get(PATH(ctx.listId))
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("serves a deactivated user holding a valid access token (stateless JWT)", async () => {
            const { client, ctx } = await setup({ status: "deactivated" });
            await insertTask(ctx);

            const res = await client.get(PATH(ctx.listId));

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        it("runs authentication before validation (unauth + bad listId → 401)", async () => {
            const http = await oneOff();
            const res = await http.get(PATH("a".repeat(65)));
            expect(res.status).toBe(401);
        });
    });

    // ─── d. Authorization ─────────────────────────────────────────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        it.each(roles)("allows a %s to list tasks (200)", async (role) => {
            const { client, ctx } = await setup({ role });
            await insertTask(ctx);

            const res = await client.get(PATH(ctx.listId));
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        it("hides hidden_from_guests custom fields from a guest", async () => {
            const { client, ctx, user } = await setup({ role: "guest" });
            const visible = await insertCustomField(ctx.wsId, user.id, {
                scopeId: ctx.listId,
                hiddenFromGuests: false,
            });
            const hidden = await insertCustomField(ctx.wsId, user.id, {
                scopeId: ctx.listId,
                hiddenFromGuests: true,
            });
            const taskId = await insertTask(ctx);
            await setCfv(taskId, visible, { text: "shown" });
            await setCfv(taskId, hidden, { text: "secret" });

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(Object.keys(row.custom_field_values as object)).toEqual([
                visible,
            ]);
        });

        it("shows hidden_from_guests custom fields to a member", async () => {
            const { client, ctx, user } = await setup({ role: "member" });
            const hidden = await insertCustomField(ctx.wsId, user.id, {
                scopeId: ctx.listId,
                hiddenFromGuests: true,
            });
            const taskId = await insertTask(ctx);
            await setCfv(taskId, hidden, { text: "secret" });

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);

            expect(row.custom_field_values).toEqual({ [hidden]: { text: "secret" } });
        });
    });

    // ─── e. Lifecycle ─────────────────────────────────────────────────────────
    describe("Lifecycle", () => {
        it("returns 404 list.not_found for a non-existent list", async () => {
            const { client } = await setup();
            const res = await client.get(PATH(fakeId("l")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("excludes archived tasks by default", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-live" });
            await insertTask(ctx, { id: "t-dead", archivedAt: new Date() });

            const res = await client.get(PATH(ctx.listId));
            expect(idsOf(res.body)).toEqual(["t-live"]);
            expect(pageOf(res.body).total_estimate).toBe(1);
        });

        it("includes archived tasks with include_archived=true", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-live" });
            await insertTask(ctx, { id: "t-dead", archivedAt: new Date() });

            const res = await client.get(`${PATH(ctx.listId)}?include_archived=true`);
            expect(idsOf(res.body).sort()).toEqual(["t-dead", "t-live"]);
        });

        it("reads tasks of an archived list (archive hides from parent lists, not direct reads)", async () => {
            const { client, ctx } = await setup();
            // Archive the list itself, then read its tasks directly.
            await getDb()
                .update(lists)
                .set({ archivedAt: new Date() })
                .where(eq(lists.id, ctx.listId));
            await insertTask(ctx, { id: "t-1" });

            const res = await client.get(PATH(ctx.listId));
            expect(res.status).toBe(200);
            expect(idsOf(res.body)).toEqual(["t-1"]);
        });
    });

    // ─── default subtask exclusion ────────────────────────────────────────────
    describe("Subtasks", () => {
        it("returns only top-level tasks by default", async () => {
            const { client, ctx } = await setup();
            const parent = await insertTask(ctx, { id: "t-parent" });
            await makeSubtask(ctx, parent, "t-child");

            const res = await client.get(PATH(ctx.listId));
            expect(idsOf(res.body)).toEqual(["t-parent"]);
        });

        it("includes subtasks with include_subtasks=true", async () => {
            const { client, ctx } = await setup();
            const parent = await insertTask(ctx, { id: "t-parent" });
            await makeSubtask(ctx, parent, "t-child");

            const res = await client.get(`${PATH(ctx.listId)}?include_subtasks=true`);
            expect(idsOf(res.body)).toEqual(["t-parent", "t-child"]);
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 when the list belongs to another workspace", async () => {
            const a = await setup();
            const b = await setup();
            await insertTask(b.ctx, { id: "t-secret" });

            const res = await a.client.get(PATH(b.ctx.listId));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("list.not_found");
        });

        it("never leaks another workspace's task data", async () => {
            const a = await setup();
            const b = await setup();
            await insertTask(b.ctx, { id: "t-secret", name: "secret-task-xyz" });

            const res = await a.client.get(PATH(b.ctx.listId));
            expect(JSON.stringify(res.body)).not.toContain("secret-task-xyz");
        });

        it("ignores a ?workspace_id query param (caller stays token-scoped)", async () => {
            const a = await setup();
            const b = await setup();
            await insertTask(a.ctx, { id: "t-a" });

            const res = await a.client.get(
                `${PATH(a.ctx.listId)}?workspace_id=${b.ctx.wsId}`,
            );
            expect(idsOf(res.body)).toEqual(["t-a"]);
        });
    });

    // ─── Filtering ────────────────────────────────────────────────────────────
    describe("Filtering", () => {
        it("filters by status id", async () => {
            const { client, ctx } = await setup();
            const other = await makeStatus({ scopeId: ctx.listId, statusGroup: "active" });
            await insertTask(ctx, { id: "t-default" });
            await insertTask(ctx, { id: "t-other", statusId: other.id });

            const res = await client.get(`${PATH(ctx.listId)}?status=${other.id}`);
            expect(idsOf(res.body)).toEqual(["t-other"]);
        });

        it("filters by status_group via the list's statuses", async () => {
            const { client, ctx } = await setup();
            const done = await makeStatus({ scopeId: ctx.listId, statusGroup: "done" });
            await insertTask(ctx, { id: "t-open" });
            await insertTask(ctx, { id: "t-done", statusId: done.id });

            const res = await client.get(`${PATH(ctx.listId)}?status_group=done`);
            expect(idsOf(res.body)).toEqual(["t-done"]);
        });

        it("filters by assignee (any-of)", async () => {
            const { client, ctx, ws } = await setup();
            const u2 = await makeUser({ workspaceId: ws.id });
            const assigned = await insertTask(ctx, { id: "t-assigned" });
            await insertTask(ctx, { id: "t-unassigned" });
            await addAssignee(assigned, u2.id);

            const res = await client.get(`${PATH(ctx.listId)}?assignee=${u2.id}`);
            expect(idsOf(res.body)).toEqual(["t-assigned"]);
        });

        it("filters by tag (any-of)", async () => {
            const { client, ctx, ws } = await setup();
            const tag = await makeTag({ workspaceId: ws.id });
            const tagged = await insertTask(ctx, { id: "t-tagged" });
            await insertTask(ctx, { id: "t-untagged" });
            await addTaskTag(tagged, tag.id);

            const res = await client.get(`${PATH(ctx.listId)}?tag=${tag.id}`);
            expect(idsOf(res.body)).toEqual(["t-tagged"]);
        });

        it("filters by priority (csv)", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-p1", priority: 1 });
            await insertTask(ctx, { id: "t-p2", priority: 2 });
            await insertTask(ctx, { id: "t-p3", priority: 3 });

            const res = await client.get(`${PATH(ctx.listId)}?priority=1,2`);
            expect(idsOf(res.body).sort()).toEqual(["t-p1", "t-p2"]);
        });

        it("filters by task_type (csv)", async () => {
            const { client, ctx, ws } = await setup();
            const bug = await makeTaskType({ workspaceId: ws.id });
            await insertTask(ctx, { id: "t-default" });
            await insertTask(ctx, { id: "t-bug", taskTypeId: bug.id });

            const res = await client.get(`${PATH(ctx.listId)}?task_type=${bug.id}`);
            expect(idsOf(res.body)).toEqual(["t-bug"]);
        });

        it("filters by reviewer", async () => {
            const { client, ctx, ws } = await setup();
            const reviewer = await makeUser({ workspaceId: ws.id });
            await insertTask(ctx, { id: "t-none" });
            await insertTask(ctx, { id: "t-rev", reviewerId: reviewer.id });

            const res = await client.get(`${PATH(ctx.listId)}?reviewer=${reviewer.id}`);
            expect(idsOf(res.body)).toEqual(["t-rev"]);
        });

        it("filters by sprint", async () => {
            const { client, ctx, ws } = await setup();
            const sprintId = await insertSprint(ws.id);
            await insertTask(ctx, { id: "t-backlog" });
            await insertTask(ctx, { id: "t-sprint", sprintId });

            const res = await client.get(`${PATH(ctx.listId)}?sprint=${sprintId}`);
            expect(idsOf(res.body)).toEqual(["t-sprint"]);
        });

        it("filters by bug_severity (csv)", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-s0", bugSeverity: "S0" });
            await insertTask(ctx, { id: "t-s2", bugSeverity: "S2" });
            await insertTask(ctx, { id: "t-none" });

            const res = await client.get(`${PATH(ctx.listId)}?bug_severity=S0`);
            expect(idsOf(res.body)).toEqual(["t-s0"]);
        });

        it("matches q against the name (case-insensitive)", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-pack", name: "Pack order" });
            await insertTask(ctx, { id: "t-ship", name: "Ship parcel" });

            const res = await client.get(`${PATH(ctx.listId)}?q=PACK`);
            expect(idsOf(res.body)).toEqual(["t-pack"]);
        });

        it("matches q against custom_id", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-1", name: "alpha", customId: "ORD-42" });
            await insertTask(ctx, { id: "t-2", name: "beta", customId: "CMP-7" });

            const res = await client.get(`${PATH(ctx.listId)}?q=ORD-42`);
            expect(idsOf(res.body)).toEqual(["t-1"]);
        });

        it("treats a LIKE % in q as a literal (escaped)", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-pct", name: "50% off" });
            await insertTask(ctx, { id: "t-plain", name: "plain" });

            const res = await client.get(`${PATH(ctx.listId)}?q=${encodeURIComponent("%")}`);
            expect(idsOf(res.body)).toEqual(["t-pct"]);
        });

        it("treats a LIKE _ in q as a literal (escaped)", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-us", name: "a_c" });
            await insertTask(ctx, { id: "t-x", name: "aXc" });

            const res = await client.get(`${PATH(ctx.listId)}?q=${encodeURIComponent("a_c")}`);
            expect(idsOf(res.body)).toEqual(["t-us"]);
        });

        it("filters by due date range (inclusive boundaries)", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-27", dueDate: "2026-05-27" });
            await insertTask(ctx, { id: "t-28", dueDate: "2026-05-28" });
            await insertTask(ctx, { id: "t-30", dueDate: "2026-05-30" });
            await insertTask(ctx, { id: "t-31", dueDate: "2026-05-31" });

            const res = await client.get(
                `${PATH(ctx.listId)}?due_after=2026-05-28&due_before=2026-05-30`,
            );
            expect(idsOf(res.body).sort()).toEqual(["t-28", "t-30"]);
        });

        it("combines filters with AND semantics", async () => {
            const { client, ctx, ws } = await setup();
            const u2 = await makeUser({ workspaceId: ws.id });
            const hit = await insertTask(ctx, { id: "t-hit", priority: 1 });
            const wrongPrio = await insertTask(ctx, { id: "t-wp", priority: 3 });
            await addAssignee(hit, u2.id);
            await addAssignee(wrongPrio, u2.id);
            await insertTask(ctx, { id: "t-unassigned", priority: 1 });

            const res = await client.get(
                `${PATH(ctx.listId)}?priority=1&assignee=${u2.id}`,
            );
            expect(idsOf(res.body)).toEqual(["t-hit"]);
        });
    });

    // ─── j. Pagination ────────────────────────────────────────────────────────
    describe("Pagination", () => {
        const seedN = async (ctx: Ctx, n: number) => {
            for (let i = 0; i < n; i++) {
                await insertTask(ctx, { id: `t-${String(i).padStart(3, "0")}` });
            }
        };

        it("walks first → middle → last page with a stable cursor, no dups", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 5);

            const p1 = await client.get(`${PATH(ctx.listId)}?limit=2`);
            expect(idsOf(p1.body)).toEqual(["t-000", "t-001"]);
            expect(pageOf(p1.body).has_more).toBe(true);

            const p2 = await client.get(
                `${PATH(ctx.listId)}?limit=2&cursor=${pageOf(p1.body).next_cursor}`,
            );
            expect(idsOf(p2.body)).toEqual(["t-002", "t-003"]);
            expect(pageOf(p2.body).has_more).toBe(true);

            const p3 = await client.get(
                `${PATH(ctx.listId)}?limit=2&cursor=${pageOf(p2.body).next_cursor}`,
            );
            expect(idsOf(p3.body)).toEqual(["t-004"]);
            expect(pageOf(p3.body).has_more).toBe(false);
            expect(pageOf(p3.body).next_cursor).toBeNull();

            const all = [...idsOf(p1.body), ...idsOf(p2.body), ...idsOf(p3.body)];
            expect(new Set(all).size).toBe(5);
        });

        it("reports total_estimate as the full count regardless of page size", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 5);

            const res = await client.get(`${PATH(ctx.listId)}?limit=2`);
            expect(res.body.data).toHaveLength(2);
            expect(pageOf(res.body).total_estimate).toBe(5);
        });

        it("encodes next_cursor as the opaque base64url of an internal_id", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 3);

            const res = await client.get(`${PATH(ctx.listId)}?limit=2`);
            const decoded = Buffer.from(
                pageOf(res.body).next_cursor!,
                "base64url",
            ).toString("utf8");

            expect(decoded).toMatch(/^\d+$/);
        });

        it("returns an empty page for a cursor past the end", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 3);
            const beyond = Buffer.from("999999", "utf8").toString("base64url");

            const res = await client.get(`${PATH(ctx.listId)}?cursor=${beyond}`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(pageOf(res.body).has_more).toBe(false);
        });

        it("defaults to a 50-row page", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 51);

            const res = await client.get(PATH(ctx.listId));
            expect(res.body.data).toHaveLength(50);
            expect(pageOf(res.body).has_more).toBe(true);
            expect(pageOf(res.body).total_estimate).toBe(51);
        });

        it("clamps an over-max limit to 200", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 201);

            const res = await client.get(`${PATH(ctx.listId)}?limit=500`);
            expect(res.body.data).toHaveLength(200);
            expect(pageOf(res.body).has_more).toBe(true);
            expect(pageOf(res.body).total_estimate).toBe(201);
        });

        it("honours limit=1 (single row, has_more)", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 3);

            const res = await client.get(`${PATH(ctx.listId)}?limit=1`);
            expect(idsOf(res.body)).toEqual(["t-000"]);
            expect(pageOf(res.body).has_more).toBe(true);
        });

        it("does not duplicate or skip when a task is inserted mid-pagination", async () => {
            const { client, ctx } = await setup();
            await seedN(ctx, 4); // t-000..t-003

            const p1 = await client.get(`${PATH(ctx.listId)}?limit=2`);
            expect(idsOf(p1.body)).toEqual(["t-000", "t-001"]);

            // A new task gets a HIGHER internal_id → must appear only at the tail.
            await insertTask(ctx, { id: "t-new" });

            const p2 = await client.get(
                `${PATH(ctx.listId)}?limit=10&cursor=${pageOf(p1.body).next_cursor}`,
            );
            expect(idsOf(p2.body)).toEqual(["t-002", "t-003", "t-new"]);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode name (emoji + Bangla + RTL) and matches via q", async () => {
            const { client, ctx } = await setup();
            const name = "নতুন অর্ডার 🎉 مرحبا";
            await insertTask(ctx, { id: "t-uni", name });

            const res = await client.get(PATH(ctx.listId));
            expect(dataOf(res.body)[0].name).toBe(name);

            const hit = await client.get(
                `${PATH(ctx.listId)}?q=${encodeURIComponent("অর্ডার")}`,
            );
            expect(idsOf(hit.body)).toEqual(["t-uni"]);
        });

        it("returns a max-length (500-char) name intact", async () => {
            const { client, ctx } = await setup();
            const name = "n".repeat(500);
            await insertTask(ctx, { id: "t-long", name });

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);
            expect(row.name).toBe(name);
            expect((row.name as string).length).toBe(500);
        });

        it("returns priority 0 and 4 boundary values", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-p0", priority: 0 });
            await insertTask(ctx, { id: "t-p4", priority: 4 });

            const rows = dataOf((await client.get(PATH(ctx.listId))).body);
            expect(rows.find((r) => r.id === "t-p0")?.priority).toBe(0);
            expect(rows.find((r) => r.id === "t-p4")?.priority).toBe(4);
        });

        it("returns custom_id as null when unset", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-nc", customId: null });

            const [row] = dataOf((await client.get(PATH(ctx.listId))).body);
            expect(row.custom_id).toBeNull();
        });
    });

    // ─── l. Side effects (a read mutates nothing) ─────────────────────────────
    describe("Side effects", () => {
        it("writes no task_activity rows", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);
            await client.get(PATH(ctx.listId));
            expect(await countTaskActivity()).toBe(0);
        });

        it("writes no workspace_activity rows", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);
            await client.get(PATH(ctx.listId));
            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("does not change the task row count", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);
            await insertTask(ctx);
            const before = await countTasks();
            await client.get(PATH(ctx.listId));
            expect(await countTasks()).toBe(before);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent results", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx, { id: "t-000" });
            await insertTask(ctx, { id: "t-001" });
            await insertTask(ctx, { id: "t-002" });

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(PATH(ctx.listId))),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(idsOf(r.body)).toEqual(["t-000", "t-001", "t-002"]);
            }
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(PATH(ctx.listId));
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("echoes a client X-Request-Id and matches the 404 envelope's request_id", async () => {
            const { client } = await setup();
            const rid = "rid-tasks-404-789";
            const res = await client.get(PATH(fakeId("l"))).set("X-Request-Id", rid);
            expect(res.status).toBe(404);
            expect(res.get("x-request-id")).toBe(rid);
            expect(res.body.error.request_id).toBe(rid);
        });

        it("returns 404 route.not_found for a POST to the collection path", async () => {
            const { client, ctx } = await setup();
            const res = await client.post(PATH(ctx.listId));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 route.not_found for a deep bogus path", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(`${PATH(ctx.listId)}/deep/bogus`);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── Exploratory (Step 7) ─────────────────────────────────────────────────
    describe("Exploratory", () => {
        it("rejects a duplicated ?limit param (array) as 422, not 500", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(`${PATH(ctx.listId)}?limit=1&limit=2`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects a duplicated ?status param (array) as 422, not 500", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(`${PATH(ctx.listId)}?status=a&status=b`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 400 pagination.invalid_cursor for a non-base64url cursor", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(`${PATH(ctx.listId)}?cursor=!!!bad`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("returns 400 pagination.invalid_cursor for a cursor that decodes to non-digits", async () => {
            const { client, ctx } = await setup();
            const bad = Buffer.from("not-a-number", "utf8").toString("base64url");
            const res = await client.get(`${PATH(ctx.listId)}?cursor=${bad}`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("returns an empty page for a huge-integer cursor", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);
            const huge = Buffer.from(
                "999999999999999999",
                "utf8",
            ).toString("base64url");

            const res = await client.get(`${PATH(ctx.listId)}?cursor=${huge}`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        it("survives an absurdly long (10k-char) base64url cursor", async () => {
            const { client, ctx } = await setup();
            const res = await client.get(`${PATH(ctx.listId)}?cursor=${"A".repeat(10000)}`);
            // "A…"(base64url) decodes to NUL bytes → non-digit → 400, never 500.
            expect([200, 400]).toContain(res.status);
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);
            const res = await client
                .get(PATH(ctx.listId))
                .set("Accept", "text/plain, */*");
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });

        it("ignores an unexpected Content-Type on a GET", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);
            const res = await client
                .get(PATH(ctx.listId))
                .set("Content-Type", "application/xml");
            expect(res.status).toBe(200);
        });

        it("matches the route with a trailing slash", async () => {
            const { client, ctx } = await setup();
            await insertTask(ctx);
            const res = await client.get(`${PATH(ctx.listId)}/`);
            expect(res.status).toBe(200);
        });
    });
});
