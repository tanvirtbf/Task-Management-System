"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitationLimiter = exports.uploadSignLimiter = exports.reportGenerateLimiter = exports.assistantLimiter = exports.publicFormLimiter = exports.apiLimiter = exports.authStrictLimiter = exports._internal = void 0;
const express_rate_limit_1 = require("express-rate-limit");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const errors_1 = require("../errors");
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
// Rate limiting is bypassed under the test runner, and via an explicit opt-in
// escape hatch (`DISABLE_RATE_LIMIT=1`) used by local browser-E2E runs — those
// log in many times per minute from one IP and would otherwise trip the
// 5/min auth bucket. NEVER set this in production.
const rateLimitOff = isTest || process.env.DISABLE_RATE_LIMIT === "1";
const handler = (_req, _res, next) => next(errors_1.AppError.rateLimited());
// Auth-specific bucket gets its own error code per API_DESIGN.md §32 — the
// frontend can distinguish "you've been trying to log in too fast" from
// "you've burst the general API quota".
//
// Exported via `_internal` so the test suite can unit-test the handler
// without forcibly re-enabling the limiter in test mode.
const authRateLimitHandler = (_req, _res, next) => next(new errors_1.AppError(429, "auth.rate_limited", "Too many login attempts. Try again in a minute."));
exports._internal = { authRateLimitHandler };
const noop = (_req, _res, next) => next();
// `/auth/login`, `/auth/forgot-password` — 5/min/IP
exports.authStrictLimiter = rateLimitOff
    ? noop
    : (0, express_rate_limit_1.rateLimit)({
        windowMs: 60 * 1000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? "unknown"),
        handler: authRateLimitHandler,
    });
/**
 * Gap-scan M1: this limiter mounts BEFORE the per-route `authenticate`, so
 * `req.auth` is never set here and the whole office NAT used to share one
 * 600/min IP bucket. Bucket on an UNVERIFIED decode of the Bearer `sub`
 * instead — for RATE-KEYING only (never authorization): forging a sub merely
 * splits buckets, exactly like rotating IPs, while real users each get their
 * own quota.
 */
const bearerSub = (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
        return null;
    const payload = jsonwebtoken_1.default.decode(header.slice(7));
    const sub = payload && typeof payload === "object" ? payload.sub : undefined;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
};
// `/api/v1/*` calls — 600/min/user (IP bucket only for tokenless requests)
exports.apiLimiter = rateLimitOff
    ? noop
    : (0, express_rate_limit_1.rateLimit)({
        windowMs: 60 * 1000,
        limit: 600,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            const auth = req.auth;
            if (auth?.sub)
                return `u:${auth.sub}`;
            const sub = bearerSub(req);
            if (sub)
                return `u:${sub}`;
            return (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? "unknown");
        },
        handler,
    });
// `/api/v1/public/forms/:slug/submit` — 30/min/IP
exports.publicFormLimiter = rateLimitOff
    ? noop
    : (0, express_rate_limit_1.rateLimit)({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? "unknown"),
        handler,
    });
// `/api/v1/assistant/chat` — 20/min/user (AI cost guard; OpenAI calls cost money)
exports.assistantLimiter = rateLimitOff
    ? noop
    : (0, express_rate_limit_1.rateLimit)({
        windowMs: 60 * 1000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            const auth = req.auth;
            if (auth?.sub)
                return `u:${auth.sub}`;
            return (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? "unknown");
        },
        handler,
    });
// `/api/v1/reports/generate` — 10/min/user (Dept Review V1 A-8; report
// computation fans out several aggregate queries — post-auth keyed).
exports.reportGenerateLimiter = rateLimitOff
    ? noop
    : (0, express_rate_limit_1.rateLimit)({
        windowMs: 60 * 1000,
        limit: 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            const auth = req.auth;
            if (auth?.sub)
                return `u:${auth.sub}`;
            return (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? "unknown");
        },
        handler,
    });
// `/api/v1/uploads/sign` — 60/min/user
exports.uploadSignLimiter = rateLimitOff
    ? noop
    : (0, express_rate_limit_1.rateLimit)({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            const auth = req.auth;
            if (auth?.sub)
                return `u:${auth.sub}`;
            return (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? "unknown");
        },
        handler,
    });
// `/auth/invitation/:token` — 5/min/IP (prevent brute-force enumeration)
exports.invitationLimiter = rateLimitOff
    ? noop
    : (0, express_rate_limit_1.rateLimit)({
        windowMs: 60 * 1000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => (0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? "unknown"),
        handler: authRateLimitHandler,
    });
