import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeUser,
    makeWorkspace,
    makeLoggedInClient,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { workspaces, sessions, workspaceActivity } from "../../src/db/schema";
import { Config } from "../../src/config";

/**
 * Tests for `GET /api/v1/workspace` (API_DESIGN.md §3).
 *
 * Patterns mirror `tests/auth/login.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - `makeLoggedInClient` mints real cookies via TokenService.
 *   - Stateless supertest via `oneOff()` for the negative / header-auth paths.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 *
 * N/A categories (documented, not skipped):
 *   - Validation: GET takes no body / no path params / no required query.
 *   - Authorization "forbidden": read is member-tier; no role is denied (role
 *     gating lands on PATCH /workspace).
 *   - Archived/restored: `workspaces` has no archived_at / deleted_at column.
 *   - Conflict / ETag: safe read, no unique keys, no If-Match on GET.
 *   - Idempotency: safe method; spec requires Idempotency-Key only on POSTs.
 *   - Pagination: single resource, not a list.
 *   - Cleanup/rollback: no writes, no transaction.
 */

const PATH = "/api/v1/workspace";

type WeekDay = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

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
 * Patch a workspace row directly — for boundary fixtures the factory does not
 * expose (working_days, week_starts_on, fiscal_year_start_month).
 */
const setWorkspace = async (
    id: string,
    patch: Partial<{
        name: string;
        logoUrl: string | null;
        workingDays: WeekDay[];
        weekStartsOn: number;
        fiscalYearStartMonth: number;
    }>,
) => {
    const db = getDb();
    await db.update(workspaces).set(patch).where(eq(workspaces.id, id));
};

const countWorkspaceActivity = async () => {
    const db = getDb();
    return (await db.select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;
};

const countSessions = async (userId: string) => {
    const db = getDb();
    const rows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, userId));
    return rows.length;
};

const EXPECTED_KEYS = [
    "id",
    "name",
    "logo_url",
    "timezone",
    "default_locale",
    "week_starts_on",
    "working_days",
    "business_hours_start",
    "business_hours_end",
    "fiscal_year_start_month",
].sort();

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/workspace", () => {
    // ─── a. Happy path (HTTP smoke) ───────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the exact spec-shaped body", async () => {
            const ws = await makeWorkspace({ name: "BeautyBooth" });
            const u = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                id: ws.id,
                name: "BeautyBooth",
                logo_url: null,
                timezone: "Asia/Dhaka",
                default_locale: "en-US",
                week_starts_on: 6,
                working_days: ["sun", "mon", "tue", "wed", "thu"],
                business_hours_start: "09:00:00",
                business_hours_end: "18:00:00",
                fiscal_year_start_month: 7,
            });
        });

        it("returns exactly the 10 Appendix-A keys (no created_at/updated_at/workspace_id)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(Object.keys(res.body).sort()).toEqual(EXPECTED_KEYS);
            expect(res.body).not.toHaveProperty("created_at");
            expect(res.body).not.toHaveProperty("updated_at");
            expect(res.body).not.toHaveProperty("workspace_id");
        });

        it("returns working_days as an array of day-name strings", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(Array.isArray(res.body.working_days)).toBe(true);
            expect(res.body.working_days).toEqual([
                "sun",
                "mon",
                "tue",
                "wed",
                "thu",
            ]);
        });

        it("returns business hours as HH:MM:SS strings", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.business_hours_start).toBe("09:00:00");
            expect(res.body.business_hours_end).toBe("18:00:00");
        });

        it("returns week_starts_on and fiscal_year_start_month as numbers", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(typeof res.body.week_starts_on).toBe("number");
            expect(typeof res.body.fiscal_year_start_month).toBe("number");
        });

        it("returns logo_url as null (present, not omitted) when unset", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.logo_url).toBeNull();
            expect("logo_url" in res.body).toBe(true);
        });

        it("sets Content-Type application/json and an X-Request-Id header", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(res.get("Content-Type")).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("authenticates via the Authorization: Bearer header (not only cookie)", async () => {
            const ws = await makeWorkspace({ name: "HeaderAuth" });
            const u = await makeUser({ workspaceId: ws.id });
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: ws.id,
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(ws.id);
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

        it("still returns 200 for a deactivated user holding a valid access token", async () => {
            // Documented behaviour: deactivation revokes refresh tokens, not the
            // already-issued access token (valid <=15 min). Reads do not re-check
            // user.status per request — matches API_DESIGN.md §2/§4.
            const ws = await makeWorkspace({ name: "StillReadable" });
            const u = await makeUser({
                workspaceId: ws.id,
                status: "deactivated",
            });
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: ws.id,
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(ws.id);
        });
    });

    // ─── d. Authorization (every role tier reads successfully) ────────────────
    describe("Authorization (role tiers)", () => {
        it.each(["owner", "admin", "member", "guest"] as const)(
            "allows a %s to read the workspace (200)",
            async (role) => {
                const u = await makeUser({ role });
                const client = await makeLoggedInClient(u);

                const res = await client.get(PATH);

                expect(res.status).toBe(200);
                expect(res.body.id).toBe(u.workspaceId);
            },
        );
    });

    // ─── e. Resource lifecycle (not found) ────────────────────────────────────
    describe("Not found", () => {
        it("returns 404 workspace.not_found when the JWT workspace has no row", async () => {
            const token = signAccess({
                sub: "u-ghost",
                role: "member",
                workspaceId: "ws-does-not-exist",
            });

            const res = await getWithToken(token);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("workspace.not_found");
            expect(res.body.error.request_id).toMatch(/^req_/);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("returns the caller's workspace, never another tenant's", async () => {
            const wsA = await makeWorkspace({ name: "WS-A" });
            const wsB = await makeWorkspace({ name: "WS-B" });
            const uA = await makeUser({ workspaceId: wsA.id });
            const client = await makeLoggedInClient(uA);

            const res = await client.get(PATH);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(wsA.id);
            expect(res.body.name).toBe("WS-A");
            expect(res.body.id).not.toBe(wsB.id);
        });

        it("ignores a ?workspace_id query param pointing at another tenant", async () => {
            const wsA = await makeWorkspace({ name: "WS-A" });
            const wsB = await makeWorkspace({ name: "WS-B" });
            const uA = await makeUser({ workspaceId: wsA.id });
            const client = await makeLoggedInClient(uA);

            const res = await client.get(`${PATH}?workspace_id=${wsB.id}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(wsA.id);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("round-trips a unicode (Bangla + emoji) workspace name", async () => {
            const name = "বিউটিবুথ 🛍️ ব্র্যান্ড";
            const ws = await makeWorkspace({ name });
            const u = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.name).toBe(name);
        });

        it("round-trips a max-length (120-char) workspace name", async () => {
            const name = "a".repeat(120);
            const ws = await makeWorkspace({ name });
            const u = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.name).toBe(name);
        });

        it("round-trips a non-null logo_url", async () => {
            const ws = await makeWorkspace({ name: "Logo" });
            const u = await makeUser({ workspaceId: ws.id });
            await setWorkspace(ws.id, {
                logoUrl: "https://cdn.example.com/beautybooth-logo.png",
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.logo_url).toBe(
                "https://cdn.example.com/beautybooth-logo.png",
            );
        });

        it("returns all seven working_days in SET-definition order", async () => {
            const ws = await makeWorkspace();
            const u = await makeUser({ workspaceId: ws.id });
            await setWorkspace(ws.id, {
                workingDays: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
            });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.working_days).toEqual([
                "sun",
                "mon",
                "tue",
                "wed",
                "thu",
                "fri",
                "sat",
            ]);
        });

        it("returns a single working day as a one-element array", async () => {
            const ws = await makeWorkspace();
            const u = await makeUser({ workspaceId: ws.id });
            await setWorkspace(ws.id, { workingDays: ["fri"] });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.working_days).toEqual(["fri"]);
        });

        it("returns an empty array when working_days is the empty set", async () => {
            const ws = await makeWorkspace();
            const u = await makeUser({ workspaceId: ws.id });
            await setWorkspace(ws.id, { workingDays: [] });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.working_days).toEqual([]);
        });

        it("returns week_starts_on at the lower boundary (0 = Sunday)", async () => {
            const ws = await makeWorkspace();
            const u = await makeUser({ workspaceId: ws.id });
            await setWorkspace(ws.id, { weekStartsOn: 0 });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH);

            expect(res.body.week_starts_on).toBe(0);
        });

        it("returns fiscal_year_start_month at both boundaries (1 and 12)", async () => {
            const ws = await makeWorkspace();
            const u = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(u);

            await setWorkspace(ws.id, { fiscalYearStartMonth: 1 });
            const low = await client.get(PATH);
            expect(low.body.fiscal_year_start_month).toBe(1);

            await setWorkspace(ws.id, { fiscalYearStartMonth: 12 });
            const high = await client.get(PATH);
            expect(high.body.fiscal_year_start_month).toBe(12);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("writes zero workspace_activity rows (read-only)", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);

            await client.get(PATH);

            expect(await countWorkspaceActivity()).toBe(0);
        });

        it("creates no new sessions on read", async () => {
            const u = await makeUser();
            const client = await makeLoggedInClient(u);
            const before = await countSessions(u.id);

            await client.get(PATH);

            expect(await countSessions(u.id)).toBe(before);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("serves 50 parallel reads with identical, consistent bodies", async () => {
            const ws = await makeWorkspace({ name: "Parallel" });
            const u = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(u);

            const results = await Promise.all(
                Array.from({ length: 50 }, () => client.get(PATH)),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
                expect(r.body.id).toBe(ws.id);
                expect(r.body.name).toBe("Parallel");
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
            const supplied = "trace_workspace_42";
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
        it("returns 404 route.not_found for POST on the workspace URL", async () => {
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

        it("ignores duplicated query params and still returns the caller's workspace", async () => {
            const wsA = await makeWorkspace({ name: "Dup-A" });
            const wsB = await makeWorkspace({ name: "Dup-B" });
            const uA = await makeUser({ workspaceId: wsA.id });
            const client = await makeLoggedInClient(uA);

            const res = await client.get(
                `${PATH}?workspace_id=${wsA.id}&workspace_id=${wsB.id}`,
            );

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(wsA.id);
        });

        it("ignores an unexpected Content-Type on a bodyless GET", async () => {
            const ws = await makeWorkspace({ name: "CT" });
            const u = await makeUser({ workspaceId: ws.id });
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: ws.id,
            });

            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", `Bearer ${token}`)
                .set("Content-Type", "text/plain");

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(ws.id);
        });

        it("ignores a stale bb_refresh cookie when a valid access token is present", async () => {
            const ws = await makeWorkspace({ name: "StaleCookie" });
            const u = await makeUser({ workspaceId: ws.id });
            const token = signAccess({
                sub: u.id,
                role: u.role,
                workspaceId: ws.id,
            });

            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", `Bearer ${token}`)
                .set("Cookie", "bb_refresh=garbage-stale-value");

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(ws.id);
        });

        it("tolerates a very long ignored query string", async () => {
            const ws = await makeWorkspace({ name: "LongQS" });
            const u = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(u);

            const res = await client.get(`${PATH}?junk=${"x".repeat(2000)}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(ws.id);
        });

        it("returns 401 auth.missing_token for an Authorization header carrying no token", async () => {
            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", "Bearer");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("rejects a non-Bearer Authorization scheme with a 401 (no auth)", async () => {
            // The shared `authenticate` middleware honours only a Bearer token or
            // the accessToken cookie; a `Basic` credential authenticates nobody.
            // The security contract is that the request is denied — the exact
            // auth.* sub-code is a middleware-internal detail, not this
            // endpoint's contract.
            const res = await (await oneOff())
                .get(PATH)
                .set("Authorization", "Basic dXNlcjpwYXNzd29yZA==");

            expect(res.status).toBe(401);
            expect(["auth.missing_token", "auth.invalid_token"]).toContain(
                res.body.error.code,
            );
        });

        it("ignores a request body on a GET and still returns 200", async () => {
            const ws = await makeWorkspace({ name: "BodyOnGet" });
            const u = await makeUser({ workspaceId: ws.id });
            const client = await makeLoggedInClient(u);

            const res = await client.get(PATH).send({ unexpected: "payload" });

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(ws.id);
        });
    });
});
