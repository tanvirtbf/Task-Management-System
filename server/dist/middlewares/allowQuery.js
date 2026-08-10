"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowQuery = void 0;
const errors_1 = require("../errors");
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
const allowQuery = (allowed) => (req, _res, next) => {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(req.query).filter((k) => !allowedSet.has(k));
    if (unknown.length === 0) {
        next();
        return;
    }
    next(errors_1.AppError.validationFailed(unknown.map((k) => ({
        field: k,
        issue: `Unknown query parameter — this endpoint accepts: ${allowed.join(", ") || "(none)"}`,
    }))));
};
exports.allowQuery = allowQuery;
exports.default = exports.allowQuery;
