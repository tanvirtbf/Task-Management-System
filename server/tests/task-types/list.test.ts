import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { taskTypes, workspaceActivity } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/task-types` (§8).
 *
 * Patterns mirror `tests/tags/list.test.ts`:
 *   - Real DB writes via factories + a local `seedTaskTypes` bulk helper.
 *   - Stateless supertest via `oneOff()`; authed calls via `makeLoggedInClient`.
 *   - `beforeEach` (setup-each.ts) truncates every table, so tests are
 *     independent and order-free.
 *
 * The endpoint is a bounded, workspace-wide collection: it returns EVERY task
 * type in the caller's workspace as a single complete page (`next_cursor:
 * null`, `has_more: false`), ordered by `position` then `id`. It has no body
 * and consumes no query params. `task_types` has no `archived_at` (no soft
 * delete) and no `internal_id` (no cursor) — hence the N/A notes per block.
 */

const TASK_TYPES = "/api/v1/task-types";

interface WireTaskType {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    is_milestone_type: boolean;
    is_system: boolean;
    is_dev_type: boolean;
    position: number;
}

const dataOf = (body: unknown): WireTaskType[] =>
    (body as { data: WireTaskType[] }).data;

const namesOf = (body: unknown): string[] => dataOf(body).map((t) => t.name);
const idsOf = (body: unknown): string[] => dataOf(body).map((t) => t.id);

interface SeedTaskType {
    name: string;
    id?: string;
    description?: string | null;
    icon?: string;
    color?: string;
    isMilestoneType?: boolean;
    isSystem?: boolean;
    isDevType?: boolean;
    position?: number;
}

/** Seed several task types in a workspace in one round-trip. */
const seedTaskTypes = async (workspaceId: string, rows: SeedTaskType[]) => {
    const db = getDb();
    await db.insert(taskTypes).values(
        rows.map((r) => ({
            id: r.id ?? fakeId("tt"),
            workspaceId,
            name: r.name,
            description: r.description ?? null,
            icon: r.icon ?? "CheckSquare",
            color: r.color ?? "#6B7280",
            isMilestoneType: r.isMilestoneType ?? false,
            isSystem: r.isSystem ?? false,
            isDevType: r.isDevType ?? false,
            position: r.position ?? 0,
        })),
    );
};

const countWorkspaceActivity = async (): Promise<number> => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

const countTaskTypes = async (workspaceId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: taskTypes.id })
            .from(taskTypes)
            .where(eq(taskTypes.workspaceId, workspaceId))
    ).length;
};

/** Mint a raw access token for the negative-auth cases. */
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

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/task-types", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec list envelope for a workspace's task types", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "Order" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data).toHaveLength(1);
        });

        it("shapes each row as exactly the nine wire fields — no leaked columns", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "Bug", icon: "Bug", color: "#E11D48", position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(Object.keys(tt).sort()).toEqual([
                "color",
                "description",
                "icon",
                "id",
                "is_dev_type",
                "is_milestone_type",
                "is_system",
                "name",
                "position",
            ]);
            expect(tt.name).toBe("Bug");
            expect(tt.icon).toBe("Bug");
            expect(tt.color).toBe("#E11D48");
            expect(tt.position).toBe(2);
            expect(tt.id).toMatch(/^tt-/);
        });

        it("never leaks workspace_id, timestamps, or internal_id", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "Complaint" }]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(tt).not.toHaveProperty("workspace_id");
            expect(tt).not.toHaveProperty("workspaceId");
            expect(tt).not.toHaveProperty("created_at");
            expect(tt).not.toHaveProperty("updated_at");
            expect(tt).not.toHaveProperty("internal_id");
        });

        it("returns description: null (key present) when it was not set", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "NoDesc", description: null },
            ]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(tt).toHaveProperty("description");
            expect(tt.description).toBeNull();
        });

        it("returns description text verbatim when set", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "Feature", description: "New product capability" },
            ]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(tt.description).toBe("New product capability");
        });

        it("serializes the is_* flags as JSON booleans, never 0/1", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "Plain" }]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(typeof tt.is_milestone_type).toBe("boolean");
            expect(typeof tt.is_system).toBe("boolean");
            expect(typeof tt.is_dev_type).toBe("boolean");
            expect(tt.is_milestone_type).toBe(false);
            expect(tt.is_system).toBe(false);
            expect(tt.is_dev_type).toBe(false);
        });

        it("round-trips is_milestone_type / is_system / is_dev_type = true", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                {
                    name: "Release",
                    isMilestoneType: true,
                    isSystem: true,
                    isDevType: true,
                },
            ]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(tt.is_milestone_type).toBe(true);
            expect(tt.is_system).toBe(true);
            expect(tt.is_dev_type).toBe(true);
        });

        it("returns the full-page pagination block (no cursor, exact count)", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 3,
            });
        });

        it("returns an empty list (not 404) when the workspace has no task types", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 0,
            });
        });
    });

    // ─── Ordering (position asc, then id asc) ─────────────────────────────────
    describe("Ordering", () => {
        it("orders by position ascending, independent of name", async () => {
            const u = await makeUser();
            // Names are anti-correlated with position so a name-sort would give
            // a different result — this proves the sort key is `position`.
            await seedTaskTypes(u.workspaceId, [
                { name: "Zeta", position: 0 },
                { name: "Alpha", position: 1 },
                { name: "Mango", position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(namesOf(res.body)).toEqual(["Zeta", "Alpha", "Mango"]);
        });

        it("breaks ties on id ascending when positions are equal", async () => {
            const u = await makeUser();
            // All position 0, explicit ids inserted in scrambled order.
            await seedTaskTypes(u.workspaceId, [
                { id: "tt-0003", name: "t3", position: 0 },
                { id: "tt-0001", name: "t1", position: 0 },
                { id: "tt-0002", name: "t2", position: 0 },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(idsOf(res.body)).toEqual(["tt-0001", "tt-0002", "tt-0003"]);
        });
    });

    // ─── b. Query-param robustness (no params consumed → ignored) ────────────
    describe("Query-param robustness", () => {
        it("ignores ?limit and still returns the full list (collection mode)", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TASK_TYPES}?limit=1`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(3);
            expect(res.body.pagination.has_more).toBe(false);
        });

        it("ignores ?cursor and keeps next_cursor null", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TASK_TYPES}?cursor=ignored-blob`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.pagination.next_cursor).toBeNull();
        });

        it("ignores unknown query params", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TASK_TYPES}?foo=bar&q=zzz&page=9`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.get(TASK_TYPES);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .get(TASK_TYPES)
                .set("Authorization", "Bearer not.a.real.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const u = await makeUser();
            const token = signAccess(u, "wrong-secret-not-the-real-one", {
                expiresIn: "15m",
            });
            const http = await oneOff();
            const res = await http
                .get(TASK_TYPES)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const u = await makeUser();
            const token = signAccess(u, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(TASK_TYPES)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("still serves a deactivated user holding a valid access token (stateless JWT)", async () => {
            // express-jwt does not re-check DB status; an access token stays
            // valid until its ≤15-min expiry. Deactivation revokes the refresh
            // token, so the window is bounded. Documented, intentional — and it
            // matches the sibling §9 tags behaviour.
            const u = await makeUser({ status: "deactivated" });
            await seedTaskTypes(u.workspaceId, [{ name: "Still-Visible" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(res.status).toBe(200);
            expect(namesOf(res.body)).toEqual(["Still-Visible"]);
        });
    });

    // ─── d. Authorization (🔐 any role; no forbidden tier) ───────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to list task types (200)`, async () => {
                const u = await makeUser({ role });
                await seedTaskTypes(u.workspaceId, [{ name: "Shared" }]);
                const client = await makeLoggedInClient(u);

                const res = await client.get(TASK_TYPES);

                expect(res.status).toBe(200);
                expect(namesOf(res.body)).toEqual(["Shared"]);
            });
        }
    });

    // ─── g. Tenant / workspace isolation ─────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns only the caller's workspace task types", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userA = await makeUser({ workspaceId: wsA.id });
            await seedTaskTypes(wsA.id, [
                { name: "A-one", position: 0 },
                { name: "A-two", position: 1 },
            ]);
            await seedTaskTypes(wsB.id, [{ name: "B-one" }]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(TASK_TYPES);

            expect(namesOf(res.body)).toEqual(["A-one", "A-two"]);
        });

        it("scopes a second workspace's user to their own task types", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            await seedTaskTypes(wsA.id, [
                { name: "A-one", position: 0 },
                { name: "A-two", position: 1 },
            ]);
            await seedTaskTypes(wsB.id, [{ name: "B-one" }]);
            const client = await makeLoggedInClient(userB);

            const res = await client.get(TASK_TYPES);

            expect(namesOf(res.body)).toEqual(["B-one"]);
        });

        it("counts total_estimate per the caller's workspace only", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userA = await makeUser({ workspaceId: wsA.id });
            await seedTaskTypes(wsA.id, [
                { name: "A-one", position: 0 },
                { name: "A-two", position: 1 },
            ]);
            await seedTaskTypes(wsB.id, [
                { name: "B-one", position: 0 },
                { name: "B-two", position: 1 },
                { name: "B-three", position: 2 },
            ]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(TASK_TYPES);

            expect(res.body.pagination.total_estimate).toBe(2);
        });

        it("ignores a ?workspace_id query param (caller stays scoped to their token)", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const userA = await makeUser({ workspaceId: wsA.id });
            await seedTaskTypes(wsA.id, [{ name: "A-one" }]);
            await seedTaskTypes(wsB.id, [{ name: "B-one" }]);
            const client = await makeLoggedInClient(userA);

            const res = await client.get(`${TASK_TYPES}?workspace_id=${wsB.id}`);

            expect(namesOf(res.body)).toEqual(["A-one"]);
        });
    });

    // ─── i. Concurrency (reads only — endpoint is read-only) ─────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent results", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(TASK_TYPES)),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(namesOf(r.body)).toEqual(["a", "b", "c"]);
            }
        });
    });

    // ─── j. Pagination (collection mode — single complete page) ──────────────
    describe("Collection pagination", () => {
        it("returns a large set in a single page with no hidden cap", async () => {
            const u = await makeUser();
            const rows = Array.from({ length: 250 }, (_, i) => ({
                name: `type-${String(i).padStart(3, "0")}`,
                position: i,
            }));
            await seedTaskTypes(u.workspaceId, rows);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(res.body.data).toHaveLength(250);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 250,
            });
            expect(dataOf(res.body)[0].name).toBe("type-000");
            expect(dataOf(res.body)[249].name).toBe("type-249");
        });

        it("returns the identical full set on a repeated request (stability)", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
                { name: "c", position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const first = idsOf((await client.get(TASK_TYPES)).body);
            const second = idsOf((await client.get(TASK_TYPES)).body);

            expect(second).toEqual(first);
        });
    });

    // ─── k. Boundary values ──────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("returns unicode names intact (Bangla, emoji, RTL Arabic)", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "ঈদ অর্ডার", position: 0 },
                { name: "🔥 Hotfix", position: 1 },
                { name: "عرض خاص", position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const got = namesOf((await client.get(TASK_TYPES)).body);

            expect(got).toContain("ঈদ অর্ডার");
            expect(got).toContain("🔥 Hotfix");
            expect(got).toContain("عرض خاص");
        });

        it("returns a max-length (80-char) name untruncated", async () => {
            const u = await makeUser();
            const longName = "x".repeat(80);
            await seedTaskTypes(u.workspaceId, [{ name: longName }]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(tt.name).toBe(longName);
            expect(tt.name).toHaveLength(80);
        });

        it("passes an explicit color through verbatim", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "Red", color: "#FF0000" },
            ]);
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(tt.color).toBe("#FF0000");
        });

        it("returns the schema default color (#6B7280) and icon (CheckSquare) when omitted", async () => {
            const u = await makeUser();
            const db = getDb();
            // Insert WITHOUT icon/color/flags so MySQL applies the column DEFAULTs.
            await db.insert(taskTypes).values({
                id: fakeId("tt"),
                workspaceId: u.workspaceId,
                name: "Defaulted",
            });
            const client = await makeLoggedInClient(u);

            const [tt] = dataOf((await client.get(TASK_TYPES)).body);

            expect(tt.color).toBe("#6B7280");
            expect(tt.icon).toBe("CheckSquare");
            expect(tt.is_milestone_type).toBe(false);
            expect(tt.is_system).toBe(false);
            expect(tt.is_dev_type).toBe(false);
            expect(tt.position).toBe(0);
        });

        it("handles a single task type (N=1)", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "Solo" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.total_estimate).toBe(1);
        });
    });

    // ─── l. Side effects (a read must mutate nothing) ─────────────────────────
    describe("Side effects", () => {
        it("writes no workspace_activity rows", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            await client.get(TASK_TYPES);

            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("does not change the task_types row count", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
            ]);
            const client = await makeLoggedInClient(u);

            const before = await countTaskTypes(u.workspaceId);
            await client.get(TASK_TYPES);

            expect(await countTaskTypes(u.workspaceId)).toBe(before);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(TASK_TYPES);

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope (with matching request_id) on 401", async () => {
            const http = await oneOff();
            const res = await http.get(TASK_TYPES);

            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(typeof res.body.error.message).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("returns 404 route.not_found for a bogus deep path under /task-types", async () => {
            const http = await oneOff();
            const res = await http.get(`${TASK_TYPES}/deep/bogus/path`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── Exploratory probes (Step 7) ──────────────────────────────────────────
    describe("Exploratory", () => {
        it("ignores duplicated query params (?limit=1&limit=2)", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "a", position: 0 },
                { name: "b", position: 1 },
            ]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${TASK_TYPES}?limit=1&limit=2`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
        });

        it("survives an absurdly long ?cursor without erroring", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            const res = await client.get(
                `${TASK_TYPES}?cursor=${"A".repeat(10000)}`,
            );

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.next_cursor).toBeNull();
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [{ name: "a" }]);
            const client = await makeLoggedInClient(u);

            const res = await client
                .get(TASK_TYPES)
                .set("Accept", "text/plain, */*");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });

        it("returns a mixed system/dev/milestone set with each flag intact", async () => {
            const u = await makeUser();
            await seedTaskTypes(u.workspaceId, [
                { name: "Task", isSystem: true, position: 0 },
                { name: "Milestone", isMilestoneType: true, position: 1 },
                { name: "Bug", isDevType: true, position: 2 },
            ]);
            const client = await makeLoggedInClient(u);

            const rows = dataOf((await client.get(TASK_TYPES)).body);

            const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
            expect(byName["Task"].is_system).toBe(true);
            expect(byName["Task"].is_dev_type).toBe(false);
            expect(byName["Milestone"].is_milestone_type).toBe(true);
            expect(byName["Bug"].is_dev_type).toBe(true);
            expect(byName["Bug"].is_milestone_type).toBe(false);
        });
    });
});
