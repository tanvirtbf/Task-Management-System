import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeTask,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    notifications,
    taskActivity,
    taskAssignees,
    taskWatchers,
    tasks,
} from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/tasks/:id/assignees` (§11).
 *
 * Patterns mirror `tests/tags/list.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - `oneOff()` for unauthenticated / crafted-token cases; `makeLoggedInClient`
 *     for authed calls.
 *   - `beforeEach` (setup-each.ts) truncates every table — tests are order-free.
 *
 * The endpoint adds assignees (idempotent), auto-watches them, writes a
 * `task_activity` row, fires an `assigned` notification (never to the actor),
 * bumps the task ETag, and returns 204. Body is `{ user_id }` or `{ user_ids }`.
 */

const url = (taskId: string) => `/api/v1/tasks/${taskId}/assignees`;

// ─── DB inspection helpers ────────────────────────────────────────────────────
const getAssignees = async (taskId: string) => {
    const db = getDb();
    return db
        .select()
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, taskId));
};

const getWatchers = async (taskId: string) => {
    const db = getDb();
    return db.select().from(taskWatchers).where(eq(taskWatchers.taskId, taskId));
};

const getActivity = async (taskId: string) => {
    const db = getDb();
    return db
        .select()
        .from(taskActivity)
        .where(eq(taskActivity.taskId, taskId));
};

const getNotifications = async (taskId: string) => {
    const db = getDb();
    return db
        .select()
        .from(notifications)
        .where(
            and(
                eq(notifications.entityType, "task"),
                eq(notifications.entityId, taskId),
            ),
        );
};

const getTaskUpdatedAt = async (taskId: string): Promise<Date> => {
    const db = getDb();
    const [row] = await db
        .select({ updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
    return row.updatedAt;
};

const setTaskUpdatedAt = async (taskId: string, when: Date): Promise<void> => {
    const db = getDb();
    await db.update(tasks).set({ updatedAt: when }).where(eq(tasks.id, taskId));
};

/** Mint a raw access token for negative-auth cases. */
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

/** Common arrangement: workspace + actor (logged in) + an active assignee + task. */
const setup = async (
    opts: { actorRole?: Role; archived?: boolean } = {},
) => {
    const ws = await makeWorkspace();
    const actor = await makeUser({
        workspaceId: ws.id,
        role: opts.actorRole ?? "member",
    });
    const assignee = await makeUser({ workspaceId: ws.id });
    const task = await makeTask({
        workspaceId: ws.id,
        createdBy: actor.id,
        archivedAt: opts.archived ? new Date() : null,
    });
    const client = await makeLoggedInClient(actor);
    return { ws, actor, assignee, task, client };
};

const OLD = new Date("2020-01-01T00:00:00Z");

// This suite shares a MySQL server with other test suites; `resetTestDb`'s
// per-test TRUNCATEs can queue behind concurrent DDL. Raise the default
// test/hook timeout so a busy-but-not-deadlocked server doesn't spuriously fail
// setup. Per-test overrides below (concurrency cases) still apply.
jest.setTimeout(30000);

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/tasks/:id/assignees", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body for a single user_id", async () => {
            const { assignee, task, client } = await setup();

            const res = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
        });

        it("assigns several users in one call with user_ids[]", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const a = await makeUser({ workspaceId: ws.id });
            const b = await makeUser({ workspaceId: ws.id });
            const c = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url(task.id))
                .send({ user_ids: [a.id, b.id, c.id] });

            expect(res.status).toBe(204);
            const rows = await getAssignees(task.id);
            expect(rows.map((r) => r.userId).sort()).toEqual(
                [a.id, b.id, c.id].sort(),
            );
        });
    });

    // ─── b. Validation (422 validation.failed) ────────────────────────────────
    describe("Validation", () => {
        it("422 when the body is empty (neither user_id nor user_ids)", async () => {
            const { task, client } = await setup();
            const res = await client.post(url(task.id)).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when user_ids is an empty array", async () => {
            const { task, client } = await setup();
            const res = await client.post(url(task.id)).send({ user_ids: [] });
            expect(res.status).toBe(422);
        });

        it("422 when user_id is not a string", async () => {
            const { task, client } = await setup();
            const res = await client.post(url(task.id)).send({ user_id: 123 });
            expect(res.status).toBe(422);
        });

        it("422 when a user_ids element is not a string", async () => {
            const { task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_ids: [123] });
            expect(res.status).toBe(422);
        });

        it("422 when user_ids exceeds 50 entries", async () => {
            const { task, client } = await setup();
            const ids = Array.from({ length: 51 }, (_, i) => `u-${i}`);
            const res = await client.post(url(task.id)).send({ user_ids: ids });
            expect(res.status).toBe(422);
        });

        it("422 when user_id is an empty string", async () => {
            const { task, client } = await setup();
            const res = await client.post(url(task.id)).send({ user_id: "" });
            expect(res.status).toBe(422);
        });

        it("422 when user_id is whitespace-only", async () => {
            const { task, client } = await setup();
            const res = await client.post(url(task.id)).send({ user_id: "   " });
            expect(res.status).toBe(422);
        });

        it("422 when user_id exceeds 64 characters", async () => {
            const { task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_id: "u-" + "x".repeat(64) });
            expect(res.status).toBe(422);
        });

        it("422 when user_id and user_ids are both null", async () => {
            const { task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_id: null, user_ids: null });
            expect(res.status).toBe(422);
        });

        it("422 carries a details[] array describing the offending field", async () => {
            const { task, client } = await setup();
            const res = await client.post(url(task.id)).send({});
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(res.body.error.details.length).toBeGreaterThan(0);
        });

        it("writes nothing to task_assignees on a validation failure", async () => {
            const { task, client } = await setup();
            await client.post(url(task.id)).send({ user_ids: [] });
            expect(await getAssignees(task.id)).toHaveLength(0);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token when no token is supplied", async () => {
            const { task, assignee } = await setup();
            const http = await oneOff();
            const res = await http
                .post(url(task.id))
                .send({ user_id: assignee.id });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a malformed bearer token", async () => {
            const { task, assignee } = await setup();
            const http = await oneOff();
            const res = await http
                .post(url(task.id))
                .set("Authorization", "Bearer not.a.real.jwt")
                .send({ user_id: assignee.id });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const { task, actor, assignee } = await setup();
            const token = signAccess(
                { id: actor.id, workspaceId: actor.workspaceId, role: "member" },
                "not-the-real-secret",
                { expiresIn: "15m" },
            );
            const http = await oneOff();
            const res = await http
                .post(url(task.id))
                .set("Authorization", `Bearer ${token}`)
                .send({ user_id: assignee.id });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { task, actor, assignee } = await setup();
            const token = signAccess(
                { id: actor.id, workspaceId: actor.workspaceId, role: "member" },
                Config.ACCESS_TOKEN_SECRET!,
                { expiresIn: -10 },
            );
            const http = await oneOff();
            const res = await http
                .post(url(task.id))
                .set("Authorization", `Bearer ${token}`)
                .send({ user_id: assignee.id });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("serves a deactivated actor holding a valid token (stateless JWT; matches siblings)", async () => {
            // express-jwt does not re-check DB status; an access token stays
            // valid until its ≤15-min expiry. Documented, intentional — the
            // actor's status is not a gate, only the assignees' status is.
            const ws = await makeWorkspace();
            const actor = await makeUser({
                workspaceId: ws.id,
                status: "deactivated",
            });
            const assignee = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: assignee.id });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });

            expect(res.status).toBe(204);
            expect(await getAssignees(task.id)).toHaveLength(1);
        });
    });

    // ─── d. Authorization (task.assign — every INTERNAL role holds it) ─────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member"];
        for (const role of roles) {
            it(`allows a ${role} to add an assignee (204)`, async () => {
                const { assignee, task, client } = await setup({
                    actorRole: role,
                });
                const res = await client
                    .post(url(task.id))
                    .send({ user_id: assignee.id });
                expect(res.status).toBe(204);
            });
        }

        // F28 (ISS-094, D12.1): guests held `task.assign` via the seeded role's
        // pre-RBAC breadth. Revoked — an external collaborator does not staff
        // the workspace's tasks. See tests/rbac/system-roles.test.ts.
        it("REFUSES a guest (403) — task.assign is no longer a guest grant", async () => {
            const { assignee, task, client } = await setup({
                actorRole: "guest",
            });
            const res = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });
            expect(res.status).toBe(403);
        });
    });

    // ─── e. Resource lifecycle ─────────────────────────────────────────────────
    describe("Resource lifecycle", () => {
        it("404 task.not_found for a task id that does not exist", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const assignee = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url("t-does-not-exist"))
                .send({ user_id: assignee.id });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("409 task.archived when the task is archived", async () => {
            const { assignee, task, client } = await setup({ archived: true });

            const res = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("task.archived");
            expect(await getAssignees(task.id)).toHaveLength(0);
        });
    });

    // ─── g. Tenant / workspace isolation ───────────────────────────────────────
    describe("Workspace isolation", () => {
        it("404 task.not_found when the task is in another workspace", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const actorA = await makeUser({ workspaceId: wsA.id });
            const taskB = await makeTask({ workspaceId: wsB.id });
            const assigneeA = await makeUser({ workspaceId: wsA.id });
            const client = await makeLoggedInClient(actorA);

            const res = await client
                .post(url(taskB.id))
                .send({ user_id: assigneeA.id });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            expect(await getAssignees(taskB.id)).toHaveLength(0);
        });

        it("422 task.invalid_assignee when assigning a user from another workspace", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const actorA = await makeUser({ workspaceId: wsA.id });
            const taskA = await makeTask({ workspaceId: wsA.id, createdBy: actorA.id });
            const foreigner = await makeUser({ workspaceId: wsB.id });
            const client = await makeLoggedInClient(actorA);

            const res = await client
                .post(url(taskA.id))
                .send({ user_id: foreigner.id });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_assignee");
            expect(await getAssignees(taskA.id)).toHaveLength(0);
        });

        it("gives the identical error for a foreign-workspace id and a nonexistent id (no oracle)", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const actorA = await makeUser({ workspaceId: wsA.id });
            const taskA = await makeTask({ workspaceId: wsA.id, createdBy: actorA.id });
            const foreigner = await makeUser({ workspaceId: wsB.id });
            const client = await makeLoggedInClient(actorA);

            const foreignRes = await client
                .post(url(taskA.id))
                .send({ user_id: foreigner.id });
            const ghostRes = await client
                .post(url(taskA.id))
                .send({ user_id: "u-nonexistent-id" });

            expect(foreignRes.status).toBe(422);
            expect(ghostRes.status).toBe(422);
            expect(foreignRes.body.error.code).toBe(ghostRes.body.error.code);
        });
    });

    // ─── h. Idempotency (natural; Idempotency-Key N/A for membership) ──────────
    describe("Idempotency", () => {
        it("re-adding the same user is a 204 no-op (one assignee row only)", async () => {
            const { assignee, task, client } = await setup();

            const first = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });
            const second = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });

            expect(first.status).toBe(204);
            expect(second.status).toBe(204);
            expect(await getAssignees(task.id)).toHaveLength(1);
        });

        it("re-adding writes no extra activity or notification rows", async () => {
            const { assignee, task, client } = await setup();

            await client.post(url(task.id)).send({ user_id: assignee.id });
            await client.post(url(task.id)).send({ user_id: assignee.id });

            expect(await getActivity(task.id)).toHaveLength(1);
            expect(await getNotifications(task.id)).toHaveLength(1);
        });

        it("a no-op re-add does NOT bump updated_at", async () => {
            const { assignee, task, client } = await setup();
            await client.post(url(task.id)).send({ user_id: assignee.id });
            await setTaskUpdatedAt(task.id, OLD);

            await client.post(url(task.id)).send({ user_id: assignee.id });

            expect((await getTaskUpdatedAt(task.id)).getTime()).toBe(
                OLD.getTime(),
            );
        });

        it("a mixed new+existing request only adds the genuinely new user", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const a = await makeUser({ workspaceId: ws.id });
            const b = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);

            await client.post(url(task.id)).send({ user_id: a.id });
            await client.post(url(task.id)).send({ user_ids: [a.id, b.id] });

            const rows = await getAssignees(task.id);
            expect(rows.map((r) => r.userId).sort()).toEqual([a.id, b.id].sort());
            // a logged once (first call); b logged once (second call) → 2 total.
            expect(await getActivity(task.id)).toHaveLength(2);
        });
    });

    // ─── i. Concurrency ────────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("25 parallel identical assigns produce exactly one of each side effect", async () => {
            const { actor, assignee, task, client } = await setup();
            void actor;

            const results = await Promise.all(
                Array.from({ length: 25 }, () =>
                    client.post(url(task.id)).send({ user_id: assignee.id }),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await getAssignees(task.id)).toHaveLength(1);
            expect(await getWatchers(task.id)).toHaveLength(1);
            expect(await getActivity(task.id)).toHaveLength(1);
            expect(await getNotifications(task.id)).toHaveLength(1);
        }, 30000);

        it("10 parallel assigns of distinct users all land (10 rows)", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);
            const users = await Promise.all(
                Array.from({ length: 10 }, () =>
                    makeUser({ workspaceId: ws.id }),
                ),
            );

            const results = await Promise.all(
                users.map((u) =>
                    client.post(url(task.id)).send({ user_id: u.id }),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await getAssignees(task.id)).toHaveLength(10);
        }, 30000);
    });

    // ─── k. Boundary values ────────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts exactly 50 assignees", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);
            const users = await Promise.all(
                Array.from({ length: 50 }, () =>
                    makeUser({ workspaceId: ws.id }),
                ),
            );

            const res = await client
                .post(url(task.id))
                .send({ user_ids: users.map((u) => u.id) });

            expect(res.status).toBe(204);
            expect(await getAssignees(task.id)).toHaveLength(50);
        }, 30000);

        it("merges user_id and user_ids, de-duplicating overlaps", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const a = await makeUser({ workspaceId: ws.id });
            const b = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url(task.id))
                .send({ user_id: a.id, user_ids: [b.id, a.id] });

            expect(res.status).toBe(204);
            const rows = await getAssignees(task.id);
            expect(rows.map((r) => r.userId).sort()).toEqual([a.id, b.id].sort());
        });

        it("de-duplicates repeated ids inside user_ids", async () => {
            const { assignee, task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_ids: [assignee.id, assignee.id, assignee.id] });
            expect(res.status).toBe(204);
            expect(await getAssignees(task.id)).toHaveLength(1);
        });

        it("422 task.invalid_assignee for a 64-char id that passes validation but does not exist", async () => {
            const { task, client } = await setup();
            const id64 = "u-" + "x".repeat(62); // exactly 64 chars
            expect(id64).toHaveLength(64);
            const res = await client.post(url(task.id)).send({ user_id: id64 });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_assignee");
        });

        it("caps the notification title at 300 chars for a very long task name", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const assignee = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "x".repeat(500),
            });
            const client = await makeLoggedInClient(actor);

            await client.post(url(task.id)).send({ user_id: assignee.id });

            const [n] = await getNotifications(task.id);
            expect(n.title.length).toBeLessThanOrEqual(300);
            expect(n.title.startsWith("You were assigned to ")).toBe(true);
            expect(n.title.endsWith("…")).toBe(true);
        });

        it("handles a unicode task name without error", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const assignee = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({
                workspaceId: ws.id,
                createdBy: actor.id,
                name: "ঈদ 🔥 عرض",
            });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });

            expect(res.status).toBe(204);
            const [n] = await getNotifications(task.id);
            expect(n.title).toContain("ঈদ 🔥 عرض");
        });

        it("422 when a user_ids element is an empty string", async () => {
            const { task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_ids: [""] });
            expect(res.status).toBe(422);
        });
    });

    // ─── l. Side effects ───────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("records assigned_by as the calling actor", async () => {
            const { actor, assignee, task, client } = await setup();
            await client.post(url(task.id)).send({ user_id: assignee.id });
            const [row] = await getAssignees(task.id);
            expect(row.userId).toBe(assignee.id);
            expect(row.assignedBy).toBe(actor.id);
        });

        it("auto-watches the newly assigned user", async () => {
            const { assignee, task, client } = await setup();
            await client.post(url(task.id)).send({ user_id: assignee.id });
            const watchers = await getWatchers(task.id);
            expect(watchers.map((w) => w.userId)).toEqual([assignee.id]);
        });

        it("writes an assignee_added activity row with actor and context", async () => {
            const { actor, assignee, task, client } = await setup();
            await client.post(url(task.id)).send({ user_id: assignee.id });
            const [act] = await getActivity(task.id);
            expect(act.action).toBe("assignee_added");
            expect(act.actorId).toBe(actor.id);
            expect(act.context).toEqual({ user_id: assignee.id });
        });

        it("fires an `assigned` notification to the assignee", async () => {
            const { actor, assignee, task, client } = await setup();
            await client.post(url(task.id)).send({ user_id: assignee.id });
            const [n] = await getNotifications(task.id);
            expect(n.userId).toBe(assignee.id);
            expect(n.type).toBe("assigned");
            expect(n.entityType).toBe("task");
            expect(n.entityId).toBe(task.id);
            expect(n.actorId).toBe(actor.id);
            expect(n.isRead).toBe(false);
        });

        it("does NOT notify the actor about a self-assignment", async () => {
            const { actor, task, client } = await setup();
            await client.post(url(task.id)).send({ user_id: actor.id });
            expect(await getAssignees(task.id)).toHaveLength(1);
            expect(await getNotifications(task.id)).toHaveLength(0);
        });

        it("notifies only the other user when assigning self + another", async () => {
            const { actor, assignee, task, client } = await setup();
            await client
                .post(url(task.id))
                .send({ user_ids: [actor.id, assignee.id] });
            const notifs = await getNotifications(task.id);
            expect(notifs).toHaveLength(1);
            expect(notifs[0].userId).toBe(assignee.id);
        });

        it("bumps updated_at on a real add", async () => {
            const { assignee, task, client } = await setup();
            await setTaskUpdatedAt(task.id, OLD);

            await client.post(url(task.id)).send({ user_id: assignee.id });

            expect((await getTaskUpdatedAt(task.id)).getTime()).toBeGreaterThan(
                OLD.getTime(),
            );
        });
    });

    // ─── m. Cleanup / rollback ─────────────────────────────────────────────────
    describe("Cleanup / rollback", () => {
        it("a mixed valid+invalid batch writes nothing (all-or-nothing)", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const valid = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url(task.id))
                .send({ user_ids: [valid.id, "u-bogus-id"] });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_assignee");
            expect(await getAssignees(task.id)).toHaveLength(0);
            expect(await getWatchers(task.id)).toHaveLength(0);
            expect(await getActivity(task.id)).toHaveLength(0);
            expect(await getNotifications(task.id)).toHaveLength(0);
        });

        it("422 task.invalid_assignee for a deactivated assignee", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const dead = await makeUser({ workspaceId: ws.id, status: "deactivated" });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url(task.id))
                .send({ user_id: dead.id });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_assignee");
        });

        it("422 task.invalid_assignee for an invited (not-yet-active) assignee", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const invited = await makeUser({ workspaceId: ws.id, status: "invited" });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);

            const res = await client
                .post(url(task.id))
                .send({ user_id: invited.id });

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("task.invalid_assignee");
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("204 response carries an X-Request-Id header", async () => {
            const { assignee, task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_id: assignee.id });
            expect(res.status).toBe(204);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope with matching request_id on 401", async () => {
            const { task, assignee } = await setup();
            const http = await oneOff();
            const res = await http
                .post(url(task.id))
                .send({ user_id: assignee.id });
            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("404 route.not_found for a bogus deep path under the task", async () => {
            const { task } = await setup();
            const http = await oneOff();
            const res = await http.post(`${url(task.id)}/extra/bogus`);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("404 route.not_found for GET on the assignees URL (wrong method)", async () => {
            const { task, assignee, client } = await setup();
            void assignee;
            const res = await client.get(url(task.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── Exploratory probes (Step 7) ────────────────────────────────────────────
    describe("Exploratory", () => {
        it("ignores unknown extra body fields and never escalates", async () => {
            const { assignee, task, client } = await setup();
            const res = await client.post(url(task.id)).send({
                user_id: assignee.id,
                role: "owner",
                workspace_id: "ws-attacker",
                assigned_by: "u-someone-else",
            });
            expect(res.status).toBe(204);
            const [row] = await getAssignees(task.id);
            // assigned_by is taken from the token, never the body.
            expect(row.assignedBy).not.toBe("u-someone-else");
        });

        it("ignores a deeply nested extra field", async () => {
            const { assignee, task, client } = await setup();
            let nested: object = { leaf: true };
            for (let i = 0; i < 20; i++) nested = { wrap: nested };
            const res = await client
                .post(url(task.id))
                .send({ user_id: assignee.id, payload: nested });
            expect(res.status).toBe(204);
        });

        it("422 for an absurdly long user_id (10k chars)", async () => {
            const { task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_id: "u-" + "x".repeat(10000) });
            expect(res.status).toBe(422);
        });

        it("422 when the body is form-urlencoded (unparsed → no fields)", async () => {
            const { task, assignee, client } = await setup();
            const res = await client
                .post(url(task.id))
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send(`user_id=${assignee.id}`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("trims surrounding whitespace on an id and matches the member", async () => {
            const { assignee, task, client } = await setup();
            const res = await client
                .post(url(task.id))
                .send({ user_id: `  ${assignee.id}  ` });
            expect(res.status).toBe(204);
            const [row] = await getAssignees(task.id);
            expect(row.userId).toBe(assignee.id);
        });

        it("survives 50 parallel distinct-user assigns to one task (pool stays healthy)", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({ workspaceId: ws.id });
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            const client = await makeLoggedInClient(actor);
            const users = await Promise.all(
                Array.from({ length: 50 }, () =>
                    makeUser({ workspaceId: ws.id }),
                ),
            );

            const results = await Promise.all(
                users.map((u) =>
                    client.post(url(task.id)).send({ user_id: u.id }),
                ),
            );

            for (const r of results) expect(r.status).toBe(204);
            expect(await getAssignees(task.id)).toHaveLength(50);
        }, 60000);
    });
});
