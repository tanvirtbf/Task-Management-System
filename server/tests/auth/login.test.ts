import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import {
    sessions,
    users,
    taskActivity,
    workspaceActivity,
} from "../../src/db/schema";
import { sha256 } from "../../src/utils";
import { Config } from "../../src/config";
import { AppError } from "../../src/errors";
import { _internal as rateLimitInternal } from "../../src/middlewares/rateLimit";

/**
 * Tests for `POST /api/v1/auth/login`.
 *
 * Patterns:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - Stateless supertest via `oneOff()` — no agent-level cookie magic.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 */

// ─── small helpers ───────────────────────────────────────────────────────────

const POST_LOGIN = "/api/v1/auth/login";

/** Extract a single cookie's value (no attrs) from a Set-Cookie header. */
const cookieValue = (setCookie: string | string[] | undefined, name: string): string | null => {
    if (!setCookie) return null;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const entry of list) {
        const match = entry.match(new RegExp(`^${name}=([^;]+)`));
        if (match) return decodeURIComponent(match[1]);
    }
    return null;
};

/** Get the full Set-Cookie line for a given cookie name. */
const cookieLine = (setCookie: string | string[] | undefined, name: string): string | null => {
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

const countTaskActivity = async () => {
    const db = getDb();
    return (await db.select({ id: taskActivity.id }).from(taskActivity)).length;
};

const countWorkspaceActivity = async () => {
    const db = getDb();
    return (await db.select({ id: workspaceActivity.id }).from(workspaceActivity))
        .length;
};

const findSessionByUser = async (userId: string) => {
    const db = getDb();
    const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .limit(1);
    return row ?? null;
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/auth/login", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 200 with the spec-shaped body on valid credentials", async () => {
            const u = await makeUser({ email: "ada@example.test" });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
            expect(typeof res.body.access_token).toBe("string");
            expect(res.body.access_token.length).toBeGreaterThan(20);
            expect(res.body.expires_in).toBe(900);
            expect(res.body.user).toEqual({
                id: u.id,
                first_name: expect.any(String),
                last_name: expect.any(String),
                email: u.email,
                role: "member",
                avatar_url: null,
                status: "active",
                timezone: "Asia/Dhaka",
                created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
                last_login_at: null, // not yet — touchLastLogin runs after the response
            });
            expect(res.body.user).not.toHaveProperty("password_hash");
            expect(res.body.user).not.toHaveProperty("workspace_id");
            expect(res.body.user).not.toHaveProperty("updated_at");
        });

        it("sets the bb_refresh cookie with the right attributes", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
            const line = cookieLine(res.get("set-cookie"), "bb_refresh");
            expect(line).not.toBeNull();
            expect(line).toMatch(/HttpOnly/);
            expect(line).toMatch(/SameSite=Strict/);
            expect(line).toMatch(/Path=\/api\/v1\/auth/);
            expect(line).toMatch(/Max-Age=2592000/);
        });

        it("inserts exactly one sessions row with a ~30-day expiry", async () => {
            const u = await makeUser();
            const http = await oneOff();

            await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            const count = await countSessions(u.id);
            expect(count).toBe(1);

            const row = await findSessionByUser(u.id);
            expect(row).not.toBeNull();
            expect(row!.userId).toBe(u.id);
            const expiresInMs = row!.expiresAt.getTime() - Date.now();
            const days = expiresInMs / (1000 * 60 * 60 * 24);
            expect(days).toBeGreaterThan(29.9);
            expect(days).toBeLessThan(30.1);
        });

        it("updates users.last_login_at to within the last 10 seconds", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const beforeLogin = Date.now();
            await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            // `touchLastLogin` is fire-and-forget — give it a beat to land.
            await new Promise((r) => setTimeout(r, 200));

            const db = getDb();
            const [row] = await db
                .select({ lastLoginAt: users.lastLoginAt })
                .from(users)
                .where(eq(users.id, u.id))
                .limit(1);

            expect(row.lastLoginAt).not.toBeNull();
            const lastLoginMs = row.lastLoginAt!.getTime();
            expect(lastLoginMs).toBeGreaterThanOrEqual(beforeLogin - 1000);
            expect(lastLoginMs).toBeLessThanOrEqual(Date.now() + 1000);
        });

        it("issues an access token verifiable with ACCESS_TOKEN_SECRET", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            const payload = jwt.verify(
                res.body.access_token,
                Config.ACCESS_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;

            expect(payload.sub).toBe(u.id);
            expect(payload.role).toBe("member");
            expect(payload.workspaceId).toBe(u.workspaceId);
            const ttl = payload.exp! - Math.floor(Date.now() / 1000);
            expect(ttl).toBeGreaterThan(890);
            expect(ttl).toBeLessThanOrEqual(900);
        });

        it("issues a refresh token whose id claim matches the new sessions row", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            const refreshToken = cookieValue(res.get("set-cookie"), "bb_refresh");
            expect(refreshToken).not.toBeNull();

            const payload = jwt.verify(
                refreshToken!,
                Config.REFRESH_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;

            expect(payload.sub).toBe(u.id);
            expect(payload.role).toBe("member");
            expect(payload.workspaceId).toBe(u.workspaceId);

            const row = await findSessionByUser(u.id);
            expect(payload.id).toBe(row!.id);

            const ttlDays = (payload.exp! * 1000 - Date.now()) / (1000 * 60 * 60 * 24);
            expect(ttlDays).toBeGreaterThan(29.9);
            expect(ttlDays).toBeLessThan(30.1);
        });

        it("persists sha256(cookieRefreshToken) — not a temp hash — in sessions.token_hash", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            const refreshToken = cookieValue(res.get("set-cookie"), "bb_refresh");
            const expectedHash = sha256(refreshToken!);

            const row = await findSessionByUser(u.id);
            expect(row!.tokenHash).toBe(expectedHash);
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 with details for missing email and password", async () => {
            const http = await oneOff();
            const res = await http.post(POST_LOGIN).send({});

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect(res.body.error.request_id).toMatch(/^req_/);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("email");
            expect(fields).toContain("password");
        });

        it("returns 422 for an invalid email format", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: "not-an-email", password: "x" });

            expect(res.status).toBe(422);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("email");
        });

        it("returns 422 when password is missing", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: "ada@example.test" });

            expect(res.status).toBe(422);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("password");
        });

        it("returns 422 when password is an empty string", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: "ada@example.test", password: "" });

            expect(res.status).toBe(422);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("password");
        });

        it("returns 422 when password exceeds 200 characters", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: "ada@example.test", password: "x".repeat(201) });

            expect(res.status).toBe(422);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("password");
        });

        it("returns 422 when email exceeds 255 characters", async () => {
            const http = await oneOff();
            const longLocal = "a".repeat(250);
            const res = await http
                .post(POST_LOGIN)
                .send({ email: `${longLocal}@x.test`, password: "x" });

            expect(res.status).toBe(422);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("email");
        });

        it("accepts whitespace and mixed-case email (normalises before lookup)", async () => {
            const u = await makeUser({ email: "ada@example.test" });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: "  Ada@Example.TEST  ", password: u.password });

            expect(res.status).toBe(200);
            expect(res.body.user.id).toBe(u.id);
        });

        it("ignores unknown extra fields and never elevates role", async () => {
            const u = await makeUser({ email: "claim@example.test" });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({
                    email: u.email,
                    password: u.password,
                    role: "owner",
                    workspace_id: "ws-attacker",
                });

            expect(res.status).toBe(200);

            const db = getDb();
            const [row] = await db
                .select({ role: users.role, workspaceId: users.workspaceId })
                .from(users)
                .where(eq(users.id, u.id))
                .limit(1);
            expect(row.role).toBe("member");
            expect(row.workspaceId).toBe(u.workspaceId);
        });

        it("returns 400 with the spec envelope on malformed JSON", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .set("Content-Type", "application/json")
                .send("{not valid json");

            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
            expect(res.body.error.request_id).toMatch(/^req_/);
        });

        it("returns 413 when the body exceeds the 1 MB limit", async () => {
            const http = await oneOff();
            // 1.5 MB string forces express.json to refuse before the validator runs.
            const huge = "x".repeat(1.5 * 1024 * 1024);
            const res = await http
                .post(POST_LOGIN)
                .set("Content-Type", "application/json")
                .send(`{"email":"a@b.test","password":"${huge}"}`);

            expect(res.status).toBe(413);
            expect(res.body.error).toBeDefined();
        });

        it("returns 422 when password is not a string", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: "ada@example.test", password: 123 });

            expect(res.status).toBe(422);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("password");
        });
    });

    // ─── e. Account status (Resource lifecycle) ───────────────────────────────
    describe("Account status", () => {
        it("returns 401 invalid_credentials for a deactivated user (no session row)", async () => {
            const u = await makeUser({ status: "deactivated" });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_credentials");
            expect(await countSessions(u.id)).toBe(0);
        });

        it("returns 401 invalid_credentials for an invited (not-yet-active) user", async () => {
            const u = await makeUser({ status: "invited" });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_credentials");
            expect(await countSessions(u.id)).toBe(0);
        });
    });

    // ─── g. Workspace isolation ───────────────────────────────────────────────
    describe("Workspace isolation", () => {
        it("returns a JWT whose workspaceId claim matches the user's workspace", async () => {
            const wsA = await makeWorkspace({ name: "Workspace A" });
            const u = await makeUser({ workspaceId: wsA.id });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            const payload = jwt.verify(
                res.body.access_token,
                Config.ACCESS_TOKEN_SECRET!,
                { algorithms: ["HS256"] },
            ) as jwt.JwtPayload;
            expect(payload.workspaceId).toBe(wsA.id);
        });

        it("never authenticates the wrong user when emails collide across workspaces", async () => {
            // Bypass the application's "globally unique email" invariant by
            // creating two users with the same email in two workspaces.
            // `findByEmail` uses ORDER BY created_at ASC; for same-second
            // inserts MySQL's tie-break is unspecified. The security
            // invariant we assert is stronger and order-independent: when
            // login succeeds, the returned user is the one whose password
            // was supplied — never the other workspace's user.
            const wsA = await makeWorkspace({ name: "WS-A" });
            const wsB = await makeWorkspace({ name: "WS-B" });
            const userA = await makeUser({
                workspaceId: wsA.id,
                email: "dup@example.test",
                password: "passwordA-distinct",
            });
            const userB = await makeUser({
                workspaceId: wsB.id,
                email: "dup@example.test",
                password: "passwordB-distinct",
            });

            const http = await oneOff();

            // Try userA's password. Must EITHER succeed as userA OR fail 401.
            // Must NEVER succeed as userB.
            const r1 = await http
                .post(POST_LOGIN)
                .send({ email: "dup@example.test", password: userA.password });
            if (r1.status === 200) {
                expect(r1.body.user.id).toBe(userA.id);
                const p = jwt.verify(
                    r1.body.access_token,
                    Config.ACCESS_TOKEN_SECRET!,
                    { algorithms: ["HS256"] },
                ) as jwt.JwtPayload;
                expect(p.workspaceId).toBe(wsA.id);
            } else {
                expect(r1.status).toBe(401);
            }
            // Whatever happened, no session for B was created via A's password.
            expect(await countSessions(userB.id)).toBe(0);

            // Symmetric: B's password must succeed as B or fail; never as A.
            const r2 = await http
                .post(POST_LOGIN)
                .send({ email: "dup@example.test", password: userB.password });
            if (r2.status === 200) {
                expect(r2.body.user.id).toBe(userB.id);
                const p = jwt.verify(
                    r2.body.access_token,
                    Config.ACCESS_TOKEN_SECRET!,
                    { algorithms: ["HS256"] },
                ) as jwt.JwtPayload;
                expect(p.workspaceId).toBe(wsB.id);
            } else {
                expect(r2.status).toBe(401);
            }
        });
    });

    // ─── i. Concurrency ───────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("handles 10 parallel logins for the same user, inserting 10 distinct sessions", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    http
                        .post(POST_LOGIN)
                        .send({ email: u.email, password: u.password }),
                ),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
            }
            expect(await countSessions(u.id)).toBe(10);
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts a unicode password (emoji + Bangla + Latin)", async () => {
            const password = "パスワード123🔒পাসওয়ার্ড";
            const u = await makeUser({ password });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password });

            expect(res.status).toBe(200);
        });

        it("accepts an email with a + alias (does NOT strip the alias)", async () => {
            const u = await makeUser({ email: "ada+test@example.test" });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
            expect(res.body.user.email).toBe("ada+test@example.test");
        });

        it("accepts a password of exactly 200 characters", async () => {
            const password = "a".repeat(200);
            const u = await makeUser({ password });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password });

            expect(res.status).toBe(200);
        });

        it("accepts a long but RFC-valid email (60-char local + multi-label domain)", async () => {
            // 60 chars in the local part (under RFC 5321's 64-char limit) +
            // a multi-label domain. Tests that our `isEmail` + `isLength`
            // rules accept legitimate long addresses. Past the RFC limit,
            // `isEmail` rejects before our 255-char cap — exercised in the
            // "exceeds 255 characters" test above.
            const longEmail =
                `${"x".repeat(60)}@sub.long-domain.example.test`;
            expect(longEmail.length).toBeGreaterThan(80);
            const u = await makeUser({ email: longEmail });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
        });

        it("accepts a single-character password (login enforces no min)", async () => {
            const u = await makeUser({ password: "x" });
            const http = await oneOff();

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
        });
    });

    // ─── l. Side effects ──────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("creates exactly one sessions row on a successful login", async () => {
            const u = await makeUser();
            const http = await oneOff();
            await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });
            expect(await countSessions(u.id)).toBe(1);
        });

        it("creates zero sessions rows when the password is wrong", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: "definitely-not-the-password" });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_credentials");
            expect(await countSessions(u.id)).toBe(0);
        });

        it("creates zero sessions rows when the email does not exist", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({
                    email: "no-such-user@example.test",
                    password: "anything",
                });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.invalid_credentials");

            const db = getDb();
            const allRows = await db.select({ id: sessions.id }).from(sessions);
            expect(allRows.length).toBe(0);
        });

        it("does not write a task_activity row on success", async () => {
            const u = await makeUser();
            const http = await oneOff();
            await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });
            expect(await countTaskActivity()).toBe(0);
        });

        it("does not write a workspace_activity row on success", async () => {
            const u = await makeUser();
            const http = await oneOff();
            await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password });
            expect(await countWorkspaceActivity()).toBe(0);
        });
    });

    // ─── Cross-cutting: Request-ID ────────────────────────────────────────────
    describe("Request-ID", () => {
        it("generates a fresh X-Request-Id when none is supplied", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: "x@x.test", password: "x" });

            expect(res.get("X-Request-Id")).toMatch(/^req_/);
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("echoes a client-supplied X-Request-Id verbatim", async () => {
            const http = await oneOff();
            const supplied = "trace_abc_xyz_42";
            const res = await http
                .post(POST_LOGIN)
                .set("X-Request-Id", supplied)
                .send({ email: "no@user.test", password: "x" });

            expect(res.get("X-Request-Id")).toBe(supplied);
            expect(res.body.error.request_id).toBe(supplied);
        });
    });

    // ─── Cross-cutting: Error envelope ────────────────────────────────────────
    describe("Error envelope", () => {
        it("renders {error: {code, message, request_id}} on every failure path", async () => {
            const http = await oneOff();

            // 422
            const r422 = await http.post(POST_LOGIN).send({});
            expect(r422.body.error).toBeDefined();
            expect(typeof r422.body.error.code).toBe("string");
            expect(typeof r422.body.error.message).toBe("string");
            expect(typeof r422.body.error.request_id).toBe("string");

            // 401
            const r401 = await http
                .post(POST_LOGIN)
                .send({ email: "noone@test.test", password: "x" });
            expect(r401.body.error).toBeDefined();
            expect(r401.body.error.code).toBe("auth.invalid_credentials");
            expect(typeof r401.body.error.message).toBe("string");
            expect(typeof r401.body.error.request_id).toBe("string");
        });
    });

    // ─── Exploratory: surprising inputs / surface-area probes ─────────────────
    describe("Exploratory", () => {
        it("rejects an absent Content-Type — body is unparsed, 422 missing fields", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send(JSON.stringify({ email: "x@x.test", password: "x" }));

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("rejects Content-Type: application/x-www-form-urlencoded", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send("email=x@x.test&password=secret");

            expect(res.status).toBe(422);
        });

        it("accepts Content-Type: application/json; charset=utf-8", async () => {
            const u = await makeUser({ email: "charset@x.test" });
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .set("Content-Type", "application/json; charset=utf-8")
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
        });

        it("rejects null email and null password", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({ email: null, password: null });

            expect(res.status).toBe(422);
            const fields = (res.body.error.details as Array<{ field: string }>).map(
                (d) => d.field,
            );
            expect(fields).toContain("email");
            expect(fields).toContain("password");
        });

        it("rejects array values for email and password", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({
                    email: ["a@x.test", "b@x.test"],
                    password: ["one", "two"],
                });

            expect(res.status).toBe(422);
        });

        it("rejects nested-object values for email and password", async () => {
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .send({
                    email: { nested: "deep" },
                    password: { also: { nested: true } },
                });

            expect(res.status).toBe(422);
        });

        it("does NOT trim leading/trailing whitespace from password", async () => {
            // Whitespace in passwords is significant. A user whose password is
            // " spaces " (with surrounding spaces) must be authenticated with
            // those spaces. Trimming would lock them out.
            const password = " has spaces ";
            const u = await makeUser({ password });
            const http = await oneOff();

            // Correct password (with spaces) → 200
            const r1 = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: " has spaces " });
            expect(r1.status).toBe(200);

            // Same characters but trimmed → 401 (different bcrypt hash)
            const r2 = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: "has spaces" });
            expect(r2.status).toBe(401);
        });

        it("returns 404 with the spec envelope for GET on the login URL", async () => {
            const http = await oneOff();
            const res = await http.get(POST_LOGIN);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("ignores a stale bb_refresh cookie on the incoming request", async () => {
            const u = await makeUser();
            const http = await oneOff();
            const res = await http
                .post(POST_LOGIN)
                .set("Cookie", "bb_refresh=garbage-stale-cookie-value")
                .send({ email: u.email, password: u.password });

            expect(res.status).toBe(200);
            const line = cookieLine(res.get("set-cookie"), "bb_refresh");
            expect(line).not.toBeNull();
            // The new cookie value is NOT the garbage we sent.
            const newToken = cookieValue(res.get("set-cookie"), "bb_refresh");
            expect(newToken).not.toBe("garbage-stale-cookie-value");
            // And it's verifiable.
            expect(() =>
                jwt.verify(newToken!, Config.REFRESH_TOKEN_SECRET!, {
                    algorithms: ["HS256"],
                }),
            ).not.toThrow();
        });

        it("survives 50 parallel logins from the same user with 50 distinct sessions", async () => {
            const u = await makeUser();
            const http = await oneOff();

            const results = await Promise.all(
                Array.from({ length: 50 }, () =>
                    http
                        .post(POST_LOGIN)
                        .send({ email: u.email, password: u.password }),
                ),
            );

            for (const r of results) {
                expect(r.status).toBe(200);
            }
            expect(await countSessions(u.id)).toBe(50);

            // Every session id must be distinct (no collisions on fakeId).
            const db = getDb();
            const rows = await db
                .select({ id: sessions.id })
                .from(sessions)
                .where(eq(sessions.userId, u.id));
            const ids = new Set(rows.map((r) => r.id));
            expect(ids.size).toBe(50);
        });

        it("ignores deeply nested extra fields without crashing", async () => {
            const u = await makeUser();
            const http = await oneOff();
            // 20 levels of nesting in an extra field — express.json should
            // parse fine (its default depth is 100ish).
            let nested: object = { leaf: true };
            for (let i = 0; i < 20; i++) nested = { wrap: nested };

            const res = await http
                .post(POST_LOGIN)
                .send({ email: u.email, password: u.password, payload: nested });

            expect(res.status).toBe(200);
        });
    });

    // ─── Cross-cutting: Rate-limit handler unit ───────────────────────────────
    describe("Rate-limit handler (unit)", () => {
        it("emits AppError(429, auth.rate_limited) when invoked", () => {
            const calls: AppError[] = [];
            const next = (err: AppError) => {
                calls.push(err);
            };
            rateLimitInternal.authRateLimitHandler(
                {} as never,
                {} as never,
                next as never,
            );
            expect(calls).toHaveLength(1);
            expect(calls[0]).toBeInstanceOf(AppError);
            expect(calls[0].statusCode).toBe(429);
            expect(calls[0].code).toBe("auth.rate_limited");
            expect(calls[0].message).toMatch(/too many/i);
        });
    });
});

