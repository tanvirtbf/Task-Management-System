"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.internalAuth = void 0;
const crypto_1 = require("crypto");
const config_1 = require("../config");
const errors_1 = require("../errors");
/**
 * Constant-time string compare that never short-circuits on length.
 * `timingSafeEqual` THROWS on unequal buffer lengths, so guard that first.
 */
const safeEqual = (a, b) => {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(ab, bb);
};
/**
 * §28 internal-job guard. Rejects any request whose `X-Internal-Token` header
 * does not equal `Config.INTERNAL_JOB_TOKEN`, with `401 auth.unauthorized`.
 *
 * FAILS CLOSED: when `INTERNAL_JOB_TOKEN` is unset the endpoint is unreachable —
 * "no token configured" must never mean "open to the internet". Jobs carry no
 * `req.auth`, so this REPLACES the `authenticate`/`canAccess` chain (it is the
 * sole guard on every `/jobs` route), and uses a constant-time compare so the
 * token can't be recovered byte-by-byte via response timing.
 */
const internalAuth = (req, _res, next) => {
    const expected = config_1.Config.INTERNAL_JOB_TOKEN;
    const provided = req.header("x-internal-token");
    if (!expected || !provided || !safeEqual(provided, expected)) {
        return next(errors_1.AppError.unauthorized());
    }
    next();
};
exports.internalAuth = internalAuth;
exports.default = exports.internalAuth;
