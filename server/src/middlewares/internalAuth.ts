import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { Config } from "../config";
import { AppError } from "../errors";

/**
 * Constant-time string compare that never short-circuits on length.
 * `timingSafeEqual` THROWS on unequal buffer lengths, so guard that first.
 */
const safeEqual = (a: string, b: string): boolean => {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
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
export const internalAuth = (
    req: Request,
    _res: Response,
    next: NextFunction,
) => {
    const expected = Config.INTERNAL_JOB_TOKEN;
    const provided = req.header("x-internal-token");

    if (!expected || !provided || !safeEqual(provided, expected)) {
        return next(AppError.unauthorized());
    }
    next();
};

export default internalAuth;
