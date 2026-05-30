import jwt from "jsonwebtoken";
import { and, eq, isNull } from "drizzle-orm";
import type TestAgent from "supertest/lib/agent";
import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    sessions,
    users,
    taskActivity,
    workspaceActivity,
} from "../../src/db/schema";
import { sha256, fakeId } from "../../src/utils";
import { Config } from "../../src/config";

/**
 * Tests for `POST /api/v1/auth/logout`.
 *
 * Patterns mirror `tests/auth/login.test.ts` and `tests/auth/refresh.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - Stateless supertest via `oneOff()` — no agent-level cookie magic.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 *
 * Each test exercises real bcrypt (login → logout chain) and the first
 * iteration of the suite pays a cold-cache cost; raise jest's default 5s
 * timeout so the first test does not flake on slower CI / first runs.
 */
jest.setTimeout(20000);

const POST_LOGIN = "/api/v1/auth/login";
const POST_LOGOUT = "/api/v1/auth/logout";
const POST_REFRESH = "/api/v1/auth/refresh";

// ─── small helpers ───────────────────────────────────────────────────────────

const cookieValue = (
    setCookie: string | string[] | undefined,
    name: string,
): string | null => {
    if (!setCookie) return null;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const entry of list) {
        const match = entry.match(new RegExp(`^${name}=([^;]+)`));
        if (match) return decodeURIComponent(match[1]);
    }
    return null;
};

const cookieLine = (
    setCookie: string | string[] | undefined,
    name: string,
): string | null => {
    if (!setCookie) return null;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    return list.find((entry) => entry.startsWith(`${name}=`)) ?? null;
};

const countSessions = async (userId: string) => {
    const db = getDb();
    const rows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, userId));
    return rows.length;
};

const countActiveSessions = async (userId: string) => {
    const db = getDb();
    const rows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    return rows.length;
};

const countTaskActivity = async () => {
    const db = getDb();
    return (await db.select({ id: taskActivity.id }).from(taskActivity)).length;
};

const countWorkspaceActivity = async () => {
    const db = getDb();
    return (await db.select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;
};

const findSessionById = async (sessionId: string) => {
    const db = getDb();
    const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
    return row ?? null;
};

interface LoginTokens {
    accessToken: string;
    refreshCookie: string;
    sessionId: string;
}

/**
 * Login via the real endpoint and harvest the access token, refresh cookie,
 * and session id. Tests rebuild the same auth context the browser holds.
 */
const loginAndGetTokens = async (
    http: TestAgent,
    email: string,
    password: string,
): Promise<LoginTokens> => {
    const res = await http.post(POST_LOGIN).send({ email, password });
    if (res.status !== 200) {
        throw new Error(
            `loginAndGetTokens: expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
        );
    }
    const accessToken: unknown = res.body.access_token;
    const refreshCookie = cookieValue(res.get("set-cookie"), "bb_refresh");
    if (typeof accessToken !== "string" || !refreshCookie) {
        throw new Error("loginAndGetTokens: missing access_token or bb_refresh");
    }
    const decoded = jwt.decode(accessToken) as { id?: string } | null;
    const sessionId = decoded?.id;
    if (!sessionId) {
        throw new Error("loginAndGetTokens: access token has no id claim");
    }
    return { accessToken, refreshCookie, sessionId };
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/auth/logout", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body on a valid Bearer token", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
        });

        it("emits a Set-Cookie that clears bb_refresh with matching attributes", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            const line = cookieLine(res.get("set-cookie"), "bb_refresh");
            expect(line).not.toBeNull();
            // Attributes MUST match the set-time attributes or the browser
            // keeps the cookie.
            expect(line).toMatch(/Path=\/api\/v1\/auth/i);
            expect(line).toMatch(/HttpOnly/i);
            expect(line).toMatch(/SameSite=Strict/i);
            // The clear line carries either an empty value or an expiry in the
            // past — express's `clearCookie` does the latter.
            expect(line).toMatch(/Expires=Thu, 01 Jan 1970/i);
        });

        it("marks the bound sessions row as revoked", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken, sessionId } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const before = await findSessionById(sessionId);
            expect(before!.revokedAt).toBeNull();

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            const after = await findSessionById(sessionId);
            expect(after!.revokedAt).not.toBeNull();
        });

        it("leaves other sessions for the same user untouched (no mass-revoke)", async () => {
            const u = await makeUser();
            const http = await oneOff();
            // Two logins → two active sessions.
            const a = await loginAndGetTokens(http, u.email, u.password);
            const b = await loginAndGetTokens(http, u.email, u.password);
            expect(await countActiveSessions(u.id)).toBe(2);

            // Logout the FIRST one only.
            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${a.accessToken}`);

            // First session revoked; second still active.
            const aRow = await findSessionById(a.sessionId);
            const bRow = await findSessionById(b.sessionId);
            expect(aRow!.revokedAt).not.toBeNull();
            expect(bRow!.revokedAt).toBeNull();
            expect(await countActiveSessions(u.id)).toBe(1);
        });

        it("makes /auth/refresh with the now-revoked cookie trigger reuse-detection mass-revoke", async () => {
            const u = await makeUser();
            const http = await oneOff();
            // Two sessions: the one we'll logout, plus a sibling that must
            // ALSO be revoked when reuse fires.
            const a = await loginAndGetTokens(http, u.email, u.password);
            const b = await loginAndGetTokens(http, u.email, u.password);

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${a.accessToken}`);

            // Now try to refresh with the cookie of the logged-out session.
            const refreshRes = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${a.refreshCookie}`);

            expect(refreshRes.status).toBe(401);
            expect(refreshRes.body.error.code).toBe("auth.invalid_refresh");

            // Reuse detection mass-revoked the sibling too.
            const bRow = await findSessionById(b.sessionId);
            expect(bRow!.revokedAt).not.toBeNull();
        });

        it("does NOT blacklist the access token — it keeps validating until natural expiry", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            // Same token used a second time → still authenticates (the route
            // wraps a 204 idempotently); confirms NO access-token blacklist.
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(204);
        });

        it("writes no task_activity or workspace_activity rows", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );
            const taskBefore = await countTaskActivity();
            const wsBefore = await countWorkspaceActivity();

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(await countTaskActivity()).toBe(taskBefore);
            expect(await countWorkspaceActivity()).toBe(wsBefore);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 204 when body is arbitrary JSON (body is ignored)", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ malicious: "ignore-me", nested: { also: 1 } });

            expect(res.status).toBe(204);
        });

        it("returns 400 bad_request on malformed JSON body", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Content-Type", "application/json")
                .send("{not json");

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("bad_request");
        });
    });

    // ─── c. Authentication ────────────────────────────────────────────────────
    describe("Authentication", () => {
        it("returns 401 auth.missing_token when Authorization is absent", async () => {
            const http = await oneOff();
            const res = await http.post(POST_LOGOUT);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("returns 401 when the Bearer token is empty", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", "Bearer ");

            expect(res.status).toBe(401);
            // Empty bearer is treated as a missing credential by express-jwt's
            // default getToken AND by our custom getToken.
            expect(["auth.missing_token", "auth.invalid_token"]).toContain(
                res.body.error.code,
            );
        });

        it("returns 401 auth.invalid_token when the Bearer is not a JWT", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", "Bearer not-a-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token when JWT is signed with the wrong secret", async () => {
            const u = await makeUser();
            const forged = jwt.sign(
                {
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    id: fakeId("ses"),
                },
                "wrong-secret",
                { algorithm: "HS256", expiresIn: "15m" },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.invalid_token when JWT is signed with REFRESH_TOKEN_SECRET", async () => {
            const u = await makeUser();
            const forged = jwt.sign(
                {
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    id: fakeId("ses"),
                },
                Config.REFRESH_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "15m" },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 when JWT uses alg: none (whitelist denies it)", async () => {
            const u = await makeUser();
            const header = Buffer.from(
                JSON.stringify({ alg: "none", typ: "JWT" }),
            ).toString("base64url");
            const payload = Buffer.from(
                JSON.stringify({
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    id: fakeId("ses"),
                    exp: Math.floor(Date.now() / 1000) + 900,
                }),
            ).toString("base64url");
            const noneToken = `${header}.${payload}.`;

            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${noneToken}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("returns 401 auth.expired_token when the access token is expired", async () => {
            const u = await makeUser();
            const expired = jwt.sign(
                {
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    id: fakeId("ses"),
                },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: -10 },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${expired}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.expired_token");
        });

        it("returns 204 when the user was deactivated AFTER login (access token still valid)", async () => {
            // Per API_DESIGN.md §2: the access token keeps validating until
            // natural expiry; account-status enforcement is the deactivate
            // endpoint's job.
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken, sessionId } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const db = getDb();
            await db
                .update(users)
                .set({ status: "deactivated" })
                .where(eq(users.id, u.id));

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(204);
            const row = await findSessionById(sessionId);
            expect(row!.revokedAt).not.toBeNull();
        });
    });

    // ─── e. Resource lifecycle ────────────────────────────────────────────────
    describe("Session lifecycle", () => {
        it("is idempotent on an already-revoked session", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken, sessionId } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const first = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(first.status).toBe(204);
            const firstRow = await findSessionById(sessionId);
            const firstRevokedAt = firstRow!.revokedAt!.getTime();

            // Second call: re-stamps revoked_at, still 204.
            await new Promise((r) => setTimeout(r, 1100));
            const second = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(second.status).toBe(204);
            const secondRow = await findSessionById(sessionId);
            expect(secondRow!.revokedAt!.getTime()).toBeGreaterThanOrEqual(
                firstRevokedAt,
            );
        });

        it("returns 204 when the bound sessions row has been hard-deleted", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken, sessionId } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const db = getDb();
            await db.delete(sessions).where(eq(sessions.id, sessionId));

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(res.status).toBe(204);
        });

        it("returns 204 and clears the cookie when the JWT carries no id claim", async () => {
            // Simulate an older access token shape (pre-`id` claim).
            const u = await makeUser();
            const olderToken = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "15m" },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${olderToken}`);

            expect(res.status).toBe(204);
            const line = cookieLine(res.get("set-cookie"), "bb_refresh");
            expect(line).not.toBeNull();
            // No sessions row was ever inserted (we built the token by hand).
            expect(await countSessions(u.id)).toBe(0);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("revoking A's session does not touch B's session", async () => {
            const wsA = await makeWorkspace({ name: "WS-A" });
            const wsB = await makeWorkspace({ name: "WS-B" });
            const userA = await makeUser({
                workspaceId: wsA.id,
                email: "a@x.test",
            });
            const userB = await makeUser({
                workspaceId: wsB.id,
                email: "b@x.test",
            });

            const http = await oneOff();
            const a = await loginAndGetTokens(http, userA.email, userA.password);
            const b = await loginAndGetTokens(http, userB.email, userB.password);

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${a.accessToken}`);

            const aRow = await findSessionById(a.sessionId);
            const bRow = await findSessionById(b.sessionId);
            expect(aRow!.revokedAt).not.toBeNull();
            expect(bRow!.revokedAt).toBeNull();
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("two sequential logouts with the same Bearer both return 204", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const r1 = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);
            const r2 = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(r1.status).toBe(204);
            expect(r2.status).toBe(204);
        });

        it("10 parallel logouts with the same Bearer all return 204 and the session ends revoked once", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken, sessionId } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    http
                        .post(POST_LOGOUT)
                        .set("Authorization", `Bearer ${accessToken}`),
                ),
            );
            for (const r of results) {
                expect(r.status).toBe(204);
            }

            const row = await findSessionById(sessionId);
            expect(row!.revokedAt).not.toBeNull();
            // No duplicate session rows were created.
            expect(await countSessions(u.id)).toBe(1);
        });

        it("logout then login again inserts a fresh session row and preserves the revoked one", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken: at1, sessionId: sid1 } =
                await loginAndGetTokens(http, u.email, u.password);

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${at1}`);

            const { sessionId: sid2 } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );
            expect(sid2).not.toBe(sid1);

            // Two rows: the revoked one, plus the freshly minted active one.
            expect(await countSessions(u.id)).toBe(2);
            expect(await countActiveSessions(u.id)).toBe(1);
            const oldRow = await findSessionById(sid1);
            expect(oldRow!.revokedAt).not.toBeNull();
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts Content-Type: text/plain — body is ignored", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Content-Type", "text/plain")
                .send("anything");

            expect(res.status).toBe(204);
        });

        it("returns 401 deterministically for an absurdly long garbage Bearer (no 500)", async () => {
            const http = await oneOff();
            const huge = "x".repeat(8000);
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${huge}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_token");
        });

        it("clears the cookie even when the request also carries a bb_refresh cookie", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken, refreshCookie } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Cookie", `bb_refresh=${refreshCookie}`);

            expect(res.status).toBe(204);
            const line = cookieLine(res.get("set-cookie"), "bb_refresh");
            expect(line).not.toBeNull();
            expect(line).toMatch(/Expires=Thu, 01 Jan 1970/i);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("does not change the sessions row count for the user", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );
            const before = await countSessions(u.id);

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(await countSessions(u.id)).toBe(before);
        });

        it("does not write task_activity rows", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const before = await countTaskActivity();
            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(await countTaskActivity()).toBe(before);
        });

        it("does not write workspace_activity rows", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const before = await countWorkspaceActivity();
            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);
            expect(await countWorkspaceActivity()).toBe(before);
        });

        it("does NOT update users.last_login_at on logout", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );
            // Wait for login's fire-and-forget last_login_at update.
            await new Promise((r) => setTimeout(r, 200));

            const db = getDb();
            const [pre] = await db
                .select({ lastLoginAt: users.lastLoginAt })
                .from(users)
                .where(eq(users.id, u.id))
                .limit(1);

            await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`);
            await new Promise((r) => setTimeout(r, 200));

            const [post] = await db
                .select({ lastLoginAt: users.lastLoginAt })
                .from(users)
                .where(eq(users.id, u.id))
                .limit(1);
            expect(post.lastLoginAt!.getTime()).toBe(pre.lastLoginAt!.getTime());
        });
    });

    // ─── Cross-cutting: Request-Id ────────────────────────────────────────────
    describe("Request-Id", () => {
        it("generates a fresh X-Request-Id when none is supplied (failure path)", async () => {
            const http = await oneOff();
            const res = await http.post(POST_LOGOUT);
            expect(res.status).toBe(401);
            expect(typeof res.body.error.request_id).toBe("string");
            expect(res.body.error.request_id.length).toBeGreaterThan(8);
        });

        it("echoes a client-supplied X-Request-Id verbatim on the 204 success", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const rid = "rid-logout-test-12345";
            const res = await http
                .post(POST_LOGOUT)
                .set("X-Request-Id", rid)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(204);
            expect(res.get("x-request-id")).toBe(rid);
        });
    });

    // ─── Exploratory: surprising inputs / surface-area probes ─────────────────
    describe("Exploratory", () => {
        it("returns 404 with the spec envelope for GET on the logout URL", async () => {
            const http = await oneOff();
            const res = await http.get(POST_LOGOUT);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 for PUT/DELETE/PATCH on the logout URL", async () => {
            const http = await oneOff();
            for (const verb of ["put", "delete", "patch"] as const) {
                const res = await http[verb](POST_LOGOUT);
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe("route.not_found");
            }
        });

        it("succeeds with Content-Type: application/json; charset=utf-8", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Content-Type", "application/json; charset=utf-8")
                .send({});

            expect(res.status).toBe(204);
        });

        it("rejects bad Authorization scheme deterministically (not Bearer)", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Basic ${accessToken}`);

            expect(res.status).toBe(401);
            // Could be missing_token or invalid_token; we just guarantee it
            // is one of the spec-defined 401 codes and is NOT a 500.
            expect(["auth.missing_token", "auth.invalid_token"]).toContain(
                res.body.error.code,
            );
        });

        it("survives 50 parallel logouts from 50 distinct users", async () => {
            // Stress the connection pool + JWT verify path.
            const http = await oneOff();
            const tokens: string[] = [];
            const ids: string[] = [];
            for (let i = 0; i < 50; i++) {
                const u = await makeUser({ email: `stress-${i}@x.test` });
                const { accessToken, sessionId } = await loginAndGetTokens(
                    http,
                    u.email,
                    u.password,
                );
                tokens.push(accessToken);
                ids.push(sessionId);
            }

            const results = await Promise.all(
                tokens.map((t) =>
                    http
                        .post(POST_LOGOUT)
                        .set("Authorization", `Bearer ${t}`),
                ),
            );
            for (const r of results) {
                expect(r.status).toBe(204);
            }

            // Every targeted session row is now revoked.
            for (const sid of ids) {
                const row = await findSessionById(sid);
                expect(row!.revokedAt).not.toBeNull();
            }
        });

        it("ignores an unknown `kid` header on a properly-signed JWT", async () => {
            const u = await makeUser();
            // Manually sign with a `kid` (key id) header — express-jwt verifies
            // by passing our static secret regardless of `kid`.
            const sessionId = fakeId("ses");
            const db = getDb();
            await db.insert(sessions).values({
                id: sessionId,
                userId: u.id,
                tokenHash: sha256("placeholder"),
                expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            });
            const token = jwt.sign(
                {
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    id: sessionId,
                },
                Config.ACCESS_TOKEN_SECRET!,
                {
                    algorithm: "HS256",
                    expiresIn: "15m",
                    keyid: "rotated-2024",
                },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).toBe(204);
            const row = await findSessionById(sessionId);
            expect(row!.revokedAt).not.toBeNull();
        });

        it("accepts a JWT with extra harmless claims", async () => {
            const u = await makeUser();
            const sessionId = fakeId("ses");
            const db = getDb();
            await db.insert(sessions).values({
                id: sessionId,
                userId: u.id,
                tokenHash: sha256("placeholder"),
                expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            });
            const token = jwt.sign(
                {
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    id: sessionId,
                    extra_marker: "should-be-ignored",
                    nested: { also: "ignored" },
                },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "15m" },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(204);
        });

        it("handles a deeply nested JSON body without crashing", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            let nested: object = { leaf: true };
            for (let i = 0; i < 20; i++) nested = { wrap: nested };

            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ payload: nested });
            expect(res.status).toBe(204);
        });

        it("returns 413 when the body exceeds the 1 MB limit", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { accessToken } = await loginAndGetTokens(
                http,
                u.email,
                u.password,
            );

            const huge = "x".repeat(2 * 1024 * 1024); // 2 MB
            const res = await http
                .post(POST_LOGOUT)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ blob: huge });

            expect(res.status).toBe(413);
            expect(res.body.error.code).toBe("payload.too_large");
        });
    });

    // ─── Cross-cutting: Error envelope ────────────────────────────────────────
    describe("Error envelope", () => {
        it("renders {error: {code, message, request_id}} on every failure path", async () => {
            const http = await oneOff();
            const res = await http.post(POST_LOGOUT);

            expect(res.status).toBe(401);
            expect(res.body).toEqual({
                error: {
                    code: "auth.missing_token",
                    message: expect.any(String),
                    request_id: expect.any(String),
                },
            });
        });
    });
});
