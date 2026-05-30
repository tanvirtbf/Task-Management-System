import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    users,
    sessions,
    workspaceActivity,
    taskActivity,
} from "../../src/db/schema";
import { SHORT_NAME_LENGTH } from "../../src/db/schema/_shared";
import { Config } from "../../src/config";

/**
 * Tests for `GET /api/v1/auth/me` (API_DESIGN.md §2).
 *
 * Patterns mirror `tests/workspace/get-workspace.test.ts` + `tests/auth/login.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - `makeLoggedInClient` mints real cookies via TokenService.
 *   - Stateless supertest via `oneOff()` for the negative / header-auth paths.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 *
 * N/A categories (documented, not skipped):
 *   - Validation: GET takes no body / no path params / no required query.
 *   - Authorization "forbidden": whoami is member-tier; every role may read its
 *     own identity, so no role is denied.
 *   - Conflict / ETag: safe read, no unique keys, no If-Match on GET.
 *   - Idempotency: safe method; spec requires Idempotency-Key only on POSTs.
 *   - Pagination: single resource, not a list.
 *   - Cleanup/rollback: no writes, no transaction.
 */

// Each test truncates all 31 tables in `beforeEach` (~3-4s on this harness),
// and the 50-parallel concurrency case briefly saturates the pool + supertest's
// ephemeral servers, pushing the *next* hook past jest's 5s default. Give the
// whole DB-backed suite the same headroom the project's other DB-heavy suites
// use (jest.workspace.config.cjs runs at 30s). This widens no assertion.
jest.setTimeout(30_000);

const PATH = "/api/v1/auth/me";

/** The exact Appendix-A `User` keys this endpoint returns. */
const EXPECTED_KEYS = [
    "id",
    "first_name",
    "last_name",
    "email",
    "role",
    "avatar_url",
    "status",
    "timezone",
    "created_at",
    "last_login_at",
].sort();

/** Mint a valid HS256 access token the way `TokenService` does. */
const signAccess = (
    payload: { sub: string; role: string; workspaceId: string },
    opts?: jwt.SignOptions,
): string =>
    jwt.sign(payload, Config.ACCESS_TOKEN_SECRET!, {
        algorithm: "HS256",
        expiresIn: "15m",
        issuer: "task-management-server",
        ...opts,
    });

/** GET the endpoint with a bearer access token (no cookie). */
const getWithToken = async (token: string) =>
    (await oneOff()).get(PATH).set("Authorization", `Bearer ${token}`);

/**
 * Patch a user row directly — for fixtures the factory does not expose
 * (`avatar_url`, `last_login_at`, `timezone`).
 */
const setUser = async (
    id: string,
    patch: Partial<{
        avatarUrl: string | null;
        lastLoginAt: Date | null;
        timezone: string;
        firstName: string;
        lastName: string;
    }>,
) => {
    const db = getDb();
    await db.update(users).set(patch).where(eq(users.id, id));
};

const countSessions = async (userId: string) => {
    const db = getDb();
    const rows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, userId));
    return rows.length;
};

const countWorkspaceActivity = async () => {
    const db = getDb();
    return (
        await db.select({ id: workspaceActivity.id }).from(workspaceActivity)
    ).length;
};

const readUserRow = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select({ lastLoginAt: users.lastLoginAt })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
    return row;
};

const countTaskActivity = async () => {
    const db = getDb();
    return (await db.select({ id: taskActivity.id }).from(taskActivity)).length;
};

const countUsers = async () => {
    const db = getDb();
    return (await db.select({ id: users.id }).from(users)).length;
};

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/auth/me", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the caller's own user fields", async () => {
            const u = await makeUser({
                firstName: "Ayesha",
                lastName: "Rahman",
                role: "admin",
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                id: u.id,
                first_name: "Ayesha",
                last_name: "Rahman",
                email: u.email,
                role: "admin",
                avatar_url: null,
                status: "active",
                timezone: "Asia/Dhaka",
                last_login_at: null,
            });
        });

        it("returns exactly the 10 Appendix-A User keys (no password_hash/workspace_id/updated_at)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(Object.keys(res.body).sort()).toEqual(EXPECTED_KEYS);
            expect(res.body).not.toHaveProperty("password_hash");
            expect(res.body).not.toHaveProperty("workspace_id");
            expect(res.body).not.toHaveProperty("updated_at");
        });

        it("returns a bare User object (no envelope, no workspace context)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body).not.toHaveProperty("data");
            expect(res.body).not.toHaveProperty("user");
            expect(res.body).not.toHaveProperty("workspace");
            expect(res.body.id).toBe(u.id);
        });

        it("returns created_at as an ISO-8601 UTC string", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.created_at).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
            );
        });

        it("returns last_login_at as null (present, not omitted) when never logged in", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.last_login_at).toBeNull();
            expect("last_login_at" in res.body).toBe(true);
        });

        it("returns a non-null last_login_at as an ISO-8601 UTC string", async () => {
            const u = await makeUser();
            await setUser(u.id, {
                lastLoginAt: new Date("2026-05-01T08:30:00Z"),
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.last_login_at).toBe("2026-05-01T08:30:00.000Z");
        });

        it("returns avatar_url as null when unset and the string when set", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const unset = await client.get(PATH);
            expect(unset.body.avatar_url).toBeNull();

            await setUser(u.id, {
                avatarUrl: "https://cdn.example.com/avatars/ayesha.png",
            });
            const set = await client.get(PATH);
            expect(set.body.avatar_url).toBe(
                "https://cdn.example.com/avatars/ayesha.png",
            );
        });

        it("reflects the LIVE DB role, not the (stale) token role claim", async () => {
            // Token minted while the user was a member; row then promoted to
            // admin. /auth/me re-reads the row, so it must report admin.
            const u = await makeUser({ role: "member" });
            const client = await makeLoggedInClient(u);
            const db = getDb();
            await db
                .update(users)
                .set({ role: "admin" })
                .where(eq(users.id, u.id));

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(res.body.role).toBe("admin");
        });

        it("authenticates via the Authorization: Bearer header (not only cookie)", async () => {
            const u = await makeUser();
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: u.workspaceId,
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });

        it("sets Content-Type application/json and an X-Request-Id header", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(res.get("Content-Type")).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when no token is supplied", async () => {
            const res = await (await oneOff()).get(PATH);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 auth.invalid_token for a malformed token", async () => {
            const res = await getWithToken("not-a-real-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token for an expired token", async () => {
            const token = signAccess(
                { sub: "u-x", role: "member", workspaceId: "ws-x" },
                { expiresIn: "-1s" },
            );

            const res = await getWithToken(token);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("returns 401 auth.invalid_token for a token signed with the wrong secret", async () => {
            const token = jwt.sign(
                { sub: "u-x", role: "member", workspaceId: "ws-x" },
                "an-entirely-different-secret-value-32chars",
                { algorithm: "HS256", expiresIn: "15m" },
            );

            const res = await getWithToken(token);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.missing_token for an Authorization header carrying no token", async () => {
            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", "Bearer");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("rejects a non-Bearer Authorization scheme with a 401", async () => {
            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", "Basic dXNlcjpwYXNzd29yZA==");

            expect(res.status).toBe(401);
            expect(["auth.missing_token", "auth.invalid_token"]).toContain(
                res.body.error.code,
            );
        });
    });

    // ─── d. Authorization (every role tier reads its own identity) ────────────
    describe("Authorization (role tiers)", () => {
        it.each(["owner", "admin", "member", "guest"] as const)(
            "allows a %s to read their own identity (200)",
            async (role) => {
                const u = await makeUser({ role });
                const client = await makeLoggedInClient(u);

                const res = await client.get(PATH);

                expect(res.status).toBe(200);
                expect(res.body.id).toBe(u.id);
                expect(res.body.role).toBe(role);
            },
        );
    });

    // ─── e. Identity lifecycle ────────────────────────────────────────────────
    describe("Identity lifecycle", () => {
        it("returns 404 user.not_found when the JWT sub has no row", async () => {
            const token = signAccess({
                sub: "u-ghost",
                role: "member",
                workspaceId: "ws-x",
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("user.not_found");
            expect(res.body.error.request_id).toMatch(/^req_/);
        });

        it("still returns 200 for a deactivated user holding a valid access token", async () => {
            // Documented behaviour: deactivation revokes refresh tokens, not the
            // already-issued access token (valid <=15 min). Reads do not
            // re-check user.status per request — matches API_DESIGN.md §2/§4.
            const u = await makeUser({ status: "deactivated" });
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: u.workspaceId,
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
            expect(res.body.status).toBe("deactivated");
        });

        it("returns the invited status as-is for an invited user", async () => {
            const u = await makeUser({ status: "invited" });
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: u.workspaceId,
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("invited");
        });
    });

    // ─── g. Tenant isolation / self-only ──────────────────────────────────────
    describe("Tenant isolation (self-only)", () => {
        it("returns the caller's own record, never another user's", async () => {
            const ws = await makeWorkspace();
            const me = await makeUser({ workspaceId: ws.id, firstName: "Me" });
            const other = await makeUser({
                workspaceId: ws.id,
                firstName: "Other",
            });
            const client = await makeLoggedInClient(me);

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(me.id);
            expect(res.body.first_name).toBe("Me");
            expect(res.body.id).not.toBe(other.id);
        });

        it("ignores a ?user_id query param pointing at another user", async () => {
            const me = await makeUser();
            const other = await makeUser();
            const client = await makeLoggedInClient(me);

            const res = await client.get(`${PATH}?user_id=${other.id}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(me.id);
        });

        it("resolves by sub only — a wrong workspaceId claim does not change the result", async () => {
            // /me must key off the verified `sub`, never the token's
            // workspaceId claim. A forged/stale workspace claim must not gate or
            // redirect the lookup.
            const u = await makeUser();
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: "ws-some-other-tenant",
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode (Bangla + emoji) name", async () => {
            const u = await makeUser();
            await setUser(u.id, { firstName: "আয়েশা 🌸", lastName: "রহমান" });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.first_name).toBe("আয়েশা 🌸");
            expect(res.body.last_name).toBe("রহমান");
        });

        it(`round-trips a max-length (${SHORT_NAME_LENGTH}-char) first and last name`, async () => {
            // The true boundary is the schema column width (VARCHAR
            // SHORT_NAME_LENGTH), bound to the constant so the test can never
            // drift from the schema.
            const u = await makeUser();
            const maxName = "a".repeat(SHORT_NAME_LENGTH);
            await setUser(u.id, { firstName: maxName, lastName: maxName });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.first_name).toBe(maxName);
            expect(res.body.last_name).toBe(maxName);
        });

        it("round-trips an RTL (Arabic) name", async () => {
            const u = await makeUser();
            await setUser(u.id, { firstName: "عائشة", lastName: "رحمان" });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.first_name).toBe("عائشة");
            expect(res.body.last_name).toBe("رحمان");
        });

        it("round-trips an accented Latin name (diacritics preserved)", async () => {
            // "e" + U+0301 (combining acute) — must survive byte-for-byte, not
            // get NFC-normalised away.
            const combining = "José";
            const u = await makeUser();
            await setUser(u.id, { firstName: combining });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.first_name).toBe(combining);
        });

        it("preserves leading/trailing whitespace in a name (serializer does not trim)", async () => {
            const padded = "  Ayesha  ";
            const u = await makeUser();
            await setUser(u.id, { firstName: padded });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.first_name).toBe(padded);
        });

        it("returns an empty-string name as '' (not null, not omitted)", async () => {
            const u = await makeUser();
            await setUser(u.id, { firstName: "" });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.first_name).toBe("");
            expect(res.body.first_name).not.toBeNull();
        });

        it("round-trips a plus-addressed email verbatim (no alias stripping)", async () => {
            const email = "ayesha+work@example.test";
            const u = await makeUser({ email });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.email).toBe(email);
        });

        it("round-trips a non-default timezone", async () => {
            const u = await makeUser();
            await setUser(u.id, { timezone: "America/New_York" });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.timezone).toBe("America/New_York");
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("creates no new sessions on read", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const before = await countSessions(u.id);

            await client.get(PATH);

            expect(await countSessions(u.id)).toBe(before);
        });

        it("does NOT touch last_login_at (whoami is not a login)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            await client.get(PATH);

            expect((await readUserRow(u.id)).lastLoginAt).toBeNull();
        });

        it("writes zero workspace_activity rows (read-only)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            await client.get(PATH);

            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("writes zero task_activity rows (read-only)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            await client.get(PATH);

            expect(await countTaskActivity()).toBe(0);
        });

        it("creates no new user rows on read", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const before = await countUsers();

            await client.get(PATH);

            expect(await countUsers()).toBe(before);
        });

        it("persists nothing on the 404 path (valid token, missing user row)", async () => {
            const token = signAccess({
                sub: "u-ghost",
                role: "member",
                workspaceId: "ws-x",
            });
            const before = await countUsers();

            const res = await getWithToken(token);

            expect(res.status).toBe(404);
            expect(await countUsers()).toBe(before);
            expect(await countSessions("u-ghost")).toBe(0);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent bodies", async () => {
            const u = await makeUser({ firstName: "Parallel" });
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(PATH)),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(r.body.id).toBe(u.id);
                expect(r.body.first_name).toBe("Parallel");
            }
        });
    });

    // ─── Cross-cutting: Request-ID ────────────────────────────────────────────
    describe("Request-ID", () => {
        it("generates a fresh X-Request-Id on a successful read", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("echoes a client-supplied X-Request-Id verbatim on the error path", async () => {
            const supplied = "trace_me_42";
            const res = await (await oneOff())
                .get(PATH)
                .set("X-Request-Id", supplied);

            expect(res.status).toBe(401);
            expect(res.get("X-Request-Id")).toBe(supplied);
            expect(res.body.error.request_id).toBe(supplied);
        });
    });

    // ─── Exploratory / surface-area probes ────────────────────────────────────
    describe("Exploratory", () => {
        it("returns 404 route.not_found for POST on the me URL", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.post(PATH);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 route.not_found for an unknown sub-path", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${PATH}/extra`);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("ignores a request body on a GET and still returns 200", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH).send({ unexpected: "payload" });

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });

        it("ignores a stale bb_refresh cookie when a valid access token is present", async () => {
            const u = await makeUser();
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: u.workspaceId,
            });

            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", `Bearer ${token}`)
                .set("Cookie", "bb_refresh=garbage-stale-value");

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });

        it("accepts a lowercase `bearer` scheme (RFC 6750 case-insensitive)", async () => {
            const u = await makeUser();
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: u.workspaceId,
            });

            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", `bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });

        it("authenticates via the accessToken cookie alone (no Authorization header)", async () => {
            const u = await makeUser();
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: u.workspaceId,
            });

            const res = await (await oneOff())
                .get(PATH)
                .set("Cookie", `accessToken=${token}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });

        it("ignores a very long junk query string and still returns 200", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${PATH}?junk=${"x".repeat(2000)}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });

        it("ignores duplicated ?user_id params and returns the caller", async () => {
            const me = await makeUser();
            const other = await makeUser();
            const client = await makeLoggedInClient(me);

            const res = await client.get(
                `${PATH}?user_id=${me.id}&user_id=${other.id}`,
            );

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(me.id);
        });

        it("returns a stable created_at across repeated reads (immutable)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const first = await client.get(PATH);
            const second = await client.get(PATH);

            expect(first.body.created_at).toBe(second.body.created_at);
        });

        it("supports a HEAD request on the route (200, no body)", async () => {
            const u = await makeUser();
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: u.workspaceId,
            });

            const res = await (await oneOff())
                .head(PATH)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.text).toBeFalsy();
        });

        it("matches the route with a trailing slash (/auth/me/)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${PATH}/`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(u.id);
        });
    });
});
