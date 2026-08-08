import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { syncUserSystemRole } from "../../src/rbac/bootstrap";
import { users, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/users` (§4 #1).
 *
 * Patterns mirror `tests/tags/list.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - Stateless supertest via `oneOff()`; authed calls via `makeLoggedInClient`.
 *   - `beforeEach` (setup-each.ts) truncates every table, so tests are
 *     independent and order-free.
 *
 * Unlike tags, this endpoint is genuinely cursor-paginated (keyset on the
 * primary `id`, ASC — `users` has no `internal_id`) and validates its query
 * (`status`/`role`/`q`/`cursor`/`limit`). NOTE: the authenticated caller is
 * itself a row in `users`, so it always appears in its own workspace listing —
 * pagination tests seed users with CONTROLLED ids and mint the client for one
 * of them so the id-ASC order is deterministic.
 */

const USERS = "/api/v1/users";
const DUMMY_HASH = "x"; // password_hash is NOT NULL; never returned or checked.

interface WireUser {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: Role;
    avatar_url: string | null;
    status: "active" | "invited" | "deactivated";
    timezone: string;
    created_at: string;
    last_login_at: string | null;
}

const dataOf = (body: unknown): WireUser[] =>
    (body as { data: WireUser[] }).data;

const idsOf = (body: unknown): string[] => dataOf(body).map((u) => u.id);

interface SeedUserSpec {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: Role;
    status?: "active" | "invited" | "deactivated";
    avatarUrl?: string;
}

/**
 * Bulk-insert users with controlled ids in one round-trip.
 *
 * F10: each seeded user also gets its system-role assignment. The bulk insert
 * writes `users` rows directly (that is the point — controlled ids in one
 * round-trip), which skipped the `syncUserSystemRole` call that `makeUser` and
 * every real creation path run. A user with no `user_roles` row holds no
 * permissions at all, so once `GET /users` gained its `member.view` gate in F7
 * the seeded CALLER was 403 on their own workspace. The product is right —
 * "authenticated but powerless" is a valid state — so the fixture is what had
 * to catch up. `bump: false`: these accounts are brand new, no cached actor can
 * exist for them, and N bumps would serialise on the workspace row.
 */
const seedUsers = async (workspaceId: string, specs: SeedUserSpec[]) => {
    const db = getDb();
    await db.insert(users).values(
        specs.map((s, i) => ({
            id: s.id,
            workspaceId,
            firstName: s.firstName ?? "First",
            lastName: s.lastName ?? `Last${i}`,
            email: s.email ?? `${s.id}@seed.test`,
            passwordHash: DUMMY_HASH,
            role: s.role ?? ("member" as Role),
            status: s.status ?? ("active" as const),
            ...(s.avatarUrl !== undefined ? { avatarUrl: s.avatarUrl } : {}),
        })),
    );
    for (const s of specs) {
        await syncUserSystemRole(
            db,
            workspaceId,
            s.id,
            s.role ?? "member",
            { bump: false },
        );
    }
};

const countWorkspaceActivity = async (): Promise<number> => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

const countUsers = async (workspaceId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.workspaceId, workspaceId))
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
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

/**
 * Seed N users (ids `u-000`..`u-(N-1)`, zero-padded for lexicographic order)
 * in a fresh workspace and return a client authenticated as the first one.
 */
const seedWorkspaceWithUsers = async (
    n: number,
    overrides: SeedUserSpec[] = [],
) => {
    const ws = await makeWorkspace();
    const base: SeedUserSpec[] = Array.from({ length: n }, (_, i) => ({
        id: `u-${String(i).padStart(3, "0")}`,
    }));
    for (const o of overrides) {
        const idx = base.findIndex((b) => b.id === o.id);
        if (idx >= 0) base[idx] = { ...base[idx], ...o };
        else base.push(o);
    }
    await seedUsers(ws.id, base);
    const callerId = base[0].id;
    const client = await makeLoggedInClient({
        id: callerId,
        workspaceId: ws.id,
        role: base[0].role ?? "member",
    });
    return { ws, client, callerId };
};

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/users", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec list envelope", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(USERS);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 1,
            });
        });

        it("includes the calling user as a row", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(USERS);

            expect(idsOf(res.body)).toEqual([u.id]);
        });

        it("shapes each row as exactly the 10 wire fields", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const [row] = dataOf((await client.get(USERS)).body);

            expect(Object.keys(row).sort()).toEqual(
                [
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
                ].sort(),
            );
        });

        it("never leaks password_hash, workspace_id, or updated_at", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const [row] = dataOf((await client.get(USERS)).body);

            expect(row).not.toHaveProperty("password_hash");
            expect(row).not.toHaveProperty("passwordHash");
            expect(row).not.toHaveProperty("workspace_id");
            expect(row).not.toHaveProperty("workspaceId");
            expect(row).not.toHaveProperty("updated_at");
        });

        it("emits created_at as an ISO-8601 string and last_login_at null", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const [row] = dataOf((await client.get(USERS)).body);

            expect(row.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );
            expect(row.last_login_at).toBeNull();
        });

        it("returns a single complete page when the set is small", async () => {
            const { client } = await seedWorkspaceWithUsers(3);

            const res = await client.get(USERS);

            expect(idsOf(res.body)).toEqual(["u-000", "u-001", "u-002"]);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 3,
            });
        });
    });

    // ─── b. Validation (422) + cursor (400) ──────────────────────────────────
    describe("Validation", () => {
        const cases: Array<{ name: string; qs: string; field: string }> = [
            { name: "unknown status", qs: "status=banned", field: "status" },
            { name: "wrong-case status", qs: "status=ACTIVE", field: "status" },
            { name: "empty status", qs: "status=", field: "status" },
            { name: "unknown role", qs: "role=superuser", field: "role" },
            { name: "zero limit", qs: "limit=0", field: "limit" },
            { name: "negative limit", qs: "limit=-5", field: "limit" },
            { name: "non-numeric limit", qs: "limit=abc", field: "limit" },
            { name: "fractional limit", qs: "limit=2.5", field: "limit" },
            { name: "empty limit", qs: "limit=", field: "limit" },
            { name: "empty cursor", qs: "cursor=", field: "cursor" },
        ];
        for (const c of cases) {
            it(`returns 422 validation.failed for ${c.name}`, async () => {
                const u = await makeUser();
                const client = await makeLoggedInClient(u);

                const res = await client.get(`${USERS}?${c.qs}`);

                expect(res.status).toBe(422);
                expect(res.body.error.code).toBe("validation.failed");
                expect(
                    res.body.error.details.some(
                        (d: { field?: string }) => d.field === c.field,
                    ),
                ).toBe(true);
            });
        }

        it("returns 422 for an over-length q (101 chars)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${USERS}?q=${"x".repeat(101)}`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("accepts a q of exactly 100 chars (200)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${USERS}?q=${"x".repeat(100)}`);

            expect(res.status).toBe(200);
        });

        it("returns 400 pagination.invalid_cursor for non-base64url chars", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${USERS}?cursor=${"!!!bad"}`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("returns 400 pagination.invalid_cursor for a cursor with a space", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(
                `${USERS}?cursor=${encodeURIComponent("a b")}`,
            );

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });
    });

    // ─── c. Authentication ──────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const http = await oneOff();
            const res = await http.get(USERS);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const http = await oneOff();
            const res = await http
                .get(USERS)
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
                .get(USERS)
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
                .get(USERS)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("still serves a deactivated user holding a valid access token (stateless JWT)", async () => {
            // express-jwt does not re-check DB status; an access token stays
            // valid until its ≤15-min expiry. Deactivation revokes the refresh
            // token, so the window is bounded. Documented, intentional.
            const u = await makeUser({ status: "deactivated" });
            const client = await makeLoggedInClient(u);

            const res = await client.get(USERS);

            expect(res.status).toBe(200);
            expect(idsOf(res.body)).toContain(u.id);
        });
    });

    // ─── d. Authorization (🔐 any role; no forbidden tier) ───────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to list users (200)`, async () => {
                const u = await makeUser({ role });
                const client = await makeLoggedInClient(u);

                const res = await client.get(USERS);

                expect(res.status).toBe(200);
                expect(idsOf(res.body)).toContain(u.id);
            });
        }
    });

    // ─── filters: status / role / q ──────────────────────────────────────────
    describe("Filtering", () => {
        it("filters by status", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", status: "active" },
                { id: "u-001", status: "invited" },
                { id: "u-002", status: "deactivated" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const res = await client.get(`${USERS}?status=invited`);

            expect(idsOf(res.body)).toEqual(["u-001"]);
            expect(res.body.pagination.total_estimate).toBe(1);
        });

        it("filters by role, including owner (superset of the spec set)", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", role: "owner" },
                { id: "u-001", role: "admin" },
                { id: "u-002", role: "member" },
                { id: "u-003", role: "guest" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "owner",
            });

            expect(idsOf((await client.get(`${USERS}?role=owner`)).body)).toEqual(
                ["u-000"],
            );
            expect(idsOf((await client.get(`${USERS}?role=guest`)).body)).toEqual(
                ["u-003"],
            );
        });

        it("matches q against the first name (case-insensitive)", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", firstName: "Aaa" },
                { id: "u-001", firstName: "Rahim" },
                { id: "u-002", firstName: "Karim" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const res = await client.get(`${USERS}?q=RAHIM`);

            expect(idsOf(res.body)).toEqual(["u-001"]);
        });

        it("matches q against the email", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", firstName: "Zeba", email: "zeba@seed.test" },
                { id: "u-001", firstName: "Nadia", email: "rahim@corp.test" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const res = await client.get(`${USERS}?q=rahim`);

            expect(idsOf(res.body)).toEqual(["u-001"]);
        });

        it("treats a LIKE underscore wildcard as a literal (escaped)", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", firstName: "abc" },
                { id: "u-001", firstName: "aXc" },
                { id: "u-002", firstName: "a_c" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            // If `_` were an unescaped wildcard it would match abc/aXc/a_c.
            const res = await client.get(`${USERS}?q=${encodeURIComponent("a_c")}`);

            expect(idsOf(res.body)).toEqual(["u-002"]);
        });

        it("treats a LIKE percent wildcard as a literal (escaped)", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", firstName: "50%off" },
                { id: "u-001", firstName: "plain" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            // If `%` were an unescaped wildcard it would match every row.
            const res = await client.get(`${USERS}?q=${encodeURIComponent("%")}`);

            expect(idsOf(res.body)).toEqual(["u-000"]);
        });

        it("combines status + role + q with AND semantics", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", firstName: "Match", role: "admin", status: "active" },
                { id: "u-001", firstName: "Match", role: "member", status: "active" },
                { id: "u-002", firstName: "Match", role: "admin", status: "invited" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "admin",
            });

            const res = await client.get(
                `${USERS}?q=match&role=admin&status=active`,
            );

            expect(idsOf(res.body)).toEqual(["u-000"]);
        });
    });

    // ─── g. Tenant / workspace isolation ─────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns only the caller's workspace users", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            await seedUsers(wsA.id, [{ id: "a-000" }, { id: "a-001" }]);
            await seedUsers(wsB.id, [{ id: "b-000" }]);
            const client = await makeLoggedInClient({
                id: "a-000",
                workspaceId: wsA.id,
                role: "member",
            });

            const res = await client.get(USERS);

            expect(idsOf(res.body)).toEqual(["a-000", "a-001"]);
        });

        it("scopes a second workspace's user to their own members", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            await seedUsers(wsA.id, [{ id: "a-000" }, { id: "a-001" }]);
            await seedUsers(wsB.id, [{ id: "b-000" }]);
            const client = await makeLoggedInClient({
                id: "b-000",
                workspaceId: wsB.id,
                role: "member",
            });

            const res = await client.get(USERS);

            expect(idsOf(res.body)).toEqual(["b-000"]);
        });

        it("counts total_estimate for the caller's workspace only", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            await seedUsers(wsA.id, [{ id: "a-000" }, { id: "a-001" }]);
            await seedUsers(wsB.id, [
                { id: "b-000" },
                { id: "b-001" },
                { id: "b-002" },
            ]);
            const client = await makeLoggedInClient({
                id: "a-000",
                workspaceId: wsA.id,
                role: "member",
            });

            const res = await client.get(USERS);

            expect(res.body.pagination.total_estimate).toBe(2);
        });

        it("refuses a ?workspace_id query param (F23/ISS-014 — a typo is a 422, not silence)", async () => {
            // This spec used to assert the SILENT-IGNORE convention as the
            // isolation property. F23's allowQuery refuses unknown parameters
            // outright, which is strictly stronger: the parameter cannot cross
            // tenants because the request never executes at all.
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            await seedUsers(wsA.id, [{ id: "a-000" }]);
            await seedUsers(wsB.id, [{ id: "b-000" }]);
            const client = await makeLoggedInClient({
                id: "a-000",
                workspaceId: wsA.id,
                role: "member",
            });

            const res = await client.get(`${USERS}?workspace_id=${wsB.id}`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(JSON.stringify(res.body)).toContain("workspace_id");
        });
    });

    // ─── j. Pagination (real keyset on id ASC) ───────────────────────────────
    describe("Pagination", () => {
        it("walks first → middle → last page with a stable cursor, no dups", async () => {
            const { client } = await seedWorkspaceWithUsers(5);

            const p1 = await client.get(`${USERS}?limit=2`);
            expect(idsOf(p1.body)).toEqual(["u-000", "u-001"]);
            expect(p1.body.pagination.has_more).toBe(true);

            const p2 = await client.get(
                `${USERS}?limit=2&cursor=${p1.body.pagination.next_cursor}`,
            );
            expect(idsOf(p2.body)).toEqual(["u-002", "u-003"]);
            expect(p2.body.pagination.has_more).toBe(true);

            const p3 = await client.get(
                `${USERS}?limit=2&cursor=${p2.body.pagination.next_cursor}`,
            );
            expect(idsOf(p3.body)).toEqual(["u-004"]);
            expect(p3.body.pagination.has_more).toBe(false);
            expect(p3.body.pagination.next_cursor).toBeNull();

            const all = [
                ...idsOf(p1.body),
                ...idsOf(p2.body),
                ...idsOf(p3.body),
            ];
            expect(all).toEqual(["u-000", "u-001", "u-002", "u-003", "u-004"]);
            expect(new Set(all).size).toBe(5);
        });

        it("reports total_estimate as the full count, independent of page size", async () => {
            const { client } = await seedWorkspaceWithUsers(5);

            const res = await client.get(`${USERS}?limit=2`);

            expect(res.body.data).toHaveLength(2);
            expect(res.body.pagination.total_estimate).toBe(5);
        });

        it("encodes next_cursor as the opaque base64url of the last row id", async () => {
            const { client } = await seedWorkspaceWithUsers(5);

            const res = await client.get(`${USERS}?limit=2`);
            const decoded = Buffer.from(
                res.body.pagination.next_cursor,
                "base64url",
            ).toString("utf8");

            expect(decoded).toBe("u-001");
        });

        it("returns an empty page (not 404) when nothing matches", async () => {
            const { client } = await seedWorkspaceWithUsers(2);

            const res = await client.get(`${USERS}?q=nobody-has-this-name`);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination).toEqual({
                next_cursor: null,
                has_more: false,
                total_estimate: 0,
            });
        });

        it("returns an empty page for a cursor past the end", async () => {
            const { client } = await seedWorkspaceWithUsers(3);
            const beyond = Buffer.from("u-999", "utf8").toString("base64url");

            const res = await client.get(`${USERS}?cursor=${beyond}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
            expect(res.body.pagination.has_more).toBe(false);
        });

        it("does not re-surface a row inserted behind the cursor mid-pagination", async () => {
            const { ws, client } = await seedWorkspaceWithUsers(5);

            const p1 = await client.get(`${USERS}?limit=2`);
            expect(idsOf(p1.body)).toEqual(["u-000", "u-001"]);

            // Insert a row that sorts BEFORE the cursor (u-001) — keyset paging
            // must not show it on subsequent pages (and never duplicate).
            await seedUsers(ws.id, [{ id: "u-000a" }]);

            const p2 = await client.get(
                `${USERS}?limit=2&cursor=${p1.body.pagination.next_cursor}`,
            );

            expect(idsOf(p2.body)).toEqual(["u-002", "u-003"]);
            expect(idsOf(p2.body)).not.toContain("u-000a");
        });

        it("surfaces a row inserted ahead of the cursor mid-pagination", async () => {
            const { ws, client } = await seedWorkspaceWithUsers(4);

            const p1 = await client.get(`${USERS}?limit=2`);
            expect(idsOf(p1.body)).toEqual(["u-000", "u-001"]);

            // Insert a row that sorts AFTER the cursor — it should appear later.
            await seedUsers(ws.id, [{ id: "u-005" }]);

            const p2 = await client.get(
                `${USERS}?limit=10&cursor=${p1.body.pagination.next_cursor}`,
            );

            expect(idsOf(p2.body)).toEqual(["u-002", "u-003", "u-005"]);
        });

        it("defaults to a 100-row page when no limit is given", async () => {
            const { client } = await seedWorkspaceWithUsers(101);

            const res = await client.get(USERS);

            expect(res.body.data).toHaveLength(100);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(101);
        });

        it("clamps an over-max limit to 200", async () => {
            const { client } = await seedWorkspaceWithUsers(201);

            const res = await client.get(`${USERS}?limit=500`);

            expect(res.body.data).toHaveLength(200);
            expect(res.body.pagination.has_more).toBe(true);
            expect(res.body.pagination.total_estimate).toBe(201);
        });

        it("honours limit=1 (single row, has_more)", async () => {
            const { client } = await seedWorkspaceWithUsers(3);

            const res = await client.get(`${USERS}?limit=1`);

            expect(idsOf(res.body)).toEqual(["u-000"]);
            expect(res.body.pagination.has_more).toBe(true);
        });

        it("composes a cursor with a status filter and keeps total_estimate at the filtered count across pages", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", status: "active" },
                { id: "u-001", status: "invited" },
                { id: "u-002", status: "active" },
                { id: "u-003", status: "invited" },
                { id: "u-004", status: "active" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const p1 = await client.get(`${USERS}?status=active&limit=2`);
            expect(idsOf(p1.body)).toEqual(["u-000", "u-002"]);
            expect(p1.body.pagination.has_more).toBe(true);
            expect(p1.body.pagination.total_estimate).toBe(3);

            const p2 = await client.get(
                `${USERS}?status=active&limit=2&cursor=${p1.body.pagination.next_cursor}`,
            );
            expect(idsOf(p2.body)).toEqual(["u-004"]);
            expect(p2.body.pagination.has_more).toBe(false);
            // total_estimate is the full filtered count, not the remaining count.
            expect(p2.body.pagination.total_estimate).toBe(3);
        });
    });

    // ─── i. Concurrency (read-only endpoint) ─────────────────────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent results", async () => {
            const { client } = await seedWorkspaceWithUsers(3);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(USERS)),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(idsOf(r.body)).toEqual(["u-000", "u-001", "u-002"]);
            }
        });
    });

    // ─── k. Boundary values ──────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("returns unicode names intact and matches them via q", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", firstName: "রহিম", lastName: "উদ্দিন" },
                { id: "u-001", firstName: "🔥Sale", lastName: "Team" },
                { id: "u-002", firstName: "عرض", lastName: "خاص" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const all = dataOf((await client.get(USERS)).body);
            expect(all.find((r) => r.id === "u-000")?.first_name).toBe("রহিম");
            expect(all.find((r) => r.id === "u-001")?.first_name).toBe("🔥Sale");

            const hit = await client.get(`${USERS}?q=${encodeURIComponent("রহিম")}`);
            expect(idsOf(hit.body)).toEqual(["u-000"]);
        });

        it("returns a max-length (80-char) name untruncated", async () => {
            const ws = await makeWorkspace();
            const longName = "n".repeat(80);
            await seedUsers(ws.id, [{ id: "u-000", firstName: longName }]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const [row] = dataOf((await client.get(USERS)).body);

            expect(row.first_name).toBe(longName);
            expect(row.first_name).toHaveLength(80);
        });

        it("passes avatar_url through verbatim when set", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", avatarUrl: "https://cdn.test/a.png" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const [row] = dataOf((await client.get(USERS)).body);

            expect(row.avatar_url).toBe("https://cdn.test/a.png");
        });

        it("returns avatar_url as null when unset", async () => {
            const { client } = await seedWorkspaceWithUsers(1);

            const [row] = dataOf((await client.get(USERS)).body);

            expect(row.avatar_url).toBeNull();
        });
    });

    // ─── l. Side effects (a read must mutate nothing) ─────────────────────────
    describe("Side effects", () => {
        it("writes no workspace_activity rows", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            await client.get(USERS);

            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("does not change the user row count", async () => {
            const { ws, client } = await seedWorkspaceWithUsers(3);

            const before = await countUsers(ws.id);
            await client.get(USERS);

            expect(await countUsers(ws.id)).toBe(before);
        });
    });

    // ─── Cross-cutting ────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(USERS);

            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("renders the spec error envelope (with matching request_id) on 401", async () => {
            const http = await oneOff();
            const res = await http.get(USERS);

            expect(res.body.error).toBeDefined();
            expect(typeof res.body.error.code).toBe("string");
            expect(typeof res.body.error.message).toBe("string");
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("returns 404 route.not_found for a bogus deep path under /users", async () => {
            const http = await oneOff();
            const res = await http.get(`${USERS}/deep/bogus/path`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });
    });

    // ─── Exploratory probes (Step 7) ──────────────────────────────────────────
    describe("Exploratory", () => {
        it("rejects a duplicated ?limit param (array) as 422, not 500", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${USERS}?limit=1&limit=2`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects a duplicated ?status param (array) as 422, not 500", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${USERS}?status=active&status=invited`);

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("refuses an absurdly long base64url cursor (F23/ISS-008 — foreign cursors are 400)", async () => {
            // Pre-F23 this decoded to NUL bytes and silently restarted at page
            // one — exactly the forever-loop ISS-008 records. Every cursor the
            // server did not issue is now a 400.
            const { client } = await seedWorkspaceWithUsers(3);

            const res = await client.get(`${USERS}?cursor=${"A".repeat(10000)}`);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("pagination.invalid_cursor");
        });

        it("serves the request regardless of an exotic Accept header", async () => {
            const { client } = await seedWorkspaceWithUsers(1);

            const res = await client.get(USERS).set("Accept", "text/plain, */*");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });

        it("trims surrounding whitespace in q before matching", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                { id: "u-000", firstName: "Solo" },
                { id: "u-001", firstName: "Other" },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "member",
            });

            const res = await client.get(
                `${USERS}?q=${encodeURIComponent("  Solo  ")}`,
            );

            expect(idsOf(res.body)).toEqual(["u-000"]);
        });

        it("clamps an enormous limit without erroring", async () => {
            const { client } = await seedWorkspaceWithUsers(3);

            const res = await client.get(`${USERS}?limit=999999999`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(3);
            expect(res.body.pagination.has_more).toBe(false);
        });
    });
});
