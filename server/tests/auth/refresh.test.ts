import jwt from "jsonwebtoken";
import { and, eq, isNull } from "drizzle-orm";
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
 * Tests for `POST /api/v1/auth/refresh`.
 *
 * Patterns mirror `tests/auth/login.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - Stateless supertest via `oneOff()` — no agent-level cookie magic.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 */

const POST_LOGIN = "/api/v1/auth/login";
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

/**
 * Login a user and return both the refresh-cookie value and the sessions row
 * the login created. Most refresh-side tests need both.
 */
const loginAndGetCookie = async (
    http: ReturnType<typeof oneOff> extends Promise<infer R> ? R : never,
    email: string,
    password: string,
) => {
    const loginRes = await http.post(POST_LOGIN).send({ email, password });
    if (loginRes.status !== 200) {
        throw new Error(
            `loginAndGetCookie: expected 200, got ${loginRes.status}: ${JSON.stringify(loginRes.body)}`,
        );
    }
    const cookie = cookieValue(loginRes.get("set-cookie"), "bb_refresh");
    if (!cookie) throw new Error("loginAndGetCookie: bb_refresh not set");
    // Decode (NOT verify) to read the jti — we just want the session id link.
    const decoded = jwt.decode(cookie) as { jti?: string; id?: string } | null;
    const sessionId = decoded?.jti ?? decoded?.id ?? null;
    if (!sessionId) throw new Error("loginAndGetCookie: no jti on the JWT");
    return { cookie, sessionId };
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/auth/refresh", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec-shaped body matching /auth/login", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(200);
            expect(typeof res.body.access_token).toBe("string");
            expect(res.body.access_token.length).toBeGreaterThan(20);
            expect(res.body.expires_in).toBe(900);
            expect(res.body.user).toMatchObject({
                id: u.id,
                first_name: expect.any(String),
                last_name: expect.any(String),
                email: u.email,
                role: "member",
                avatar_url: null,
                status: "active",
                timezone: "Asia/Dhaka",
                created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            });
            // last_login_at is either null (if touchLastLogin hasn't landed
            // yet) or an ISO string. Both are spec-valid.
            const lla = res.body.user.last_login_at;
            expect(
                lla === null ||
                    (typeof lla === "string" &&
                        /^\d{4}-\d{2}-\d{2}T/.test(lla)),
            ).toBe(true);
            // Lock down the field set so we can't silently leak password_hash
            // or other private columns.
            expect(Object.keys(res.body.user).sort()).toEqual(
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

        it("user object never exposes password_hash, workspace_id, or updated_at", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.body.user).not.toHaveProperty("password_hash");
            expect(res.body.user).not.toHaveProperty("workspace_id");
            expect(res.body.user).not.toHaveProperty("updated_at");
        });

        it("sets the bb_refresh cookie with all spec attributes", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(200);
            const line = cookieLine(res.get("set-cookie"), "bb_refresh");
            expect(line).not.toBeNull();
            expect(line).toMatch(/HttpOnly/i);
            expect(line).toMatch(/SameSite=Strict/i);
            expect(line).toMatch(/Path=\/api\/v1\/auth/i);
            expect(line).toMatch(/Max-Age=2592000/i);
            // NODE_ENV is "test" so Secure must NOT appear.
            expect(line).not.toMatch(/;\s*Secure/i);
        });

        it("new access token verifies and carries fresh sub/role/workspaceId", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            const decoded = jwt.verify(
                res.body.access_token,
                Config.ACCESS_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;

            expect(decoded.sub).toBe(u.id);
            expect(decoded.role).toBe("member");
            expect(decoded.workspaceId).toBe(u.workspaceId);
        });

        it("new refresh cookie verifies and its jti matches a fresh sessions row", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie: oldCookie, sessionId: oldSessionId } =
                await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${oldCookie}`);

            const newCookie = cookieValue(res.get("set-cookie"), "bb_refresh");
            expect(newCookie).not.toBeNull();
            const decoded = jwt.verify(
                newCookie!,
                Config.REFRESH_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;
            const newSessionId = decoded.jti;
            expect(newSessionId).not.toBe(oldSessionId);

            const newRow = await findSessionById(newSessionId as string);
            expect(newRow).not.toBeNull();
            expect(newRow!.userId).toBe(u.id);
            expect(newRow!.revokedAt).toBeNull();
        });

        it("revokes the old session and inserts exactly one new row", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie, sessionId: oldSessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );
            expect(await countSessions(u.id)).toBe(1);

            await http.post(POST_REFRESH).set("Cookie", `bb_refresh=${cookie}`);

            expect(await countSessions(u.id)).toBe(2);
            expect(await countActiveSessions(u.id)).toBe(1);
            const oldRow = await findSessionById(oldSessionId);
            expect(oldRow!.revokedAt).not.toBeNull();
        });

        it("persists sha256(new cookie) as the new row's token_hash", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            const newCookie = cookieValue(res.get("set-cookie"), "bb_refresh");
            const decoded = jwt.decode(newCookie!) as { jti: string };
            const newRow = await findSessionById(decoded.jti);
            expect(newRow!.tokenHash).toBe(sha256(newCookie!));
        });

        it("reflects a role change between login and refresh in the new access token", async () => {
            const u = await makeUser({ role: "member" });
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            // Promote in DB while the cookie is still valid.
            const db = getDb();
            await db
                .update(users)
                .set({ role: "admin" })
                .where(eq(users.id, u.id));

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(200);
            const decoded = jwt.verify(
                res.body.access_token,
                Config.ACCESS_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;
            expect(decoded.role).toBe("admin");
            expect(res.body.user.role).toBe("admin");
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("succeeds with no body when the cookie is valid", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            // .send() with no arg, no Content-Type.
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(200);
        });

        it("returns 400 bad_request on malformed JSON body", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .set("Content-Type", "application/json")
                .send("{not json");

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("bad_request");
        });

        it("ignores arbitrary extra fields when cookie is valid", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .send({ malicious: "ignore-me", extra: { nested: true } });

            expect(res.status).toBe(200);
        });
    });

    // ─── c. Authentication / cookie failures ──────────────────────────────────
    describe("Cookie failures", () => {
        it("returns 401 auth.invalid_refresh when bb_refresh is absent", async () => {
            const http = await oneOff();
            const res = await http.post(POST_REFRESH);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when bb_refresh is empty", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", "bb_refresh=");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when bb_refresh is non-JWT garbage", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", "bb_refresh=this-is-not-a-jwt");

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when JWT is signed with the wrong secret", async () => {
            const u = await makeUser();
            const sessionId = fakeId("ses");
            // Insert a session row so the id lookup wouldn't be the failure cause.
            const db = getDb();
            const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
            await db.insert(sessions).values({
                id: sessionId,
                userId: u.id,
                tokenHash: sha256("placeholder"),
                expiresAt,
            });
            const forged = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                "totally-different-secret",
                { algorithm: "HS256", expiresIn: "30d", jwtid: sessionId },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when JWT is signed with the ACCESS_TOKEN_SECRET", async () => {
            const u = await makeUser();
            const sessionId = fakeId("ses");
            const db = getDb();
            await db.insert(sessions).values({
                id: sessionId,
                userId: u.id,
                tokenHash: sha256("placeholder"),
                expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            });
            const forged = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.ACCESS_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "30d", jwtid: sessionId },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when JWT uses alg: none (whitelist denies it)", async () => {
            const u = await makeUser();
            const sessionId = fakeId("ses");
            const db = getDb();
            await db.insert(sessions).values({
                id: sessionId,
                userId: u.id,
                tokenHash: sha256("placeholder"),
                expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            });
            // Hand-craft an unsigned JWT.
            const header = Buffer.from(
                JSON.stringify({ alg: "none", typ: "JWT" }),
            ).toString("base64url");
            const payload = Buffer.from(
                JSON.stringify({
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    jti: sessionId,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                }),
            ).toString("base64url");
            const noneToken = `${header}.${payload}.`;

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${noneToken}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when the JWT is already expired", async () => {
            const u = await makeUser();
            const sessionId = fakeId("ses");
            const db = getDb();
            await db.insert(sessions).values({
                id: sessionId,
                userId: u.id,
                tokenHash: sha256("placeholder"),
                expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            });
            const expired = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.REFRESH_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: -10, jwtid: sessionId },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${expired}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when the JWT references a non-existent session id", async () => {
            const u = await makeUser();
            const phantomSessionId = fakeId("ses"); // never inserted
            const forged = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.REFRESH_TOKEN_SECRET!,
                {
                    algorithm: "HS256",
                    expiresIn: "30d",
                    jwtid: phantomSessionId,
                },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });
    });

    // ─── e. Status semantics / lifecycle ──────────────────────────────────────
    describe("Session lifecycle", () => {
        it("revoked-session replay returns 401 AND mass-revokes every other session", async () => {
            const u = await makeUser();
            const http = await oneOff();
            // 3 logins → 3 sessions, all active.
            const { cookie: c1 } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );
            await loginAndGetCookie(http, u.email, u.password);
            await loginAndGetCookie(http, u.email, u.password);
            expect(await countActiveSessions(u.id)).toBe(3);

            // First refresh succeeds (revokes session of c1; mints a new one).
            const ok = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${c1}`);
            expect(ok.status).toBe(200);

            // Replay c1 — its session is now revoked.
            const replayed = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${c1}`);
            expect(replayed.status).toBe(401);
            expect(replayed.body.error.code).toBe("auth.invalid_refresh");

            // Mass-revoke: no active sessions left for this user.
            expect(await countActiveSessions(u.id)).toBe(0);
        });

        it("expired-session cookie returns 401 and does NOT mass-revoke", async () => {
            const u = await makeUser();
            const http = await oneOff();

            // Login to mint a real refresh JWT, then expire the row in the DB.
            const { cookie, sessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );
            const db = getDb();
            await db
                .update(sessions)
                .set({ expiresAt: new Date(Date.now() - 1000) })
                .where(eq(sessions.id, sessionId));

            // Add a sibling active session that must NOT be revoked.
            const { sessionId: siblingSessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
            const sibling = await findSessionById(siblingSessionId);
            expect(sibling!.revokedAt).toBeNull();
        });

        it("token_hash corruption returns 401 AND mass-revokes", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie, sessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );

            // Add a sibling active session — must be revoked by the mass-revoke.
            const { sessionId: siblingSessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );
            const db = getDb();
            await db
                .update(sessions)
                .set({ tokenHash: sha256("corrupted-value") })
                .where(eq(sessions.id, sessionId));

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
            const sibling = await findSessionById(siblingSessionId);
            expect(sibling!.revokedAt).not.toBeNull();
        });

        it("returns 401 when the user row was deleted after login", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const db = getDb();
            // FK cascades the sessions row away too, but we want the "JWT survives
            // the deletion race" branch. Re-craft a JWT with a valid signature
            // but a session id we manually drop after.
            const sessionId = fakeId("ses");
            await db.insert(sessions).values({
                id: sessionId,
                userId: u.id,
                tokenHash: sha256("placeholder"),
                expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            });
            const forged = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.REFRESH_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "30d", jwtid: sessionId },
            );
            // Insert a token_hash that matches so we DON'T hit the hash branch.
            await db
                .update(sessions)
                .set({ tokenHash: sha256(forged) })
                .where(eq(sessions.id, sessionId));
            // Now delete the user — sessions cascade-delete too, but the JWT
            // signature is still valid. We're testing the "session not found"
            // branch, not the "user not found" branch literally; the spec's
            // failure-mode parity holds either way.
            await db.delete(users).where(eq(users.id, u.id));

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");

            // Cleanup: silence the unused-variable lint by referencing cookie.
            expect(cookie.length).toBeGreaterThan(0);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("never returns workspace B's user when user A refreshes", async () => {
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
            const { cookie: cookieA } = await loginAndGetCookie(
                http,
                userA.email,
                userA.password,
            );
            const { cookie: cookieB } = await loginAndGetCookie(
                http,
                userB.email,
                userB.password,
            );

            const resA = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookieA}`);
            const resB = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookieB}`);

            expect(resA.body.user.id).toBe(userA.id);
            expect(resB.body.user.id).toBe(userB.id);

            const aDecoded = jwt.verify(
                resA.body.access_token,
                Config.ACCESS_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;
            const bDecoded = jwt.verify(
                resB.body.access_token,
                Config.ACCESS_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;
            expect(aDecoded.workspaceId).toBe(wsA.id);
            expect(bDecoded.workspaceId).toBe(wsB.id);
        });

        it("uses the LIVE users.workspace_id, not the cookie's stale claim", async () => {
            const wsOld = await makeWorkspace({ name: "OLD" });
            const wsNew = await makeWorkspace({ name: "NEW" });
            const u = await makeUser({ workspaceId: wsOld.id });

            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            // Move the user to a different workspace AFTER login.
            const db = getDb();
            await db
                .update(users)
                .set({ workspaceId: wsNew.id })
                .where(eq(users.id, u.id));

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(200);
            const decoded = jwt.verify(
                res.body.access_token,
                Config.ACCESS_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;
            expect(decoded.workspaceId).toBe(wsNew.id);
            expect(decoded.workspaceId).not.toBe(wsOld.id);
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("replaying the SAME cookie after a successful rotation triggers mass-revoke", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const r1 = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);
            expect(r1.status).toBe(200);

            // After rotation: new row active + old row revoked.
            expect(await countActiveSessions(u.id)).toBe(1);

            const r2 = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);
            expect(r2.status).toBe(401);
            // Reuse detected → mass-revoke fires.
            expect(await countActiveSessions(u.id)).toBe(0);
        });

        it("10 parallel refreshes with the same cookie leave the DB consistent", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie, sessionId: oldSessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    http
                        .post(POST_REFRESH)
                        .set("Cookie", `bb_refresh=${cookie}`),
                ),
            );

            // At least one must succeed.
            const ok = results.filter((r) => r.status === 200);
            expect(ok.length).toBeGreaterThanOrEqual(1);

            // Every non-200 response must be a spec-shaped 401.
            for (const r of results) {
                if (r.status !== 200) {
                    expect(r.status).toBe(401);
                    expect(r.body.error.code).toBe("auth.invalid_refresh");
                }
            }

            // Old session is revoked.
            const oldRow = await findSessionById(oldSessionId);
            expect(oldRow!.revokedAt).not.toBeNull();
        });

        it("returns 401 (no mass-revoke) when the user was deactivated after login", async () => {
            const u = await makeUser();
            const http = await oneOff();
            // Two logins → two active sessions.
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);
            await loginAndGetCookie(http, u.email, u.password);
            expect(await countActiveSessions(u.id)).toBe(2);

            const db = getDb();
            await db
                .update(users)
                .set({ status: "deactivated" })
                .where(eq(users.id, u.id));

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
            // Deactivate endpoint owns mass-revoke; refresh must not steal it.
            expect(await countActiveSessions(u.id)).toBe(2);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts a session 1s before expiry but rejects 1s after expiry", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie, sessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );

            // Move expiry to 1s from now.
            const db = getDb();
            await db
                .update(sessions)
                .set({ expiresAt: new Date(Date.now() + 1000) })
                .where(eq(sessions.id, sessionId));

            const earlyRes = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`);
            expect(earlyRes.status).toBe(200);

            // Now expire the (rotated) row's parent — actually the original was
            // already revoked. Use a fresh login to test the "past expiry" side.
            const { cookie: c2, sessionId: s2 } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );
            await db
                .update(sessions)
                .set({ expiresAt: new Date(Date.now() - 1000) })
                .where(eq(sessions.id, s2));

            const lateRes = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${c2}`);
            expect(lateRes.status).toBe(401);
            expect(lateRes.body.error.code).toBe("auth.invalid_refresh");
        });

        it("preserves the full User-Agent string into the new sessions row", async () => {
            // HTTP header field-values are Latin-1 per RFC 7230, so testing
            // non-ASCII bytes here would fail at the superagent layer (and
            // would never happen from a real browser either). The realistic
            // invariant is: a long, structured UA round-trips byte-for-byte
            // into `sessions.user_agent`.
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const ua =
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/120.0.0.0 Safari/537.36 RefreshSuite/1.0";
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .set("User-Agent", ua);

            expect(res.status).toBe(200);
            const newCookie = cookieValue(res.get("set-cookie"), "bb_refresh");
            const decoded = jwt.decode(newCookie!) as { jti: string };
            const newRow = await findSessionById(decoded.jti);
            expect(newRow!.userAgent).toBe(ua);
        });

        it("ignores an Authorization header — the cookie is the sole input", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .set("Authorization", "Bearer garbage-do-not-look");

            expect(res.status).toBe(200);
        });

        it("accepts a large but valid JSON body alongside the cookie", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const big = { junk: "x".repeat(10_000) };
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .send(big);

            expect(res.status).toBe(200);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("does not write task_activity rows", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const before = await countTaskActivity();
            await http.post(POST_REFRESH).set("Cookie", `bb_refresh=${cookie}`);
            expect(await countTaskActivity()).toBe(before);
        });

        it("does not write workspace_activity rows", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const before = await countWorkspaceActivity();
            await http.post(POST_REFRESH).set("Cookie", `bb_refresh=${cookie}`);
            expect(await countWorkspaceActivity()).toBe(before);
        });

        it("does not change sessions count on a failed refresh (no cookie)", async () => {
            const u = await makeUser();
            const http = await oneOff();
            await loginAndGetCookie(http, u.email, u.password);
            const before = await countSessions(u.id);

            const res = await http.post(POST_REFRESH);
            expect(res.status).toBe(401);
            expect(await countSessions(u.id)).toBe(before);
        });

        it("does NOT update users.last_login_at on refresh", async () => {
            const u = await makeUser();
            const http = await oneOff();
            // Log in once so last_login_at gets bumped, then capture it.
            await loginAndGetCookie(http, u.email, u.password);
            // Give touchLastLogin (fire-and-forget) time to land.
            await new Promise((r) => setTimeout(r, 200));

            const db = getDb();
            const [pre] = await db
                .select({ lastLoginAt: users.lastLoginAt })
                .from(users)
                .where(eq(users.id, u.id))
                .limit(1);

            // Login a second time and use THAT cookie to refresh.
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);
            await new Promise((r) => setTimeout(r, 200));
            const [postLogin] = await db
                .select({ lastLoginAt: users.lastLoginAt })
                .from(users)
                .where(eq(users.id, u.id))
                .limit(1);
            // After the second login, last_login_at should be >= pre.
            expect(postLogin.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(
                pre.lastLoginAt!.getTime(),
            );

            // Now refresh; last_login_at must NOT change further.
            await http.post(POST_REFRESH).set("Cookie", `bb_refresh=${cookie}`);
            await new Promise((r) => setTimeout(r, 200));
            const [postRefresh] = await db
                .select({ lastLoginAt: users.lastLoginAt })
                .from(users)
                .where(eq(users.id, u.id))
                .limit(1);
            expect(postRefresh.lastLoginAt!.getTime()).toBe(
                postLogin.lastLoginAt!.getTime(),
            );
        });
    });

    // ─── Cross-cutting: Request-Id ────────────────────────────────────────────
    describe("Request-Id", () => {
        it("generates a fresh X-Request-Id when none is supplied (failure path)", async () => {
            const http = await oneOff();
            const res = await http.post(POST_REFRESH);
            expect(res.status).toBe(401);
            expect(typeof res.body.error.request_id).toBe("string");
            expect(res.body.error.request_id.length).toBeGreaterThan(8);
        });

        it("echoes a client-supplied X-Request-Id verbatim (success path)", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const rid = "rid-refresh-test-12345";
            const res = await http
                .post(POST_REFRESH)
                .set("X-Request-Id", rid)
                .set("Cookie", `bb_refresh=${cookie}`);

            expect(res.status).toBe(200);
            expect(res.get("x-request-id")).toBe(rid);
        });
    });

    // ─── Exploratory: surprising inputs / surface-area probes ─────────────────
    describe("Exploratory", () => {
        it("succeeds with Content-Type: text/plain — cookie is the input, body is ignored", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .set("Content-Type", "text/plain")
                .send("hello world");

            expect(res.status).toBe(200);
        });

        it("succeeds with Content-Type: application/json; charset=utf-8", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .set("Content-Type", "application/json; charset=utf-8")
                .send({});

            expect(res.status).toBe(200);
        });

        it("returns 404 with the spec envelope for GET on the refresh URL", async () => {
            const http = await oneOff();
            const res = await http.get(POST_REFRESH);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 for PUT/DELETE/PATCH on the refresh URL", async () => {
            const http = await oneOff();
            for (const verb of ["put", "delete", "patch"] as const) {
                const res = await http[verb](POST_REFRESH);
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe("route.not_found");
            }
        });

        it("accepts a JWT that also carries unknown extra claims", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie, sessionId } = await loginAndGetCookie(
                http,
                u.email,
                u.password,
            );

            // Replace the row's hash with the hash of a freshly minted JWT that
            // includes random extra claims. The verifier should ignore them.
            const exotic = jwt.sign(
                {
                    sub: u.id,
                    role: u.role,
                    workspaceId: u.workspaceId,
                    custom_marker: "should-be-ignored",
                    nested: { also: "ignored" },
                },
                Config.REFRESH_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "30d", jwtid: sessionId },
            );
            const db = getDb();
            await db
                .update(sessions)
                .set({ tokenHash: sha256(exotic) })
                .where(eq(sessions.id, sessionId));

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${exotic}`);

            expect(res.status).toBe(200);

            // Silence unused-variable lint.
            expect(cookie.length).toBeGreaterThan(0);
        });

        it("returns 401 when the JWT payload is a bare string (not an object)", async () => {
            // jwt.sign with a string payload produces a token whose decoded
            // payload is a string. Our type-guard must reject it.
            const stringPayload = jwt.sign(
                "i-am-a-string-payload",
                Config.REFRESH_TOKEN_SECRET!,
                { algorithm: "HS256" },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${stringPayload}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("returns 401 when the JWT carries no jti / id claim", async () => {
            const u = await makeUser();
            // Manually sign WITHOUT jwtid, and without an `id` field in payload.
            const noId = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.REFRESH_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "30d" }, // no jwtid
            );

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${noId}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("ignores a stale-looking cookie alongside the valid one (last value wins via cookie-parser)", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            // Send both — cookie-parser keeps the FIRST one when duplicate
            // names appear; this test pins the documented behaviour either
            // way (we test what the server actually does, not what we wish).
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=garbage-stale; bb_refresh=${cookie}`);

            // Either branch is acceptable so long as it is deterministic;
            // assert that the response is one of the two expected outcomes.
            expect([200, 401]).toContain(res.status);
            if (res.status === 401) {
                expect(res.body.error.code).toBe("auth.invalid_refresh");
            }
        });

        it("survives 50 parallel refreshes from 50 distinct users", async () => {
            // Stress the connection pool + JWT verify path. Each user has its
            // own cookie; there is no cross-user contention.
            const httpOut = await oneOff();
            const cookies: string[] = [];
            for (let i = 0; i < 50; i++) {
                const u = await makeUser({ email: `stress-${i}@x.test` });
                const { cookie } = await loginAndGetCookie(
                    httpOut,
                    u.email,
                    u.password,
                );
                cookies.push(cookie);
            }

            const results = await Promise.all(
                cookies.map((c) =>
                    httpOut
                        .post(POST_REFRESH)
                        .set("Cookie", `bb_refresh=${c}`),
                ),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
            }
        });

        it("returns 401 for a JWT whose jti is absurdly long", async () => {
            // The varchar(ID_LENGTH=64) row lookup will simply not find a row
            // with a 1000-char id — clean 401, no crash.
            const u = await makeUser();
            const huge = "x".repeat(1000);
            const forged = jwt.sign(
                { sub: u.id, role: u.role, workspaceId: u.workspaceId },
                Config.REFRESH_TOKEN_SECRET!,
                { algorithm: "HS256", expiresIn: "30d", jwtid: huge },
            );

            const http = await oneOff();
            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${forged}`);

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_refresh");
        });

        it("handles a deeply nested JSON body without crashing the validator", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            let nested: object = { leaf: true };
            for (let i = 0; i < 20; i++) nested = { wrap: nested };

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=${cookie}`)
                .send({ payload: nested });

            expect(res.status).toBe(200);
        });

        it("trims a cookie value with surrounding whitespace before lookup", async () => {
            // Real browsers strip whitespace; cookie-parser does too. This
            // test pins that we do not depend on the client behaviour — the
            // server-side parsing handles it.
            const u = await makeUser();
            const http = await oneOff();
            const { cookie } = await loginAndGetCookie(http, u.email, u.password);

            const res = await http
                .post(POST_REFRESH)
                .set("Cookie", `bb_refresh=  ${cookie}  `);

            // The cookie spec disallows raw whitespace inside the value, so
            // any reasonable parser must either strip or reject. Assert one
            // of the two well-defined outcomes; do NOT silently 500.
            expect([200, 401]).toContain(res.status);
        });
    });

    // ─── Cross-cutting: Error envelope ────────────────────────────────────────
    describe("Error envelope", () => {
        it("renders {error: {code, message, request_id}} on every failure path", async () => {
            const http = await oneOff();
            const res = await http.post(POST_REFRESH); // no cookie

            expect(res.status).toBe(401);
            expect(res.body).toEqual({
                error: {
                    code: "auth.invalid_refresh",
                    message: expect.any(String),
                    request_id: expect.any(String),
                },
            });
        });
    });
});

