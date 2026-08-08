import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    taskActivity,
    workspaceActivity,
    tasks,
    users,
} from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/tasks/:id/activity` (§13) — newest-first, cursor-
 * paginated activity feed for a task, with the `actor` hydrated to the full
 * `User` (or null for a system event). Mirrors the §10 list patterns
 * (list-by-list cursor/envelope + get-by-id parent-404 + side-effects).
 *
 * Real DB writes only; `setup-each-tasks.ts` TRUNCATEs between tests so
 * `task_activity.internal_id` (AUTO_INCREMENT) restarts at 1 each test — so
 * insertion order IS the ascending keyset, and the LAST-inserted row is the
 * FIRST in this newest-first feed.
 *
 * N/A categories (documented): request body (pure read); conflict / idempotency.
 */

jest.setTimeout(30_000);

const PATH = (id: string) => `/api/v1/tasks/${id}/activity`;

const ACTIVITY_KEYS = [
    "action",
    "actor",
    "context",
    "created_at",
    "id",
    "task_id",
].sort();

const USER_KEYS = [
    "avatar_url",
    "created_at",
    "email",
    "first_name",
    "id",
    "last_login_at",
    "last_name",
    "role",
    "status",
    "timezone",
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

/** Workspace + a member client + one task. */
const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    return { ws, user, client, task };
};

interface ActivitySeed {
    taskId: string;
    action: string;
    id?: string;
    actorId?: string | null;
    context?: Record<string, unknown> | null;
}

/** Insert one task_activity row directly (no factory exists). */
const addActivity = async (s: ActivitySeed): Promise<string> => {
    const id = s.id ?? fakeId("act");
    await getDb()
        .insert(taskActivity)
        .values({
            id,
            taskId: s.taskId,
            actorId: s.actorId === undefined ? null : s.actorId,
            action: s.action,
            context: s.context ?? null,
        });
    return id;
};

const countActivity = async (taskId: string): Promise<number> =>
    (
        await getDb()
            .select({ id: taskActivity.id })
            .from(taskActivity)
            .where(eq(taskActivity.taskId, taskId))
    ).length;
const countWorkspaceActivity = async (): Promise<number> =>
    (await getDb().select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;
const countTasks = async (): Promise<number> =>
    (await getDb().select({ id: tasks.id }).from(tasks)).length;

const idsOf = (body: { data: Array<{ id: string }> }) =>
    body.data.map((r) => r.id);

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/tasks/:id/activity", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns the {data,pagination} envelope (200)", async () => {
            const { client, task } = await seed();
            await addActivity({ taskId: task.id, action: "task_created" });

            const res = await client.get(PATH(task.id));
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 1,
            });
        });

        it("each row carries exactly the 6 §13 wire keys (no internal_id / actor_id leak)", async () => {
            const { client, task } = await seed();
            await addActivity({ taskId: task.id, action: "task_created" });

            const res = await client.get(PATH(task.id));
            expect(Object.keys(res.body.data[0]).sort()).toEqual(ACTIVITY_KEYS);
            const raw = JSON.stringify(res.body.data[0]);
            expect(raw).not.toContain("internal_id");
            expect(raw).not.toContain("internalId");
            expect(raw).not.toContain("actor_id");
        });

        it("echoes task_id, action, context and an ISO created_at verbatim", async () => {
            const { client, task } = await seed();
            await addActivity({
                taskId: task.id,
                action: "status_changed",
                context: { from: "s-confirmed", to: "s-packed" },
            });

            const row = (await client.get(PATH(task.id))).body.data[0];
            expect(row.task_id).toBe(task.id);
            expect(row.action).toBe("status_changed");
            expect(row.context).toEqual({ from: "s-confirmed", to: "s-packed" });
            expect(row.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );
        });

        it("returns context as null when the row has none", async () => {
            const { client, task } = await seed();
            await addActivity({ taskId: task.id, action: "completed" });
            const row = (await client.get(PATH(task.id))).body.data[0];
            expect(row.context).toBeNull();
        });

        it("returns an empty page (not 404) for a task with no activity", async () => {
            const { client, task } = await seed();
            const res = await client.get(PATH(task.id));
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 0,
            });
        });

        it("resolves the task by custom_id as well as internal id", async () => {
            const { client, task } = await seed();
            await getDb()
                .update(tasks)
                .set({ customId: "BUG-77" })
                .where(eq(tasks.id, task.id));
            await addActivity({ taskId: task.id, action: "task_created" });

            const res = await client.get(PATH("BUG-77"));
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });

    // ─── k/ordering. Newest-first ─────────────────────────────────────────────
    describe("Ordering (newest-first)", () => {
        it("returns rows by internal_id DESC — last inserted is first", async () => {
            const { client, task } = await seed();
            await addActivity({ taskId: task.id, action: "a1", id: "act-1" });
            await addActivity({ taskId: task.id, action: "a2", id: "act-2" });
            await addActivity({ taskId: task.id, action: "a3", id: "act-3" });

            const res = await client.get(PATH(task.id));
            expect(idsOf(res.body)).toEqual(["act-3", "act-2", "act-1"]);
        });

        it("orders by internal_id, NOT created_at (newest internal_id wins even with the OLDEST timestamp)", async () => {
            // Force created_at to run OPPOSITE to insertion order: the last
            // inserted (highest internal_id) gets the oldest created_at. Only an
            // internal_id-DESC keyset yields [act-3,act-2,act-1]; a created_at-DESC
            // implementation would (non-deterministically) return the reverse.
            const { client, task } = await seed();
            await addActivity({ taskId: task.id, action: "e", id: "act-1" });
            await addActivity({ taskId: task.id, action: "e", id: "act-2" });
            await addActivity({ taskId: task.id, action: "e", id: "act-3" });
            await getDb()
                .update(taskActivity)
                .set({ createdAt: new Date("2020-01-03T00:00:00Z") })
                .where(eq(taskActivity.id, "act-1"));
            await getDb()
                .update(taskActivity)
                .set({ createdAt: new Date("2020-01-02T00:00:00Z") })
                .where(eq(taskActivity.id, "act-2"));
            await getDb()
                .update(taskActivity)
                .set({ createdAt: new Date("2020-01-01T00:00:00Z") })
                .where(eq(taskActivity.id, "act-3"));

            const res = await client.get(PATH(task.id));
            expect(idsOf(res.body)).toEqual(["act-3", "act-2", "act-1"]);
        });
    });

    // ─── j. Pagination ────────────────────────────────────────────────────────
    describe("Pagination", () => {
        const seedN = async (taskId: string, n: number) => {
            for (let i = 1; i <= n; i++) {
                await addActivity({
                    taskId,
                    action: "evt",
                    id: `act-${String(i).padStart(2, "0")}`,
                });
            }
        };

        it("walks first→last with a stable cursor: no dups, no skips", async () => {
            const { client, task } = await seed();
            await seedN(task.id, 5);

            const seen: string[] = [];
            let cursor: string | null = null;
            for (let guard = 0; guard < 10; guard++) {
                const url: string =
                    PATH(task.id) +
                    `?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
                const res = await client.get(url);
                expect(res.status).toBe(200);
                seen.push(...idsOf(res.body));
                cursor = res.body.pagination.next_cursor;
                if (!cursor) break;
            }
            // 5 distinct rows, newest-first, exactly once each.
            expect(seen).toEqual([
                "act-05",
                "act-04",
                "act-03",
                "act-02",
                "act-01",
            ]);
            expect(new Set(seen).size).toBe(5);
        });

        it("sets has_more + a base64url next_cursor on a partial page", async () => {
            const { client, task } = await seed();
            await seedN(task.id, 3);

            const res = await client.get(`${PATH(task.id)}?limit=1`);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.has_more).toBe(true);
            const cursor = res.body.pagination.next_cursor as string;
            expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
            // decodes to a positive integer (an internal_id)
            expect(
                Buffer.from(cursor, "base64url").toString("utf8"),
            ).toMatch(/^\d+$/);
        });

        it("total_estimate is the full count regardless of page size", async () => {
            const { client, task } = await seed();
            await seedN(task.id, 7);
            const res = await client.get(`${PATH(task.id)}?limit=2`);
            expect(res.body.pagination.total_estimate).toBe(7);
        });

        it("a cursor below the smallest internal_id yields an empty page (past-the-end of a DESC feed)", async () => {
            const { client, task } = await seed();
            await seedN(task.id, 2);
            const tiny = Buffer.from("1", "utf8").toString("base64url");
            const res = await client.get(`${PATH(task.id)}?cursor=${tiny}`);
            expect(res.status).toBe(200);
            // internal_id < 1 matches nothing.
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.has_more).toBe(false);
            expect(res.body.pagination.next_cursor).toBeNull();
        });

        it("is cursor-stable: a row inserted mid-pagination never pollutes an older page", async () => {
            const { client, task } = await seed();
            await seedN(task.id, 4); // act-01..act-04 (newest = act-04)

            const page1 = await client.get(`${PATH(task.id)}?limit=2`);
            expect(idsOf(page1.body)).toEqual(["act-04", "act-03"]);
            const cursor = page1.body.pagination.next_cursor;

            // A brand-new row gets the HIGHEST internal_id (the head, not the tail).
            await addActivity({ taskId: task.id, action: "evt", id: "act-99" });

            const page2 = await client.get(`${PATH(task.id)}?limit=2&cursor=${cursor}`);
            // The new act-99 must NOT appear on this already-walked older page.
            expect(idsOf(page2.body)).toEqual(["act-02", "act-01"]);
            expect(idsOf(page2.body)).not.toContain("act-99");
        });

        it("applies a default page size (≤200) when limit is omitted", async () => {
            const { client, task } = await seed();
            await seedN(task.id, 3);
            const res = await client.get(PATH(task.id));
            expect(res.body.data).toHaveLength(3);
            expect(res.body.pagination.has_more).toBe(false);
        });

        it("clamps an over-max limit to 200", async () => {
            const { client, task } = await seed();
            // One batched insert of 201 rows (faster than 201 round-trips).
            await getDb()
                .insert(taskActivity)
                .values(
                    Array.from({ length: 201 }, (_unused, i) => ({
                        id: `cap-${String(i).padStart(3, "0")}`,
                        taskId: task.id,
                        actorId: null,
                        action: "evt",
                        context: null,
                    })),
                );

            const res = await client.get(`${PATH(task.id)}?limit=10000`);
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(200); // clamped, not 201
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(201);
        });
    });

    // ─── action filter ────────────────────────────────────────────────────────
    describe("Action filter", () => {
        const seedMixed = async (taskId: string) => {
            await addActivity({ taskId, action: "status_changed", id: "s-1" });
            await addActivity({ taskId, action: "comment_posted", id: "c-1" });
            await addActivity({ taskId, action: "status_changed", id: "s-2" });
        };

        it("?action= returns only rows with that exact action", async () => {
            const { client, task } = await seed();
            await seedMixed(task.id);

            const res = await client.get(`${PATH(task.id)}?action=status_changed`);
            expect(res.status).toBe(200);
            expect(idsOf(res.body)).toEqual(["s-2", "s-1"]);
            expect(res.body.pagination.total_estimate).toBe(2);
        });

        it("matches the action filter case-insensitively (utf8mb4_unicode_ci collation)", async () => {
            const { client, task } = await seed();
            await seedMixed(task.id);
            // The `action` column carries the DB's case-insensitive default
            // collation, so an upper-case filter still matches the stored
            // lower-case codes — lenient, and a clean 200 (never a 422).
            const res = await client.get(`${PATH(task.id)}?action=STATUS_CHANGED`);
            expect(res.status).toBe(200);
            expect(idsOf(res.body)).toEqual(["s-2", "s-1"]);
        });

        it("an unrecognised action is a valid empty page (free-string filter)", async () => {
            const { client, task } = await seed();
            await seedMixed(task.id);
            const res = await client.get(`${PATH(task.id)}?action=never_emitted`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.total_estimate).toBe(0);
        });

        it("composes the action filter with pagination", async () => {
            const { client, task } = await seed();
            await seedMixed(task.id);
            const res = await client.get(
                `${PATH(task.id)}?action=status_changed&limit=1`,
            );
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].action).toBe("status_changed");
            expect(res.body.pagination.total_estimate).toBe(2);
            expect(res.body.pagination.has_more).toBe(true);
        });
    });

    // ─── actor hydration ──────────────────────────────────────────────────────
    describe("Actor hydration", () => {
        it("hydrates the actor to the full wire User object", async () => {
            const ws = await makeWorkspace();
            const actor = await makeUser({
                workspaceId: ws.id,
                firstName: "Rina",
                lastName: "Akter",
                email: "rina@bb.test",
            });
            const client = await makeLoggedInClient(actor);
            const task = await makeTask({ workspaceId: ws.id, createdBy: actor.id });
            await addActivity({
                taskId: task.id,
                action: "task_created",
                actorId: actor.id,
            });

            const row = (await client.get(PATH(task.id))).body.data[0];
            expect(Object.keys(row.actor).sort()).toEqual(USER_KEYS);
            expect(row.actor.id).toBe(actor.id);
            expect(row.actor.first_name).toBe("Rina");
            expect(row.actor.email).toBe("rina@bb.test");
            // never a bare id string
            expect(typeof row.actor).toBe("object");
        });

        it("returns actor: null for a system event (actor_id null)", async () => {
            const { client, task } = await seed();
            await addActivity({
                taskId: task.id,
                action: "deployed",
                actorId: null,
            });
            const row = (await client.get(PATH(task.id))).body.data[0];
            expect(row.actor).toBeNull();
        });

        it("hydrates two different actors independently", async () => {
            const ws = await makeWorkspace();
            const a = await makeUser({ workspaceId: ws.id, firstName: "Aaa" });
            const b = await makeUser({ workspaceId: ws.id, firstName: "Bbb" });
            const client = await makeLoggedInClient(a);
            const task = await makeTask({ workspaceId: ws.id, createdBy: a.id });
            await addActivity({ taskId: task.id, action: "e", id: "x-1", actorId: a.id });
            await addActivity({ taskId: task.id, action: "e", id: "x-2", actorId: b.id });

            const data = (await client.get(PATH(task.id))).body.data;
            const byId = new Map(data.map((r: { id: string }) => [r.id, r]));
            expect((byId.get("x-1") as { actor: { id: string } }).actor.id).toBe(a.id);
            expect((byId.get("x-2") as { actor: { id: string } }).actor.id).toBe(b.id);
        });

        it("never hydrates an actor from another workspace (→ null, no cross-tenant leak)", async () => {
            // A stray activity row whose actor_id belongs to a DIFFERENT
            // workspace must not leak that user's name/email — the actor fetch is
            // workspace-scoped, so it resolves to null.
            const { client, task } = await seed();
            const wsB = await makeWorkspace();
            const foreign = await makeUser({
                workspaceId: wsB.id,
                firstName: "Foreign",
                email: "foreign@other.test",
            });
            await addActivity({
                taskId: task.id,
                action: "task_updated",
                actorId: foreign.id,
            });

            const res = await client.get(PATH(task.id));
            expect(res.body.data[0].actor).toBeNull();
            expect(JSON.stringify(res.body)).not.toContain("foreign@other.test");
        });

        it("returns actor: null after the actor's user row is deleted (FK ON DELETE SET NULL)", async () => {
            const ws = await makeWorkspace();
            const viewer = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(viewer);
            const task = await makeTask({ workspaceId: ws.id, createdBy: viewer.id });
            // A separate actor with no sessions / no authored rows, so it can be
            // hard-deleted — exercising fk_task_activity_actor ON DELETE SET NULL.
            const actor = await makeUser({ workspaceId: ws.id, firstName: "Gone" });
            await addActivity({
                taskId: task.id,
                action: "task_updated",
                actorId: actor.id,
            });

            await getDb().delete(users).where(eq(users.id, actor.id));

            const res = await client.get(PATH(task.id));
            expect(res.status).toBe(200);
            expect(res.body.data[0].actor).toBeNull();
            expect(JSON.stringify(res.body)).not.toContain("Gone");
        });
    });

    // ─── lifecycle: archived task still shows activity ────────────────────────
    describe("Archived task", () => {
        it("still returns the activity feed for an archived task", async () => {
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(user);
            const task = await makeTask({
                workspaceId: ws.id,
                createdBy: user.id,
                archivedAt: new Date(),
            });
            await addActivity({ taskId: task.id, action: "archived" });

            const res = await client.get(PATH(task.id));
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].action).toBe("archived");
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("422 when ?action exceeds 60 chars", async () => {
            const { client, task } = await seed();
            const res = await client.get(
                `${PATH(task.id)}?action=${"x".repeat(61)}`,
            );
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.details[0].field).toBe("action");
        });

        it("422 when ?action is present but empty", async () => {
            const { client, task } = await seed();
            const res = await client.get(`${PATH(task.id)}?action=`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it.each(["0", "-1", "abc", "2.5"])(
            "422 when limit=%s",
            async (bad) => {
                const { client, task } = await seed();
                const res = await client.get(`${PATH(task.id)}?limit=${bad}`);
                expect(res.status).toBe(422);
                expect(res.body.error.details[0].field).toBe("limit");
            },
        );

        it("422 when ?cursor is present but empty", async () => {
            const { client, task } = await seed();
            const res = await client.get(`${PATH(task.id)}?cursor=`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("400 pagination.invalid_cursor for a non-base64url cursor", async () => {
            const { client, task } = await seed();
            const res = await client.get(`${PATH(task.id)}?cursor=!!!bad`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("400 pagination.invalid_cursor when the cursor decodes to non-digits", async () => {
            const { client, task } = await seed();
            const bad = Buffer.from("not-a-number", "utf8").toString("base64url");
            const res = await client.get(`${PATH(task.id)}?cursor=${bad}`);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("422 when the :id param exceeds 64 chars", async () => {
            const { client } = await seed();
            const res = await client.get(PATH("a".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("id");
        });

        it("a duplicated ?limit param degrades to last-wins, never an unbounded feed", async () => {
            const { client, task } = await seed();
            // 3 rows; ?limit=1&limit=2 arrives as the array [1,2]. The hardened
            // clampLimit takes the LAST element (2) — it must NOT collapse to
            // NaN (which Drizzle would render as no LIMIT, dumping all rows).
            for (let i = 1; i <= 3; i++) {
                await addActivity({ taskId: task.id, action: "evt", id: `d-${i}` });
            }
            const res = await client.get(`${PATH(task.id)}?limit=1&limit=2`);
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(3);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("401 auth.missing_token with no credentials", async () => {
            const { task } = await seed();
            const http = await oneOff();
            const res = await http.get(PATH(task.id));
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.invalid_token for a garbage Bearer token", async () => {
            const { task } = await seed();
            const http = await oneOff();
            const res = await http
                .get(PATH(task.id))
                .set("Authorization", "Bearer not-a-jwt");
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const { user, task } = await seed();
            const forged = signAccess(user, "totally-wrong-secret");
            const http = await oneOff();
            const res = await http
                .get(PATH(task.id))
                .set("Authorization", `Bearer ${forged}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("401 auth.expired_token for an expired access token", async () => {
            const { user, task } = await seed();
            const expired = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(PATH(task.id))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("runs authentication before validation (unauth + bad id → 401)", async () => {
            const http = await oneOff();
            const res = await http.get(PATH("a".repeat(65)));
            expect(res.status).toBe(401);
        });
    });

    // ─── d. Authorization (any role reads) ────────────────────────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        it.each(roles)("allows a %s to read the feed (200)", async (role) => {
            const { client, task } = await seed(role);
            await addActivity({ taskId: task.id, action: "task_created" });
            const res = await client.get(PATH(task.id));
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });

    // ─── e/g. Not-found & tenant isolation ────────────────────────────────────
    describe("Not-found & tenant isolation", () => {
        it("404 task.not_found for a non-existent task id", async () => {
            const { client } = await seed();
            const res = await client.get(PATH(fakeId("t")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 task.not_found when the task is in another workspace", async () => {
            const a = await seed();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            const taskB = await makeTask({
                workspaceId: wsB.id,
                createdBy: userB.id,
            });
            await addActivity({
                taskId: taskB.id,
                action: "secret_action",
                context: { secret: "ws-b-only" },
            });

            const res = await a.client.get(PATH(taskB.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
            expect(JSON.stringify(res.body)).not.toContain("ws-b-only");
        });
    });

    // ─── l. Side effects (read writes nothing) ────────────────────────────────
    describe("Side effects", () => {
        it("a read inserts no task_activity rows", async () => {
            const { client, task } = await seed();
            await addActivity({ taskId: task.id, action: "task_created" });
            const before = await countActivity(task.id);
            await client.get(PATH(task.id));
            expect(await countActivity(task.id)).toBe(before);
        });

        it("a read inserts no workspace_activity rows and adds no tasks", async () => {
            const { client, task } = await seed();
            await addActivity({ taskId: task.id, action: "task_created" });
            const wa = await countWorkspaceActivity();
            const t = await countTasks();
            await client.get(PATH(task.id));
            expect(await countWorkspaceActivity()).toBe(wa);
            expect(await countTasks()).toBe(t);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode context (emoji + Bangla) byte-for-byte", async () => {
            const { client, task } = await seed();
            const context = { note: "অর্ডার প্যাক হয়েছে 🎉", count: 3 };
            await addActivity({ taskId: task.id, action: "status_changed", context });
            const row = (await client.get(PATH(task.id))).body.data[0];
            expect(row.context).toEqual(context);
        });

        it("accepts and returns a max-length (60-char) action filter", async () => {
            const { client, task } = await seed();
            const action = "a".repeat(60);
            await addActivity({ taskId: task.id, action });
            const res = await client.get(`${PATH(task.id)}?action=${action}`);
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        it("preserves a deeply-nested context object", async () => {
            const { client, task } = await seed();
            const context = { fields: ["priority", "due_date"], meta: { a: { b: 1 } } };
            await addActivity({ taskId: task.id, action: "task_updated", context });
            const row = (await client.get(PATH(task.id))).body.data[0];
            expect(row.context).toEqual(context);
        });
    });

    // ─── Cross-cutting / security ─────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("treats a SQL-injection-style id as a literal id (404, never 500)", async () => {
            const { client } = await seed();
            const malicious = encodeURIComponent("' OR '1'='1");
            const res = await client.get(PATH(malicious));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("echoes a client X-Request-Id on success", async () => {
            const { client, task } = await seed();
            const rid = "rid-activity-1";
            const res = await client.get(PATH(task.id)).set("X-Request-Id", rid);
            expect(res.get("x-request-id")).toBe(rid);
        });

        it("returns 404 route.not_found for POST on the activity path", async () => {
            const { client, task } = await seed();
            const res = await client.post(PATH(task.id));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });
});
