import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeSession, makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { passwordResetTokens, sessions, users } from "../../src/db/schema";
import { fakeId, randomToken, sha256 } from "../../src/utils";

/**
 * Tests for `POST /api/v1/auth/reset-password` (API_DESIGN.md §2).
 *
 * Patterns mirror `tests/auth/forgot-password.test.ts` (same `password_reset_tokens`
 * table) + `tests/auth/login.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories` (no mocks).
 *   - Stateless supertest via `oneOff()` — the endpoint is public (the token is
 *     the capability), so no cookies/Authorization are involved.
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 *
 * Implemented contract: body `{ token, new_password }`. A valid, unconsumed,
 * unexpired token sets the new password (bcrypt), marks the token consumed
 * (single-use), and revokes EVERY session for that user — all in one
 * transaction. Success is `204`. A missing / expired / consumed token is a
 * single generic `400 auth.reset_token_invalid` (no validity oracle). The spec
 * (§2) does not enumerate the error code; `400 auth.reset_token_invalid` is the
 * implementation's deliberate choice and is asserted here as the contract.
 *
 * `new_password` is intentionally NOT trimmed — surrounding whitespace is part
 * of the secret. The `authStrictLimiter` (5/min/IP) is a no-op under
 * NODE_ENV=test, so 429 is not exercised here (matches the sibling auth suites).
 */

// DB truncation per test + bcrypt + parallel bursts push past jest's 5s default;
// match the headroom the project's other DB-heavy suites use.
jest.setTimeout(30_000);

const PATH = "/api/v1/auth/reset-password";
const LOGIN = "/api/v1/auth/login";
const NEW_PASSWORD = "NewPassw0rd!";

const post = async (body: Record<string, unknown>) =>
    (await oneOff()).post(PATH).send(body);
const login = async (email: string, password: string) =>
    (await oneOff()).post(LOGIN).send({ email, password });

/**
 * Insert a `password_reset_tokens` row directly and hand back the RAW token (the
 * value a real email link would carry). Only `sha256(rawToken)` is stored, so
 * the endpoint hashes the body token and matches it the same way production does.
 */
const makeResetToken = async (
    userId: string,
    opts: { expiresAt?: Date; consumedAt?: Date | null } = {},
): Promise<{ rawToken: string; id: string }> => {
    const db = getDb();
    const id = fakeId("prt");
    const rawToken = randomToken();
    await db.insert(passwordResetTokens).values({
        id,
        userId,
        tokenHash: sha256(rawToken),
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
        consumedAt: opts.consumedAt ?? null,
    });
    return { rawToken, id };
};

const getToken = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.id, id))
        .limit(1);
    return row;
};

const readUser = async (id: string) => {
    const db = getDb();
    const [row] = await db
        .select({
            passwordHash: users.passwordHash,
            lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
    return row;
};

const getSessions = async (userId: string) => {
    const db = getDb();
    return db.select().from(sessions).where(eq(sessions.userId, userId));
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/auth/reset-password", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 204 with an empty body for a valid token + password", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);

            const res = await post({ token: rawToken, new_password: NEW_PASSWORD });

            expect(res.status).toBe(204);
            expect(res.body).toEqual({});
            expect(res.text).toBe("");
        });

        it("sets the new password (old fails, new works at /login)", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);

            await post({ token: rawToken, new_password: NEW_PASSWORD });

            expect((await login(u.email, u.password)).status).toBe(401);
            expect((await login(u.email, NEW_PASSWORD)).status).toBe(200);
        });

        it("marks the token consumed (consumed_at set)", async () => {
            const u = await makeUser();
            const { rawToken, id } = await makeResetToken(u.id);

            await post({ token: rawToken, new_password: NEW_PASSWORD });

            const row = await getToken(id);
            expect(row.consumedAt).not.toBeNull();
        });
    });

    // ─── b. Validation (422 validation.failed) ────────────────────────────────
    describe("Validation", () => {
        it("422 when token is missing", async () => {
            const res = await post({ new_password: NEW_PASSWORD });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("422 when token is an empty string", async () => {
            const res = await post({ token: "", new_password: NEW_PASSWORD });
            expect(res.status).toBe(422);
        });

        it("422 when token is not a string", async () => {
            const res = await post({ token: 12345, new_password: NEW_PASSWORD });
            expect(res.status).toBe(422);
        });

        it("422 when token exceeds 512 characters", async () => {
            const res = await post({
                token: "a".repeat(513),
                new_password: NEW_PASSWORD,
            });
            expect(res.status).toBe(422);
        });

        it("422 when new_password is missing", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            const res = await post({ token: rawToken });
            expect(res.status).toBe(422);
        });

        it("422 when new_password is an empty string", async () => {
            const res = await post({ token: "x", new_password: "" });
            expect(res.status).toBe(422);
        });

        it("422 when new_password is shorter than 8 characters", async () => {
            const res = await post({ token: "x", new_password: "short7!" });
            expect(res.status).toBe(422);
        });

        it("422 when new_password exceeds 200 characters", async () => {
            const res = await post({
                token: "x",
                new_password: "A1!".concat("a".repeat(200)),
            });
            expect(res.status).toBe(422);
        });

        it("422 when new_password is not a string", async () => {
            const res = await post({ token: "x", new_password: 123456789 });
            expect(res.status).toBe(422);
        });

        it("422 with a details[] array when both fields are missing", async () => {
            const res = await post({});
            expect(res.status).toBe(422);
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(res.body.error.details.length).toBeGreaterThan(0);
        });

        it("ignores unknown extra fields and still resets", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);

            const res = await post({
                token: rawToken,
                new_password: NEW_PASSWORD,
                user_id: "u-attacker",
                role: "owner",
            });

            expect(res.status).toBe(204);
            // The reset applied to the token's user, never the body's user_id.
            expect((await login(u.email, NEW_PASSWORD)).status).toBe(200);
        });

        it("400 with the spec envelope on malformed JSON", async () => {
            const res = await (await oneOff())
                .post(PATH)
                .set("Content-Type", "application/json")
                .send('{"token": "x", "new_password": "abcdefgh"');
            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
        });

        it("413 when the body exceeds the 1 MB limit", async () => {
            const res = await (await oneOff())
                .post(PATH)
                .set("Content-Type", "application/json")
                .send(JSON.stringify({ token: "x".repeat(1_100_000), new_password: NEW_PASSWORD }));
            expect(res.status).toBe(413);
        });

        it("writes nothing on a validation failure", async () => {
            const u = await makeUser();
            const { id } = await makeResetToken(u.id);
            await post({ token: "", new_password: "" });
            expect((await getToken(id)).consumedAt).toBeNull();
        });
    });

    // ─── c. Authentication (public — token is the capability) ──────────────────
    describe("Authentication", () => {
        it("works with no Authorization header (public)", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);

            const res = await post({ token: rawToken, new_password: NEW_PASSWORD });

            expect(res.status).toBe(204);
        });
    });

    // ─── d. Authorization (no role gating — public) ────────────────────────────
    describe("Authorization", () => {
        it("resets the password for an admin user's token", async () => {
            const u = await makeUser({ role: "admin" });
            const { rawToken } = await makeResetToken(u.id);

            const res = await post({ token: rawToken, new_password: NEW_PASSWORD });

            expect(res.status).toBe(204);
            expect((await login(u.email, NEW_PASSWORD)).status).toBe(200);
        });
    });

    // ─── e. Resource lifecycle (token validity) ────────────────────────────────
    describe("Token validity", () => {
        it("400 auth.reset_token_invalid for a token that was never issued", async () => {
            const res = await post({
                token: "this-token-does-not-exist",
                new_password: NEW_PASSWORD,
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("auth.reset_token_invalid");
        });

        it("400 for an expired token (and leaves the password unchanged)", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id, {
                expiresAt: new Date(Date.now() - 60 * 1000),
            });

            const res = await post({ token: rawToken, new_password: NEW_PASSWORD });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("auth.reset_token_invalid");
            expect((await login(u.email, u.password)).status).toBe(200);
        });

        it("400 for an already-consumed token", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id, {
                consumedAt: new Date(),
            });

            const res = await post({ token: rawToken, new_password: NEW_PASSWORD });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("auth.reset_token_invalid");
        });
    });

    // ─── f/h. Conflict / single-use idempotency ────────────────────────────────
    describe("Single-use", () => {
        it("replaying a token that was just used returns 400", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);

            const first = await post({ token: rawToken, new_password: NEW_PASSWORD });
            const second = await post({ token: rawToken, new_password: "Another1!" });

            expect(first.status).toBe(204);
            expect(second.status).toBe(400);
            expect(second.body.error.code).toBe("auth.reset_token_invalid");
            // The password is the FIRST new one, never the replayed one.
            expect((await login(u.email, NEW_PASSWORD)).status).toBe(200);
            expect((await login(u.email, "Another1!")).status).toBe(401);
        });
    });

    // ─── g. Tenant isolation ───────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("a token for user A never affects user B in another workspace", async () => {
            const wsA = await makeWorkspace();
            const wsB = await makeWorkspace();
            const a = await makeUser({ workspaceId: wsA.id });
            const b = await makeUser({ workspaceId: wsB.id });
            await makeSession({ userId: b.id });
            const { rawToken } = await makeResetToken(a.id);

            await post({ token: rawToken, new_password: NEW_PASSWORD });

            // B's credential + sessions are untouched.
            expect((await login(b.email, b.password)).status).toBe(200);
            expect((await getSessions(b.id)).every((s) => s.revokedAt === null)).toBe(
                true,
            );
        });
    });

    // ─── i. Concurrency ────────────────────────────────────────────────────────
    describe("Concurrency", () => {
        it("10 parallel resets with the same token: exactly one 204, nine 400", async () => {
            const u = await makeUser();
            const { rawToken, id } = await makeResetToken(u.id);

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    post({ token: rawToken, new_password: NEW_PASSWORD }),
                ),
            );

            const ok = results.filter((r) => r.status === 204);
            const bad = results.filter((r) => r.status === 400);
            expect(ok).toHaveLength(1);
            expect(bad).toHaveLength(9);
            expect((await getToken(id)).consumedAt).not.toBeNull();
            expect((await login(u.email, NEW_PASSWORD)).status).toBe(200);
        });
    });

    // ─── k. Boundary values ────────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("accepts a new_password of exactly 8 characters", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            const pw = "Abcdef1!"; // 8 chars
            const res = await post({ token: rawToken, new_password: pw });
            expect(res.status).toBe(204);
            expect((await login(u.email, pw)).status).toBe(200);
        });

        it("accepts a new_password of exactly 200 characters", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            const pw = "A1!".concat("a".repeat(197)); // 200 chars
            expect(pw).toHaveLength(200);
            const res = await post({ token: rawToken, new_password: pw });
            expect(res.status).toBe(204);
        });

        it("400 for a 512-char token that passes validation but matches nothing", async () => {
            const res = await post({
                token: "a".repeat(512),
                new_password: NEW_PASSWORD,
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("auth.reset_token_invalid");
        });

        it("preserves whitespace in the password (not trimmed)", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            const pw = "  spaced secret  ";

            await post({ token: rawToken, new_password: pw });

            expect((await login(u.email, pw)).status).toBe(200);
            // The trimmed variant must NOT authenticate.
            expect((await login(u.email, pw.trim())).status).toBe(401);
        });

        it("treats a token with trailing whitespace as invalid (not trimmed → 400)", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);

            const res = await post({
                token: `${rawToken} `,
                new_password: NEW_PASSWORD,
            });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("auth.reset_token_invalid");
        });

        it("handles a unicode password (emoji + Bangla) end to end", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            const pw = "পাসওয়ার্ড🔥1";

            const res = await post({ token: rawToken, new_password: pw });

            expect(res.status).toBe(204);
            expect((await login(u.email, pw)).status).toBe(200);
        });
    });

    // ─── l. Side effects ───────────────────────────────────────────────────────
    describe("Side effects", () => {
        it("revokes every active session for the user", async () => {
            const u = await makeUser();
            await makeSession({ userId: u.id });
            await makeSession({ userId: u.id });
            await makeSession({ userId: u.id });
            const { rawToken } = await makeResetToken(u.id);

            await post({ token: rawToken, new_password: NEW_PASSWORD });

            const sess = await getSessions(u.id);
            expect(sess).toHaveLength(3);
            expect(sess.every((s) => s.revokedAt !== null)).toBe(true);
        });

        it("changes the stored password_hash", async () => {
            const u = await makeUser();
            const before = await readUser(u.id);
            const { rawToken } = await makeResetToken(u.id);

            await post({ token: rawToken, new_password: NEW_PASSWORD });

            const after = await readUser(u.id);
            expect(after.passwordHash).not.toBe(before.passwordHash);
        });

        it("does not touch last_login_at (reset is not a login)", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);

            await post({ token: rawToken, new_password: NEW_PASSWORD });

            expect((await readUser(u.id)).lastLoginAt).toBeNull();
        });

        it("an invalid token produces ZERO side effects", async () => {
            const u = await makeUser();
            const s = await makeSession({ userId: u.id });
            const before = await readUser(u.id);

            const res = await post({
                token: "nope-not-real",
                new_password: NEW_PASSWORD,
            });

            expect(res.status).toBe(400);
            const after = await readUser(u.id);
            expect(after.passwordHash).toBe(before.passwordHash);
            const [sess] = await getSessions(u.id);
            expect(sess.id).toBe(s.id);
            expect(sess.revokedAt).toBeNull();
            expect((await login(u.email, u.password)).status).toBe(200);
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("204 response carries an X-Request-Id header", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            const res = await post({ token: rawToken, new_password: NEW_PASSWORD });
            expect(res.status).toBe(204);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });

        it("echoes a client X-Request-Id on a validation error", async () => {
            const supplied = "trace_reset_77";
            const res = await (await oneOff())
                .post(PATH)
                .set("X-Request-Id", supplied)
                .send({});
            expect(res.status).toBe(422);
            expect(res.get("X-Request-Id")).toBe(supplied);
            expect(res.body.error.request_id).toBe(supplied);
        });

        it("renders the spec error envelope with request_id on the 400 path", async () => {
            const res = await post({
                token: "missing",
                new_password: NEW_PASSWORD,
            });
            expect(res.body.error).toBeDefined();
            expect(res.body.error.request_id).toBe(res.get("X-Request-Id"));
        });

        it("404 route.not_found for GET on the path", async () => {
            const res = await (await oneOff()).get(PATH);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("404 for PUT and DELETE on the path", async () => {
            const put = await (await oneOff()).put(PATH).send({});
            const del = await (await oneOff()).delete(PATH);
            expect(put.status).toBe(404);
            expect(del.status).toBe(404);
        });
    });

    // ─── Exploratory probes ─────────────────────────────────────────────────────
    describe("Exploratory", () => {
        it("422 for an absurdly long token (10k chars)", async () => {
            const res = await post({
                token: "a".repeat(10_000),
                new_password: NEW_PASSWORD,
            });
            expect(res.status).toBe(422);
        });

        it("ignores a deeply nested extra field", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            let nested: object = { leaf: true };
            for (let i = 0; i < 20; i++) nested = { wrap: nested };

            const res = await post({
                token: rawToken,
                new_password: NEW_PASSWORD,
                payload: nested,
            });

            expect(res.status).toBe(204);
        });

        it("422 when the body is form-urlencoded (no JSON fields parsed)", async () => {
            const u = await makeUser();
            const { rawToken } = await makeResetToken(u.id);
            const res = await (await oneOff())
                .post(PATH)
                .set("Content-Type", "application/x-www-form-urlencoded")
                .send(`token=${rawToken}&new_password=${NEW_PASSWORD}`);
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("survives 50 parallel resets of the same token (exactly one wins, DB consistent)", async () => {
            const u = await makeUser();
            const { rawToken, id } = await makeResetToken(u.id);

            const results = await Promise.all(
                Array.from({ length: 50 }, () =>
                    post({ token: rawToken, new_password: NEW_PASSWORD }),
                ),
            );

            const ok = results.filter((r) => r.status === 204);
            const bad = results.filter((r) => r.status === 400);
            expect(ok).toHaveLength(1);
            expect(bad).toHaveLength(49);
            expect((await getToken(id)).consumedAt).not.toBeNull();
            expect((await login(u.email, NEW_PASSWORD)).status).toBe(200);
        }, 60_000);
    });
});
