import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";
import { Config } from "../config";

/**
 * Rate-limit buckets per API_DESIGN.md §1 Rate limits.
 *
 * Workers port: `express-rate-limit` is Node-only, so every limiter is now a
 * plain `(req, res, next)` middleware over an in-memory sliding-window Map
 * (key = route bucket + client IP / user id). Window/limit numbers, key
 * functions and the 429 `AppError` envelope are unchanged from the original.
 *
 * ⚠️ On Cloudflare Workers this Map is PER-ISOLATE state: every isolate (and
 * every cold start) counts independently, so limiting is BEST-EFFORT rather
 * than a hard global guarantee. For a strict global limit, move the counters
 * to a Durable Object / KV and keep the same windowMs/max values.
 *
 * All limiters emit a `429` with the spec's error envelope via `AppError`.
 * In test mode every limiter becomes a no-op so the suite is not blocked by
 * the 5-per-minute auth bucket while running dozens of login fixtures.
 */

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

export const _internal = { authRateLimitHandler };

// ─── Sliding-window store ─────────────────────────────────────────────────────

/** Hit timestamps (epoch ms) per `bucket:key`, pruned to the last window. */
const hitLog = new Map<string, number[]>();

/** All buckets use a 60 s window; the sweeper prunes against this. */
const MAX_WINDOW_MS = 60 * 1000;
/** Hard cap on tracked keys so the per-isolate Map cannot grow unbounded. */
const MAX_TRACKED_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweepAt = 0;

/** Periodically drop expired entries (and, under the cap, the oldest keys). */
const sweep = (now: number): void => {
    if (now - lastSweepAt < SWEEP_INTERVAL_MS && hitLog.size <= MAX_TRACKED_KEYS)
        return;
    lastSweepAt = now;
    const cutoff = now - MAX_WINDOW_MS;
    for (const [key, stamps] of hitLog) {
        while (stamps.length > 0 && stamps[0] <= cutoff) stamps.shift();
        if (stamps.length === 0) hitLog.delete(key);
    }
    // Still over the cap (burst of unique clients): drop oldest-inserted keys.
    if (hitLog.size > MAX_TRACKED_KEYS) {
        for (const key of hitLog.keys()) {
            if (hitLog.size <= MAX_TRACKED_KEYS) break;
            hitLog.delete(key);
        }
    }
};

/**
 * Local stand-in for express-rate-limit's `ipKeyGenerator`: the raw IP is the
 * key (the shim derives `req.ip` from `CF-Connecting-IP`, one address per
 * client — no IPv6 subnet masking needed here).
 */
const ipKeyGenerator = (ip: string): string => ip;

interface LimiterOptions {
    /** Route-bucket name — isolates this limiter's keys in the shared Map. */
    bucket: string;
    windowMs: number;
    limit: number;
    keyGenerator: (req: Request) => string;
    handler: (req: Request, res: Response, next: NextFunction) => void;
}

/** Build a sliding-window limiter middleware (same shape the old lib returned). */
const rateLimit = (opts: LimiterOptions) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        // Per-request test check — env is only populated per-request on Workers.
        if (Config.NODE_ENV === "test") return next();

        const now = Date.now();
        sweep(now);

        const key = `${opts.bucket}:${opts.keyGenerator(req)}`;
        const cutoff = now - opts.windowMs;
        let stamps = hitLog.get(key);
        if (stamps === undefined) {
            stamps = [];
            hitLog.set(key, stamps);
        }
        while (stamps.length > 0 && stamps[0] <= cutoff) stamps.shift();

        const blocked = stamps.length >= opts.limit;
        if (!blocked) stamps.push(now);

        // `standardHeaders: true` equivalent (draft-6 RateLimit-* headers);
        // `legacyHeaders: false` — no X-RateLimit-* emitted.
        const oldest = stamps.length > 0 ? stamps[0] : now;
        res.setHeader("RateLimit-Limit", String(opts.limit));
        res.setHeader(
            "RateLimit-Remaining",
            String(Math.max(0, opts.limit - stamps.length)),
        );
        res.setHeader(
            "RateLimit-Reset",
            String(
                Math.max(0, Math.ceil((oldest + opts.windowMs - now) / 1000)),
            ),
        );

        if (blocked) {
            res.setHeader("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
            opts.handler(req, res, next);
            return;
        }
        next();
    };
};

// ─── Limiters (same buckets/limits as the express-rate-limit originals) ──────

// `/auth/login`, `/auth/forgot-password` — 5/min/IP
export const authStrictLimiter = rateLimit({
    bucket: "auth",
    windowMs: 60 * 1000,
    limit: 5,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
    handler: authRateLimitHandler,
});

// `/api/v1/*` authenticated calls — 600/min/user (fallback to IP if no user yet)
export const apiLimiter = rateLimit({
    bucket: "api",
    windowMs: 60 * 1000,
    limit: 600,
    keyGenerator: (req: Request) => {
        const auth = (req as Request & { auth?: { sub?: string } }).auth;
        if (auth?.sub) return `u:${auth.sub}`;
        return ipKeyGenerator(req.ip ?? "unknown");
    },
    handler,
});

// `/api/v1/public/forms/:slug/submit` — 30/min/IP
export const publicFormLimiter = rateLimit({
    bucket: "public-form",
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
    handler,
});

// `/api/v1/assistant/chat` — 20/min/user (AI cost guard; OpenAI calls cost money)
export const assistantLimiter = rateLimit({
    bucket: "assistant",
    windowMs: 60 * 1000,
    limit: 20,
    keyGenerator: (req: Request) => {
        const auth = (req as Request & { auth?: { sub?: string } }).auth;
        if (auth?.sub) return `u:${auth.sub}`;
        return ipKeyGenerator(req.ip ?? "unknown");
    },
    handler,
});

// `/api/v1/uploads/sign` — 60/min/user
export const uploadSignLimiter = rateLimit({
    bucket: "upload-sign",
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: (req: Request) => {
        const auth = (req as Request & { auth?: { sub?: string } }).auth;
        if (auth?.sub) return `u:${auth.sub}`;
        return ipKeyGenerator(req.ip ?? "unknown");
    },
    handler,
});

// `/auth/invitation/:token` — 5/min/IP (prevent brute-force enumeration)
export const invitationLimiter = rateLimit({
    bucket: "invitation",
    windowMs: 60 * 1000,
    limit: 5,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
    handler: authRateLimitHandler,
});
