import { oneOff } from "../test-utils/app";
import { makeUser, makeWorkspace } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { invitations, users } from "../../src/db/schema";
import { fakeId, sha256 } from "../../src/utils";
import { Config } from "../../src/config";
import { _internal } from "../../src/middlewares/rateLimit";

/**
 * THE RATE LIMITERS, ACTUALLY RUNNING.
 *
 * `/auth/login` has no account lockout in this system — no failed-attempt
 * counter, no cooling-off per account, nothing. `authStrictLimiter` is
 * therefore the ONLY thing standing between a stolen email address and an
 * unlimited offline-speed password guessing loop. It had never once executed
 * inside a test: the bypass was a module-level constant
 * (`NODE_ENV === "test" ? noop : rateLimit(…)`), so under jest the limiter was
 * not merely disabled, it was never constructed. A limiter mounted on the
 * wrong route, carrying the wrong ceiling, or keyed on the wrong thing would
 * have looked exactly the same to all 341 auth tests.
 *
 * P1 found the same shape in `src/db/client.ts` (a whole `if (dbTimezone)`
 * branch that `.env.test` makes unreachable) and closed it the same way: make
 * the switch a runtime decision, then have a test throw it.
 *
 * This suite opts in with `ENABLE_RATE_LIMIT=1` and leaves NODE_ENV alone.
 * That distinction is load-bearing. `MailService` picks a REAL SMTP transport
 * whenever `NODE_ENV !== "test"`, and this project's dev mailer
 * (`live.smtp.mailtrap.io`) actually delivers — so "just run the app in dev
 * mode" would have quietly mailed real people. §A rule 4.
 *
 * Bucket hygiene: `express-rate-limit` keeps its counters in one MemoryStore
 * for the life of the module, and `beforeEach` truncation does not touch them.
 * Every test therefore claims its OWN client IP through `X-Forwarded-For`,
 * which keeps the tests independent and, as a side effect, proves the app's
 * `trust proxy` setting is honoured — without it every request here would
 * share the loopback bucket and these tests would fail immediately.
 */

const LOGIN = "/api/v1/auth/login";
const FORGOT = "/api/v1/auth/forgot-password";
const RESET = "/api/v1/auth/reset-password";
const ACCEPT = "/api/v1/auth/accept-invitation";
const REFRESH = "/api/v1/auth/refresh";
const ME = "/api/v1/auth/me";

/** The documented 5-per-minute ceiling shared by the auth-strict routes. */
const STRICT_LIMIT = 5;

/**
 * A fresh client address per test. TEST-NET-3 (203.0.113.0/24) is reserved for
 * documentation, so these can never collide with a real address.
 */
let ipSeq = 0;
const nextIp = (): string => `203.0.113.${++ipSeq % 250}`;

const bodyOfLogin = { email: "nobody@example.test", password: "Wr0ng#Pass" };

describe("Rate limiting — the limiters actually running", () => {
    const priorEnable = process.env.ENABLE_RATE_LIMIT;
    const priorDisable = process.env.DISABLE_RATE_LIMIT;

    beforeAll(async () => {
        // Guard the guard: if flipping this switch ever started swapping the
        // mail transport too, every test below would be a live-delivery risk.
        // Fail loudly here rather than discover it from a colleague's inbox.
        expect(Config.NODE_ENV).toBe("test");

        process.env.ENABLE_RATE_LIMIT = "1";
        delete process.env.DISABLE_RATE_LIMIT;
        expect(_internal.limitersBypassed()).toBe(false);

        // One warm request, outside `/api/v1` so it costs no bucket slot.
        // `setup-each-auth.ts` already imports the app before any test runs
        // (a cold ts-jest compile of the route tree is ~35 s and would blow
        // whichever test paid it); this covers the remaining first-REQUEST
        // cost — pool checkout, first bcrypt — so the first timing assertion
        // below measures the limiter and not the runtime warming up.
        await (await oneOff()).get("/health");
    }, 120_000);

    afterAll(() => {
        if (priorEnable === undefined) delete process.env.ENABLE_RATE_LIMIT;
        else process.env.ENABLE_RATE_LIMIT = priorEnable;
        if (priorDisable === undefined) delete process.env.DISABLE_RATE_LIMIT;
        else process.env.DISABLE_RATE_LIMIT = priorDisable;

        // Everything after this file must see the suite-wide bypass again.
        expect(_internal.limitersBypassed()).toBe(true);
        expect(Config.NODE_ENV).toBe("test");
    });

    describe("The switch itself", () => {
        it("bypasses under NODE_ENV=test, and ENABLE_RATE_LIMIT=1 overrides that", () => {
            process.env.ENABLE_RATE_LIMIT = "";
            expect(_internal.limitersBypassed()).toBe(true);

            process.env.ENABLE_RATE_LIMIT = "1";
            expect(_internal.limitersBypassed()).toBe(false);
        });

        it("lets the explicit opt-in beat DISABLE_RATE_LIMIT=1", () => {
            process.env.DISABLE_RATE_LIMIT = "1";
            try {
                expect(_internal.limitersBypassed()).toBe(false);
            } finally {
                delete process.env.DISABLE_RATE_LIMIT;
            }
        });
    });

    describe("POST /auth/login — 5/min/IP", () => {
        it("allows five attempts and refuses the sixth with 429 auth.rate_limited", async () => {
            const ip = nextIp();
            const client = await oneOff();

            for (let n = 1; n <= STRICT_LIMIT; n++) {
                const res = await client
                    .post(LOGIN)
                    .set("X-Forwarded-For", ip)
                    .send(bodyOfLogin);
                // 401: the limiter let it through to the password check.
                expect([n, res.status]).toEqual([n, 401]);
            }

            const blocked = await (await oneOff())
                .post(LOGIN)
                .set("X-Forwarded-For", ip)
                .send(bodyOfLogin);

            expect(blocked.status).toBe(429);
            expect(blocked.body).toEqual({
                error: {
                    code: "auth.rate_limited",
                    message: "Too many login attempts. Try again in a minute.",
                    request_id: expect.any(String) as unknown as string,
                },
            });
        });

        it("carries RateLimit headers and a Retry-After on the refusal", async () => {
            const ip = nextIp();
            for (let n = 0; n < STRICT_LIMIT; n++) {
                await (await oneOff())
                    .post(LOGIN)
                    .set("X-Forwarded-For", ip)
                    .send(bodyOfLogin);
            }
            const blocked = await (await oneOff())
                .post(LOGIN)
                .set("X-Forwarded-For", ip)
                .send(bodyOfLogin);

            expect(blocked.status).toBe(429);
            expect(blocked.headers["retry-after"]).toBeDefined();
            // `standardHeaders: true` — the draft RateLimit-* family.
            const names = Object.keys(blocked.headers).join(",");
            expect(names).toMatch(/ratelimit/i);
        });

        it("counts SUCCESSFUL logins too — the ceiling is attempts, not failures", async () => {
            // Worth pinning explicitly: `skipSuccessfulRequests` is NOT set, so
            // a person who signs in correctly six times in a minute (six tabs,
            // six devices, a flaky connection) is refused on the sixth exactly
            // like an attacker. That is a deliberate reading of "attempts", and
            // if it is ever softened this test should be the thing that argues.
            const ws = await makeWorkspace();
            const user = await makeUser({ workspaceId: ws.id });
            const ip = nextIp();
            const good = { email: user.email, password: user.password };

            for (let n = 1; n <= STRICT_LIMIT; n++) {
                const res = await (await oneOff())
                    .post(LOGIN)
                    .set("X-Forwarded-For", ip)
                    .send(good);
                expect([n, res.status]).toEqual([n, 200]);
            }

            const blocked = await (await oneOff())
                .post(LOGIN)
                .set("X-Forwarded-For", ip)
                .send(good);
            expect(blocked.status).toBe(429);
        });

        it("gives a different client IP its own untouched bucket", async () => {
            // Also the proof that `trust proxy` is honoured: without it every
            // request in this file would key on the same loopback address.
            const busy = nextIp();
            for (let n = 0; n < STRICT_LIMIT + 1; n++) {
                await (await oneOff())
                    .post(LOGIN)
                    .set("X-Forwarded-For", busy)
                    .send(bodyOfLogin);
            }
            const exhausted = await (await oneOff())
                .post(LOGIN)
                .set("X-Forwarded-For", busy)
                .send(bodyOfLogin);
            expect(exhausted.status).toBe(429);

            const fresh = await (await oneOff())
                .post(LOGIN)
                .set("X-Forwarded-For", nextIp())
                .send(bodyOfLogin);
            expect(fresh.status).toBe(401);
        });
    });

    describe("The auth-strict routes share ONE bucket", () => {
        it("spends the same five across login, forgot-password, reset-password and accept-invitation", async () => {
            // `authStrictLimiter` is a single middleware instance mounted on
            // four routes, so its five-per-minute is a TOTAL, not five each.
            //
            // The consequence is worth stating plainly, because it is not
            // obvious from any one route file: everyone behind one office NAT
            // shares this bucket. Two colleagues signing in and one asking for
            // a password reset can leave a third — or a new hire accepting an
            // invitation — reading "Too many login attempts."
            const ip = nextIp();
            const send = async (path: string, body: Record<string, unknown>) =>
                (await oneOff()).post(path).set("X-Forwarded-For", ip).send(body);

            // A non-existent address on purpose: forgot-password answers 202
            // either way and writes no token, so no mail can be produced.
            const r1 = await send(LOGIN, bodyOfLogin);
            const r2 = await send(FORGOT, { email: "nobody@example.test" });
            const r3 = await send(FORGOT, { email: "nobody2@example.test" });
            const r4 = await send(RESET, {
                token: "x".repeat(64),
                new_password: "Str0ng#Pass",
            });
            const r5 = await send(LOGIN, bodyOfLogin);

            expect([r1.status, r2.status, r3.status, r4.status, r5.status]).toEqual(
                [401, 202, 202, 400, 401],
            );

            // Six different people, six different intents, one shared ceiling.
            const sixth = await send(ACCEPT, {
                token: "y".repeat(64),
                password: "Str0ng#Pass",
            });
            expect(sixth.status).toBe(429);
            expect((sixth.body as { error: { code: string } }).error.code).toBe(
                "auth.rate_limited",
            );
        });
    });

    describe("GET /auth/invitation/:token — its own 5/min/IP bucket", () => {
        const makeInvitation = async () => {
            const ws = await makeWorkspace();
            const inviter = await makeUser({
                workspaceId: ws.id,
                role: "owner",
            });
            const email = `invitee-${fakeId("z").slice(2, 9)}@example.test`;
            await makeUser({ workspaceId: ws.id, email, status: "invited" });
            const rawToken = `t-${fakeId("k")}${fakeId("k")}`;
            await getDb()
                .insert(invitations)
                .values({
                    id: fakeId("inv"),
                    workspaceId: ws.id,
                    email,
                    role: "member",
                    tokenHash: sha256(rawToken),
                    invitedBy: inviter.id,
                    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
                    acceptedAt: null,
                });
            return rawToken;
        };

        it("refuses the sixth token inspection from one IP", async () => {
            const ip = nextIp();
            const token = await makeInvitation();
            const url = `/api/v1/auth/invitation/${token}`;

            for (let n = 1; n <= STRICT_LIMIT; n++) {
                const res = await (await oneOff())
                    .get(url)
                    .set("X-Forwarded-For", ip);
                expect([n, res.status]).toEqual([n, 200]);
            }

            const blocked = await (await oneOff())
                .get(url)
                .set("X-Forwarded-For", ip);
            expect(blocked.status).toBe(429);
            expect((blocked.body as { error: { code: string } }).error.code).toBe(
                "auth.rate_limited",
            );
        });

        it("does not drain, and is not drained by, the login bucket", async () => {
            const ip = nextIp();
            const token = await makeInvitation();

            // Exhaust the auth-strict bucket entirely.
            for (let n = 0; n < STRICT_LIMIT + 1; n++) {
                await (await oneOff())
                    .post(LOGIN)
                    .set("X-Forwarded-For", ip)
                    .send(bodyOfLogin);
            }
            expect(
                (
                    await (await oneOff())
                        .post(LOGIN)
                        .set("X-Forwarded-For", ip)
                        .send(bodyOfLogin)
                ).status,
            ).toBe(429);

            // A separate instance, so the invitation page still answers — a
            // person accepting an invitation is not punished for someone else
            // on the same network mistyping a password.
            const res = await (await oneOff())
                .get(`/api/v1/auth/invitation/${token}`)
                .set("X-Forwarded-For", ip);
            expect(res.status).toBe(200);
        });
    });

    describe("Routes deliberately OUTSIDE the strict bucket", () => {
        it("lets /auth/refresh, /auth/me and /auth/logout run well past five", async () => {
            // These sit under the 600/min `apiLimiter` instead. If any of them
            // ever inherited the 5/min bucket, a single page — which refreshes
            // on load and polls /auth/me — would lock the user out of their own
            // session within a minute.
            const ip = nextIp();

            for (let n = 0; n < STRICT_LIMIT + 4; n++) {
                const refreshed = await (await oneOff())
                    .post(REFRESH)
                    .set("X-Forwarded-For", ip);
                expect(refreshed.status).toBe(401); // no cookie — but NOT 429

                const me = await (await oneOff())
                    .get(ME)
                    .set("X-Forwarded-For", ip);
                expect(me.status).toBe(401); // no token — but NOT 429
            }
        });
    });

    describe("Users table untouched by refusals", () => {
        it("writes nothing when the limiter refuses", async () => {
            const before = (await getDb().select({ id: users.id }).from(users))
                .length;
            const ip = nextIp();
            for (let n = 0; n < STRICT_LIMIT + 3; n++) {
                await (await oneOff())
                    .post(LOGIN)
                    .set("X-Forwarded-For", ip)
                    .send(bodyOfLogin);
            }
            const after = (await getDb().select({ id: users.id }).from(users))
                .length;
            expect(after).toBe(before);
        });
    });
});
