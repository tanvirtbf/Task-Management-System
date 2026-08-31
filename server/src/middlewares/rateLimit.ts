import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../errors";

/**
 * Rate-limit buckets per API_DESIGN.md §1 Rate limits.
 *
 * V1 uses the in-memory store from `express-rate-limit`. For production with
 * multiple instances, swap the `store` option to a Redis-backed one and keep
 * the same windowMs/max values.
 *
 * All limiters emit a `429` with the spec's error envelope via `AppError`.
 * Under the test runner every limiter is bypassed, so the suite is not blocked
 * by the 5-per-minute auth bucket while running dozens of login fixtures.
 */

/**
 * Is the bypass in force for THIS request?
 *
 * Read per request rather than resolved once at import time, and that is the
 * whole point of the shape. The bypass used to be a module constant:
 *
 *     const rateLimitOff = process.env.NODE_ENV === "test" || …;
 *     export const authStrictLimiter = rateLimitOff ? noop : rateLimit({…});
 *
 * which meant that under jest the limiter object was never even constructed.
 * Every test in this repository therefore ran against a system with NO rate
 * limiting of any kind, and no test could have discovered a limiter mounted on
 * the wrong route, carrying the wrong ceiling, or keyed on the wrong thing —
 * the code under test simply was not there. For `/auth/login` that matters more
 * than for most: there is no account lockout in this system, so this limiter is
 * the ONLY brute-force protection the password check has.
 *
 * Deciding per request costs one function call and makes the real middleware
 * reachable from a test that opts in with `ENABLE_RATE_LIMIT=1`, without
 * touching NODE_ENV — which would also swap the mail transport from the log
 * stub to LIVE SMTP, and this project's dev mailer really delivers.
 *
 * Precedence: an explicit opt-in wins over both bypasses.
 *   ENABLE_RATE_LIMIT=1  → limiters ON, always (the dedicated test pass)
 *   NODE_ENV=test        → OFF (the whole suite)
 *   DISABLE_RATE_LIMIT=1 → OFF (local browser-E2E: many logins/min from one
 *                          IP). NEVER set this one in production.
 */
const limitersBypassed = (): boolean => {
    if (process.env.ENABLE_RATE_LIMIT === "1") return false;
    return (
        process.env.NODE_ENV === "test" ||
        process.env.DISABLE_RATE_LIMIT === "1"
    );
};

/**
 * Wrap a limiter so the bypass is checked when the request arrives instead of
 * when the module loads. The limiter itself is always constructed, so its
 * configuration is real in every environment — only whether it RUNS varies.
 * (`express-rate-limit`'s MemoryStore unrefs its sweep timer, so building them
 * under jest does not hold the process open.)
 */
const gated =
    (limiter: RequestHandler): RequestHandler =>
    (req: Request, res: Response, next: NextFunction) =>
        limitersBypassed() ? next() : limiter(req, res, next);

const handler = (_req: Request, _res: unknown, next: (err: AppError) => void) =>
    next(AppError.rateLimited());

// Auth-specific bucket gets its own error code per API_DESIGN.md §32 — the
// frontend can distinguish "you've been trying to log in too fast" from
// "you've burst the general API quota".
//
// Exported via `_internal` so the test suite can unit-test the handler
// without forcibly re-enabling the limiter in test mode.
const authRateLimitHandler = (
    _req: Request,
    _res: unknown,
    next: (err: AppError) => void,
) =>
    next(
        new AppError(
            429,
            "auth.rate_limited",
            "Too many login attempts. Try again in a minute.",
        ),
    );

export const _internal = { authRateLimitHandler, limitersBypassed };

// `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`,
// `/auth/accept-invitation` — 5/min/IP.
//
// ONE instance shared by those four routes, which means ONE bucket: five
// requests spread across them in a minute exhausts it, not five each. That is
// deliberate for brute force (an attacker does not care which door), and it is
// worth knowing that it also applies to the office: `trust proxy` resolves
// req.ip to the real client address, so everyone behind a single NAT shares
// this bucket. Measured and recorded in P2 of FULL_SYSTEM_TEST_PLAN_2026-08-29.
export const authStrictLimiter = gated(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
        handler: authRateLimitHandler,
    }),
);

/**
 * Gap-scan M1: this limiter mounts BEFORE the per-route `authenticate`, so
 * `req.auth` is never set here and the whole office NAT used to share one
 * 600/min IP bucket. Bucket on an UNVERIFIED decode of the Bearer `sub`
 * instead — for RATE-KEYING only (never authorization): forging a sub merely
 * splits buckets, exactly like rotating IPs, while real users each get their
 * own quota.
 */
const bearerSub = (req: Request): string | null => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const payload = jwt.decode(header.slice(7));
    const sub =
        payload && typeof payload === "object" ? payload.sub : undefined;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
};

// `/api/v1/*` calls — 600/min/user (IP bucket only for tokenless requests)
export const apiLimiter = gated(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 600,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => {
            const auth = (req as Request & { auth?: { sub?: string } }).auth;
            if (auth?.sub) return `u:${auth.sub}`;
            const sub = bearerSub(req);
            if (sub) return `u:${sub}`;
            return ipKeyGenerator(req.ip ?? "unknown");
        },
        handler,
    }),
);

// `/api/v1/public/forms/:slug/submit` — 30/min/IP
export const publicFormLimiter = gated(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
        handler,
    }),
);

// `/api/v1/assistant/chat` — 20/min/user (AI cost guard; OpenAI calls cost money)
export const assistantLimiter = gated(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => {
            const auth = (req as Request & { auth?: { sub?: string } }).auth;
            if (auth?.sub) return `u:${auth.sub}`;
            return ipKeyGenerator(req.ip ?? "unknown");
        },
        handler,
    }),
);

// `/api/v1/reports/generate` — 10/min/user (Dept Review V1 A-8; report
// computation fans out several aggregate queries — post-auth keyed).
export const reportGenerateLimiter = gated(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => {
            const auth = (req as Request & { auth?: { sub?: string } }).auth;
            if (auth?.sub) return `u:${auth.sub}`;
            return ipKeyGenerator(req.ip ?? "unknown");
        },
        handler,
    }),
);

// `/api/v1/uploads/sign` — 60/min/user
export const uploadSignLimiter = gated(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => {
            const auth = (req as Request & { auth?: { sub?: string } }).auth;
            if (auth?.sub) return `u:${auth.sub}`;
            return ipKeyGenerator(req.ip ?? "unknown");
        },
        handler,
    }),
);

// `/auth/invitation/:token` — 5/min/IP (prevent brute-force enumeration).
// Its own instance, so token-inspection attempts and login attempts do not
// drain each other's bucket.
export const invitationLimiter = gated(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
        handler: authRateLimitHandler,
    }),
);
