import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
    makeList,
    makeStatus,
    makeTag,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    tasks,
    taskAssignees,
    taskWatchers,
    taskTags,
    taskActivity,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/tasks/:id` (§10 #2) — read one fully-hydrated task by
 * internal id or custom_id. Built already (TasksController.getById); this suite
 * is the Prompt-4 coverage it was missing.
 *
 * N/A categories (documented): pagination (single resource); validation body
 * (none — only the :id param); conflict/idempotency (a pure read).
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/tasks/${id}`;

/** The exact Appendix-A `Task` wire keys this endpoint returns (47). */
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
    "checklist_items_total",
    "checklist_items_done",
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

/** Build a workspace + a member client + one task, returning the context. */
const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

const setCustomId = async (taskId: string, customId: string) => {
    await getDb()
        .update(tasks)
        .set({ customId })
        .where(eq(tasks.id, taskId));
};

const addAssignee = async (taskId: string, userId: string) => {
    await getDb().insert(taskAssignees).values({ taskId, userId });
};
const addWatcher = async (taskId: string, userId: string) => {
    await getDb().insert(taskWatchers).values({ taskId, userId });
};
const addTaskTag = async (taskId: string, tagId: string) => {
    await getDb().insert(taskTags).values({ taskId, tagId });
};
const countActivity = async (taskId: string): Promise<number> =>
    (
        await getDb()
            .select({ id: taskActivity.id })
            .from(taskActivity)
            .where(eq(taskActivity.taskId, taskId))
    ).length;

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/tasks/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with a bare, fully-hydrated Task by internal id", async () => {
            const { client, task } = await seed();

            const res = await client.get(PATH(task.id));

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(task.id);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body.assignees).toEqual([]);
            expect(res.body.watchers).toEqual([]);
            expect(res.body.tags).toEqual([]);
            expect(res.body.custom_field_values).toEqual({});
        });

        it("resolves by custom_id too", async () => {
            const { client, task } = await seed();
            await setCustomId(task.id, "ORD-1042");

            const res = await client.get(PATH("ORD-1042"));

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(task.id);
            expect(res.body.custom_id).toBe("ORD-1042");
        });

        it("shapes the body as exactly the 47 wire fields", async () => {
            const { client, task } = await seed();

            const res = await client.get(PATH(task.id));

            expect(Object.keys(res.body).sort()).toEqual(TASK_KEYS);
        });

        it("hydrates assignees / watchers / tags inline", async () => {
            const { ws, client, task } = await seed();
            const u2 = await makeUser({ workspaceId: ws.id, role: "member" });
            const tag = await makeTag({ workspaceId: ws.id });
            await addAssignee(task.id, u2.id);
            await addWatcher(task.id, u2.id);
            await addTaskTag(task.id, tag.id);

            const res = await client.get(PATH(task.id));

            expect(res.body.assignees).toEqual([u2.id]);
            expect(res.body.watchers).toEqual([u2.id]);
            expect(res.body.tags).toEqual([tag.id]);
        });

        it("emits created_at/updated_at as ISO-8601 and never leaks internal_id", async () => {
            const { client, task } = await seed();

            const res = await client.get(PATH(task.id));

            expect(res.body.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );
            expect(res.body.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(res.body).not.toHaveProperty("internal_id");
            expect(res.body).not.toHaveProperty("internalId");
        });

        it("returns an archived task (detail read ignores the soft-delete filter)", async () => {
            const { ws, user, client } = await seed();
            const archived = await makeTask({
                workspaceId: ws.id,
                createdBy: user.id,
                archivedAt: new Date(),
            });

            const res = await client.get(PATH(archived.id));

            expect(res.status).toBe(200);
            expect(res.body.archived_at).not.toBeNull();
        });
    });

    // ─── b. Validation (422) ────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 for an over-length id (65 chars)", async () => {
            const { client } = await seed();

            const res = await client.get(PATH("a".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    // ─── c. Authentication (401) ──────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();

            const res = await http.get(PATH("t-anything"));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();

            const res = await http
                .get(PATH("t-anything"))
                .set("Authorization", "Bearer not.a.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const { user } = await seed();
            const token = signAccess(
                { id: user.id, workspaceId: user.workspaceId, role: user.role },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();

            const res = await http
                .get(PATH("t-anything"))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── d. Authorization (🔐 any member, incl. guest) ───────────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to read a task (200)`, async () => {
                const ws = await makeWorkspace();
                const creator = await makeUser({
                    workspaceId: ws.id,
                    role: "member",
                });
                const task = await makeTask({
                    workspaceId: ws.id,
                    createdBy: creator.id,
                });
                const caller = await makeUser({ workspaceId: ws.id, role });
                const client = await makeLoggedInClient(caller);

                const res = await client.get(PATH(task.id));

                expect(res.status).toBe(200);
            });
        }
    });

    // ─── e. Not found ──────────────────────────────────────────────────────────
    describe("Not found", () => {
        it("returns 404 task.not_found for an id that exists nowhere", async () => {
            const { client } = await seed();

            const res = await client.get(PATH("t-does-not-exist"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    // ─── g. Tenant / workspace isolation ──────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 (not 200) for a task in another workspace", async () => {
            const { client } = await seed(); // workspace 1
            const ws2 = await makeWorkspace();
            const u2 = await makeUser({ workspaceId: ws2.id, role: "member" });
            const otherTask = await makeTask({
                workspaceId: ws2.id,
                createdBy: u2.id,
                name: "Cross tenant secret",
            });

            const res = await client.get(PATH(otherTask.id));

            expect(res.status).toBe(404);
            expect(JSON.stringify(res.body)).not.toContain("Cross tenant secret");
        });
    });

    // ─── k. Edge values ─────────────────────────────────────────────────────────
    describe("Edge values", () => {
        it("treats a SQL-injection-shaped id as a literal (404, no 500)", async () => {
            const { client } = await seed();

            const res = await client.get(
                PATH("t'); DROP TABLE tasks;--".slice(0, 64)),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });

    // ─── l. Side-effects ─────────────────────────────────────────────────────────
    describe("Side-effects", () => {
        it("writes no task_activity row on a successful read", async () => {
            const { client, task } = await seed();

            await client.get(PATH(task.id));

            expect(await countActivity(task.id)).toBe(0);
        });
    });

    // ─── n. Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const { client, task } = await seed();

            const res = await client.get(PATH(task.id));

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["x-request-id"]).toMatch(/^req_/);
        });
    });
});
