import jwt from "jsonwebtoken";
import { oneOff } from "../test-utils/app";
import {
    makeLoggedInClient,
    makeUser,
    makeWorkspace,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { users, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/users/:id` (§4 #2).
 *
 * Patterns mirror `tests/users/list.test.ts` + `tests/auth/me.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - Stateless supertest via `oneOff()`; authed calls via `makeLoggedInClient`.
 *   - `beforeEach` (setup-each.ts) truncates every table, so tests are
 *     independent and order-free.
 *
 * Unlike the list endpoint this returns a BARE Appendix-A `User` (no
 * `{data,pagination}` envelope) and takes a single path param. Workspace
 * isolation is enforced in the query: an id outside the caller's workspace is a
 * 404, indistinguishable from a non-existent id (no cross-tenant oracle).
 *
 * N/A categories (documented, not skipped):
 *   - Conflict / ETag: safe read, no unique keys, no `If-Match` on GET.
 *   - Idempotency / concurrency: safe idempotent method, no writes, no txn.
 *   - Pagination: single resource, not a list.
 */

const DUMMY_HASH = "x"; // password_hash is NOT NULL; never returned or checked.
const url = (id: string) => `/api/v1/users/${id}`;

/** The exact Appendix-A `User` keys this endpoint returns. */
const EXPECTED_KEYS = [
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

interface SeedUserSpec {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: Role;
    status?: "active" | "invited" | "deactivated";
    avatarUrl?: string;
}

/** Bulk-insert users with controlled ids in one round-trip. */
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

const countWorkspaceActivity = async (): Promise<number> => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

// Each test truncates all 31 tables in `beforeEach`; match the headroom the
// project's other DB-heavy suites use so a slow truncate never trips jest's 5s
// default. Widens no assertion.
jest.setTimeout(30_000);

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/users/:id", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with a bare User (no list envelope)", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);
            const target = await makeUser({ workspaceId: caller.workspaceId });

            const res = await client.get(url(target.id));

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(target.id);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body).not.toHaveProperty("pagination");
        });

        it("reads the caller's own id (parity with /auth/me)", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url(caller.id));

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(caller.id);
            expect(res.body.email).toBe(caller.email);
        });

        it("shapes the body as exactly the 10 wire fields", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url(caller.id));

            expect(Object.keys(res.body).sort()).toEqual(EXPECTED_KEYS);
        });

        it("maps snake_case fields and a set avatar_url through", async () => {
            const ws = await makeWorkspace();
            await seedUsers(ws.id, [
                {
                    id: "u-000",
                    firstName: "Rahim",
                    lastName: "Uddin",
                    email: "rahim@seed.test",
                    role: "admin",
                    avatarUrl: "https://cdn.test/a.png",
                },
            ]);
            const client = await makeLoggedInClient({
                id: "u-000",
                workspaceId: ws.id,
                role: "admin",
            });

            const res = await client.get(url("u-000"));

            expect(res.body).toMatchObject({
                id: "u-000",
                first_name: "Rahim",
                last_name: "Uddin",
                email: "rahim@seed.test",
                role: "admin",
                avatar_url: "https://cdn.test/a.png",
                status: "active",
            });
        });

        it("emits created_at as ISO-8601 and a null last_login_at/avatar_url", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url(caller.id));

            expect(res.body.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            );
            expect(res.body.last_login_at).toBeNull();
            expect(res.body.avatar_url).toBeNull();
        });
    });

    // ─── b. Response shape / leak guards ─────────────────────────────────────
    describe("Leak guards", () => {
        it("never leaks password_hash, workspace_id, or updated_at", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url(caller.id));

            expect(res.body).not.toHaveProperty("password_hash");
            expect(res.body).not.toHaveProperty("passwordHash");
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("workspaceId");
            expect(res.body).not.toHaveProperty("updated_at");
        });
    });

    // ─── c. Validation (422) ─────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 validation.failed for an over-length id (65 chars)", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url("u".repeat(65)));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(
                res.body.error.details.some(
                    (d: { field?: string }) => d.field === "id",
                ),
            ).toBe(true);
        });

        it("returns 422 for a whitespace-only id (trim → empty)", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url("%20"));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("accepts an id of exactly 64 chars (404, not 422)", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url("u".repeat(64)));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });
    });

    // ─── d. Authentication (401) ─────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const target = await makeUser();
            const http = await oneOff();

            const res = await http.get(url(target.id));

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed bearer token", async () => {
            const target = await makeUser();
            const http = await oneOff();

            const res = await http
                .get(url(target.id))
                .set("Authorization", "Bearer not.a.real.jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const caller = await makeUser();
            const token = signAccess(caller, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();

            const res = await http
                .get(url(caller.id))
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });
    });

    // ─── e. Authorization (🔐 any role; no forbidden tier) ───────────────────
    describe("Authorization", () => {
        const roles: Role[] = ["owner", "admin", "member", "guest"];
        for (const role of roles) {
            it(`allows a ${role} to read another member (200)`, async () => {
                const caller = await makeUser({ role });
                const client = await makeLoggedInClient(caller);
                const target = await makeUser({
                    workspaceId: caller.workspaceId,
                });

                const res = await client.get(url(target.id));

                expect(res.status).toBe(200);
                expect(res.body.id).toBe(target.id);
            });
        }
    });

    // ─── f. Not-found (404) ──────────────────────────────────────────────────
    describe("Not found", () => {
        it("returns 404 user.not_found for an id that exists nowhere", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url("u-does-not-exist"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });
    });

    // ─── g. Tenant / workspace isolation ─────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns 404 (not 200/403) for a user in another workspace", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            await seedUsers(wsA.id, [{ id: "a-000" }]);
            await seedUsers(wsB.id, [{ id: "b-000", email: "b@seed.test" }]);
            const client = await makeLoggedInClient({
                id: "a-000",
                workspaceId: wsA.id,
                role: "member",
            });

            const res = await client.get(url("b-000"));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });

        it("does not leak the cross-tenant user's data in the 404 body", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            await seedUsers(wsA.id, [{ id: "a-000" }]);
            await seedUsers(wsB.id, [{ id: "b-000", email: "secret@seed.test" }]);
            const client = await makeLoggedInClient({
                id: "a-000",
                workspaceId: wsA.id,
                role: "member",
            });

            const res = await client.get(url("b-000"));

            expect(JSON.stringify(res.body)).not.toContain("secret@seed.test");
        });
    });

    // ─── h. Status variants (no status filter on by-id read) ─────────────────
    describe("Status variants", () => {
        const statuses: Array<"invited" | "deactivated"> = [
            "invited",
            "deactivated",
        ];
        for (const status of statuses) {
            it(`returns 200 and reflects status for an ${status} member`, async () => {
                const caller = await makeUser();
                const client = await makeLoggedInClient(caller);
                const target = await makeUser({
                    workspaceId: caller.workspaceId,
                    status,
                });

                const res = await client.get(url(target.id));

                expect(res.status).toBe(200);
                expect(res.body.status).toBe(status);
            });
        }
    });

    // ─── i. Edge / security values ───────────────────────────────────────────
    describe("Edge values", () => {
        it("treats a SQL-injection-shaped id as a literal (404, no 500)", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(
                url(encodeURIComponent("' OR '1'='1")),
            );

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });

        it("handles a unicode/emoji id without error (404)", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);

            const res = await client.get(url(encodeURIComponent("🙂-ও-id")));

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
        });
    });

    // ─── j. Side-effects (read is not a mutation) ────────────────────────────
    describe("Side-effects", () => {
        it("writes no workspace_activity row on a successful read", async () => {
            const caller = await makeUser();
            const client = await makeLoggedInClient(caller);
            const target = await makeUser({ workspaceId: caller.workspaceId });

            const before = await countWorkspaceActivity();
            await client.get(url(target.id));
            const after = await countWorkspaceActivity();

            expect(after).toBe(before);
        });
    });
});
