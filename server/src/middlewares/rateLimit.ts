import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";

/**
 * Rate-limit buckets per API_DESIGN.md §1 Rate limits.
 *
 * V1 uses the in-memory store from `express-rate-limit`. For production with
 * multiple instances, swap the `store` option to a Redis-backed one and keep
 * the same windowMs/max values.
 *
 * All limiters emit a `429` with the spec's error envelope via `AppError`.
 * In test mode every limiter becomes a no-op so the suite is not blocked by
 * the 5-per-minute auth bucket while running dozens of login fixtures.
 */

const isTest = process.env.NODE_ENV === "test";

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

const noop = (_req: Request, _res: Response, next: NextFunction) => next();

// `/auth/login`, `/auth/forgot-password` — 5/min/IP
export const authStrictLimiter = isTest
    ? noop
    : rateLimit({
          windowMs: 60 * 1000,
          limit: 5,
          standardHeaders: true,
          legacyHeaders: false,
          keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
          handler: authRateLimitHandler,
      });

// `/api/v1/*` authenticated calls — 600/min/user (fallback to IP if no user yet)
export const apiLimiter = isTest
    ? noop
    : rateLimit({
          windowMs: 60 * 1000,
          limit: 600,
          standardHeaders: true,
          legacyHeaders: false,
          keyGenerator: (req: Request) => {
              const auth = (req as Request & { auth?: { sub?: string } }).auth;
              if (auth?.sub) return `u:${auth.sub}`;
              return ipKeyGenerator(req.ip ?? "unknown");
          },
          handler,
      });

// `/api/v1/public/forms/:slug/submit` — 30/min/IP
export const publicFormLimiter = isTest
    ? noop
    : rateLimit({
          windowMs: 60 * 1000,
          limit: 30,
          standardHeaders: true,
          legacyHeaders: false,
          keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
          handler,
      });

// `/api/v1/uploads/sign` — 60/min/user
export const uploadSignLimiter = isTest
    ? noop
    : rateLimit({
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
      });
