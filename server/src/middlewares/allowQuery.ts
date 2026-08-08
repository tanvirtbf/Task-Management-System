import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";

/**
 * F23 (ISS-014): refuse unknown query parameters on collection endpoints.
 *
 * express-validator whitelists the params it knows and IGNORES the rest, so a
 * client that mistyped a filter name (`?search=` instead of `?q=`) silently
 * received the entire unfiltered set — P2 measured `/users?search=zzzz`
 * returning all 16 rows. A typo must be a 422 that names the parameter, not a
 * quietly wrong answer.
 *
 * Applied per-route with that route's real parameter set. Matching is
 * exact-name; the standard pagination pair is included by the caller where the
 * endpoint supports it.
 */
export const allowQuery =
    (allowed: string[]) =>
    (req: Request, _res: Response, next: NextFunction): void => {
        const allowedSet = new Set(allowed);
        const unknown = Object.keys(req.query).filter(
            (k) => !allowedSet.has(k),
        );
        if (unknown.length === 0) {
            next();
            return;
        }
        next(
            AppError.validationFailed(
                unknown.map((k) => ({
                    field: k,
                    issue: `Unknown query parameter — this endpoint accepts: ${allowed.join(", ") || "(none)"}`,
                })),
            ),
        );
    };

export default allowQuery;
