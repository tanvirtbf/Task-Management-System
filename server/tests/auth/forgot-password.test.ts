import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { passwordResetTokens, users, sessions } from "../../src/db/schema";
import { sha256 } from "../../src/utils";
import { MailService } from "../../src/services/MailService";

/**
 * Tests for `POST /api/v1/auth/forgot-password` (API_DESIGN.md §2).
 *
 * Patterns mirror `tests/auth/login.test.ts` + `tests/auth/me.test.ts`:
 *   - Real DB writes via `tests/test-utils/factories`.
 *   - Stateless supertest via `oneOff()` (the endpoint is public — no cookies).
 *   - `beforeEach` in `tests/test-utils/setup-each.ts` truncates every table.
 *   - The email side effect is observed by spying on the injected MailService's
 *     prototype method — no real mail leaves the process (V1 is a log transport
 *     anyway).
 *
 * The contract is enumeration-safe: every syntactically valid email returns an
 * identical `202 {}`, and a reset-token row + email are produced ONLY for an
 * active account. Tests assert the DB side effect (token rows) as the source of
 * truth, with the mailer spy confirming delivery.
 */

// DB truncation per test (~3-4s) + a parallel burst push setup past jest's 5s
// default; match the headroom the project's other DB-heavy suites use.
jest.setTimeout(30_000);

const PATH = "/api/v1/auth/forgot-password";

let mailSpy: jest.SpyInstance;

beforeEach(() => {
    // Spy on the prototype so the route's singleton MailService is intercepted.
    // mockResolvedValue keeps the real (logging) transport from running and lets
    // us assert delivery args.
    mailSpy = jest
        .spyOn(MailService.prototype, "sendPasswordResetEmail")
        .mockResolvedValue(undefined);
});

afterEach(() => {
    mailSpy.mockRestore();
});

const post = async (body: object) => (await oneOff()).post(PATH).send(body);

const getResetTokens = async (userId: string) => {
    const db = getDb();
    return db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId));
};

const countAllResetTokens = async (): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: passwordResetTokens.id })
            .from(passwordResetTokens)
    ).length;
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

const countSessions = async (userId: string): Promise<number> => {
    const db = getDb();
    return (
        await db
            .select({ id: sessions.id })
            .from(sessions)
            .where(eq(sessions.userId, userId))
    ).length;
};

/** Pull the raw token out of the reset URL the mailer was handed. */
const tokenFromSpy = (): string => {
    const call = mailSpy.mock.calls[0] as [string, string];
    return call[1].split("/reset-password/")[1];
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/auth/forgot-password", () => {
    // ─── a. Happy path ────────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("returns 202 with an empty body for an active user", async () => {
            const u = await makeUser();

            const res = await post({ email: u.email });

            expect(res.status).toBe(202);
            expect(res.body).toEqual({});
        });

        it("creates exactly one unconsumed reset-token row ~30 min out", async () => {
            const u = await makeUser();

            await post({ email: u.email });

            const rows = await getResetTokens(u.id);
            expect(rows).toHaveLength(1);
            expect(rows[0].consumedAt).toBeNull();
            const ttl = rows[0].expiresAt.getTime() - Date.now();
            expect(ttl).toBeGreaterThan(29 * 60 * 1000);
            expect(ttl).toBeLessThan(31 * 60 * 1000);
        });

        it("emails the active user a link whose token hashes to the stored hash", async () => {
            const u = await makeUser();

            await post({ email: u.email });

            expect(mailSpy).toHaveBeenCalledTimes(1);
            const [toArg] = mailSpy.mock.calls[0] as [string, string];
            expect(toArg).toBe(u.email);

            const rawToken = tokenFromSpy();
            expect(rawToken).toBeTruthy();
            const rows = await getResetTokens(u.id);
            expect(rows[0].tokenHash).toBe(sha256(rawToken));
        });

        it("matches the user case-insensitively (mixed case + whitespace)", async () => {
            const u = await makeUser({ email: "ayesha@beautybooth.test" });

            const res = await post({ email: "  AYESHA@BeautyBooth.TEST  " });

            expect(res.status).toBe(202);
            expect(await getResetTokens(u.id)).toHaveLength(1);
        });

        it("never returns the raw token in the response body", async () => {
            const u = await makeUser();

            const res = await post({ email: u.email });

            expect(res.body).toEqual({});
            expect(JSON.stringify(res.body)).not.toContain("reset-password");
        });
    });

    // ─── b. Validation ────────────────────────────────────────────────────────
    describe("Validation", () => {
        it("returns 422 when email is missing", async () => {
            const res = await post({});

            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });

        it("returns 422 when email is an empty string", async () => {
            const res = await post({ email: "" });

            expect(res.status).toBe(422);
        });

        it("returns 422 for a malformed email", async () => {
            const res = await post({ email: "not-an-email" });

            expect(res.status).toBe(422);
        });

        it("returns 422 when email exceeds 255 characters", async () => {
            const local = "a".repeat(250);
            const res = await post({ email: `${local}@x.com` });

            expect(res.status).toBe(422);
        });

        it("returns 422 when email is a number", async () => {
            const res = await post({ email: 12345 });

            expect(res.status).toBe(422);
        });

        it("returns 422 when email is an array", async () => {
            const res = await post({ email: ["a@b.com"] });

            expect(res.status).toBe(422);
        });

        it("ignores unknown extra fields and still processes the email", async () => {
            const u = await makeUser();

            const res = await post({
                email: u.email,
                role: "owner",
                isAdmin: true,
            });

            expect(res.status).toBe(202);
            expect(await getResetTokens(u.id)).toHaveLength(1);
        });

        it("returns 400 with the spec envelope on malformed JSON", async () => {
            const res = await (await oneOff())
                .post(PATH)
                .set("Content-Type", "application/json")
                .send('{"email": "x@y.com"');

            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
        });

        it("returns 413 when the body exceeds the 1 MB limit", async () => {
            const res = await (
                await oneOff()
            )
                .post(PATH)
                .set("Content-Type", "application/json")
                .send(JSON.stringify({ email: "x".repeat(1_100_000) }));

            expect(res.status).toBe(413);
        });
    });

    // ─── c. Auth (public endpoint) ────────────────────────────────────────────
    describe("Auth", () => {
        it("works with no Authorization header (public)", async () => {
            const u = await makeUser();

            const res = await post({ email: u.email });

            expect(res.status).toBe(202);
        });
    });

    // ─── d/e. Enumeration protection / non-active accounts ────────────────────
    describe("Enumeration protection", () => {
        it("returns 202 and writes no token for a non-existent email", async () => {
            const res = await post({ email: "ghost@nobody.test" });

            expect(res.status).toBe(202);
            expect(res.body).toEqual({});
            expect(await countAllResetTokens()).toBe(0);
        });

        it("does not call the mailer for a non-existent email", async () => {
            await post({ email: "ghost@nobody.test" });

            expect(mailSpy).not.toHaveBeenCalled();
        });

        it("returns 202 and writes no token for a deactivated user", async () => {
            const u = await makeUser({ status: "deactivated" });

            const res = await post({ email: u.email });

            expect(res.status).toBe(202);
            expect(await getResetTokens(u.id)).toHaveLength(0);
            expect(mailSpy).not.toHaveBeenCalled();
        });

        it("returns 202 and writes no token for an invited (not-yet-active) user", async () => {
            const u = await makeUser({ status: "invited" });

            const res = await post({ email: u.email });

            expect(res.status).toBe(202);
            expect(await getResetTokens(u.id)).toHaveLength(0);
        });

        it("returns the SAME status and body for existing-active vs non-existent", async () => {
            const u = await makeUser();

            const hit = await post({ email: u.email });
            const miss = await post({ email: "ghost@nobody.test" });

            expect(hit.status).toBe(miss.status);
            expect(hit.body).toEqual(miss.body);
            expect(hit.status).toBe(202);
        });
    });

    // ─── g. Tenant isolation ──────────────────────────────────────────────────
    describe("Tenant isolation", () => {
        it("issues the token for the oldest account when an email exists in two workspaces", async () => {
            const wsA = await makeWorkspace({ name: "A" });
            const wsB = await makeWorkspace({ name: "B" });
            const email = "dup@two-workspaces.test";
            const first = await makeUser({ workspaceId: wsA.id, email });
            await makeUser({ workspaceId: wsB.id, email });
            // `created_at` is second-precision, so two same-second inserts can
            // tie and make "oldest" ambiguous. Pin `first` unambiguously older so
            // the test deterministically exercises the oldest-account-wins rule.
            await getDb()
                .update(users)
                .set({ createdAt: new Date(Date.now() - 60_000) })
                .where(eq(users.id, first.id));

            const res = await post({ email });

            expect(res.status).toBe(202);
            // findByEmail tie-breaks on oldest createdAt → the first user.
            expect(await getResetTokens(first.id)).toHaveLength(1);
            expect(await countAllResetTokens()).toBe(1);
        });
    });

    // ─── h/i. Idempotency / concurrency ───────────────────────────────────────
    describe("Repeat + concurrency", () => {
        it("invalidates the prior token on a second request (only the newest survives)", async () => {
            const u = await makeUser();

            await post({ email: u.email });
            const firstHash = (await getResetTokens(u.id))[0].tokenHash;

            await post({ email: u.email });
            const rows = await getResetTokens(u.id);

            expect(rows).toHaveLength(1);
            expect(rows[0].tokenHash).not.toBe(firstHash);
        });

        it("serves 10 parallel requests for the same user without error", async () => {
            const u = await makeUser();

            const results = await Promise.all(
                Array.from({ length: 10 }, () => post({ email: u.email })),
            );

            for (const r of results) {
                expect(r.status).toBe(202);
            }
            // At least one usable token remains; the DB is consistent (no orphan).
            expect((await getResetTokens(u.id)).length).toBeGreaterThanOrEqual(
                1,
            );
        });
    });

    // ─── k. Boundary values ───────────────────────────────────────────────────
    describe("Boundary values", () => {
        it("matches a plus-addressed email verbatim (no alias stripping)", async () => {
            const email = "ayesha+reset@beautybooth.test";
            const u = await makeUser({ email });

            const res = await post({ email });

            expect(res.status).toBe(202);
            expect(await getResetTokens(u.id)).toHaveLength(1);
        });

        it("accepts a long-but-valid email (just under the 255-char cap)", async () => {
            // RFC-valid email near the 255-char cap: a 64-char local part (the
            // RFC 5321 max) + a multi-label domain whose every label is ≤63
            // chars. Total = 64 + 1 + 187 = 252 ≤ 255. (A >64-char local part is
            // RFC-INVALID and is correctly rejected by `isEmail`, so the prior
            // 241-char-local address was never a legitimate 202 case.)
            const local = "a".repeat(64);
            const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(54)}.test`;
            const email = `${local}@${domain}`;
            const u = await makeUser({ email });

            const res = await post({ email });

            expect(res.status).toBe(202);
            expect(await getResetTokens(u.id)).toHaveLength(1);
        });
    });

    // ─── l/m. Side effects / resilience ───────────────────────────────────────
    describe("Side effects", () => {
        it("does not change the user's password_hash or last_login_at", async () => {
            const u = await makeUser();
            const before = await readUser(u.id);

            await post({ email: u.email });

            const after = await readUser(u.id);
            expect(after.passwordHash).toBe(before.passwordHash);
            expect(after.lastLoginAt).toBeNull();
        });

        it("creates no session rows", async () => {
            const u = await makeUser();

            await post({ email: u.email });

            expect(await countSessions(u.id)).toBe(0);
        });

        it("still returns 202 and keeps the token row when the mailer throws", async () => {
            const u = await makeUser();
            mailSpy.mockRejectedValueOnce(new Error("SMTP down"));

            const res = await post({ email: u.email });

            expect(res.status).toBe(202);
            // The token was committed before the (failed) send — the user can
            // request another link.
            expect(await getResetTokens(u.id)).toHaveLength(1);
        });
    });

    // ─── Cross-cutting: Request-ID / error envelope ───────────────────────────
    describe("Request-ID", () => {
        it("echoes a client X-Request-Id verbatim on a validation error", async () => {
            const supplied = "trace_forgot_42";
            const res = await (await oneOff())
                .post(PATH)
                .set("X-Request-Id", supplied)
                .send({ email: "" });

            expect(res.status).toBe(422);
            expect(res.get("X-Request-Id")).toBe(supplied);
            expect(res.body.error.request_id).toBe(supplied);
        });

        it("sets an X-Request-Id on a successful 202", async () => {
            const u = await makeUser();

            const res = await post({ email: u.email });

            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });

    // ─── Exploratory ──────────────────────────────────────────────────────────
    describe("Exploratory", () => {
        it("returns 404 route.not_found for GET on the path", async () => {
            const res = await (await oneOff()).get(PATH);

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("route.not_found");
        });

        it("returns 404 for PUT and DELETE on the path", async () => {
            const put = await (await oneOff())
                .put(PATH)
                .send({ email: "a@b.c" });
            const del = await (await oneOff()).delete(PATH);

            expect(put.status).toBe(404);
            expect(del.status).toBe(404);
        });

        it("matches the route with a trailing slash", async () => {
            const u = await makeUser();

            const res = await (await oneOff())
                .post(`${PATH}/`)
                .send({ email: u.email });

            expect(res.status).toBe(202);
        });
    });
});
