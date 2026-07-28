"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = exports.assertValid = void 0;
const express_validator_1 = require("express-validator");
const errors_1 = require("../errors");
/**
 * Bridge from express-validator's `validationResult(req).array()` to the
 * spec error envelope. Throws `AppError.validationFailed(...)` so the global
 * handler emits:
 *
 *   422 { error: { code: "validation.failed", message, request_id,
 *                  details: [{ field, issue }, ...] } }
 *
 * Wrap with `assertValid(req)` at the top of any controller after the
 * `checkSchema(...)` middleware ran.
 */
const formatDetail = (e) => {
    // `field` (the canonical name in express-validator >=7) or fallback to legacy `param`.
    const field = "path" in e && typeof e.path === "string"
        ? e.path
        : "param" in e && typeof e.param === "string"
            ? e.param
            : undefined;
    const issue = typeof e.msg === "string"
        ? e.msg
        : "Invalid value";
    return field ? { field, issue } : { issue };
};
const assertValid = (req) => {
    const result = (0, express_validator_1.validationResult)(req);
    if (result.isEmpty())
        return;
    const details = result.array().map(formatDetail);
    throw errors_1.AppError.validationFailed(details);
};
exports.assertValid = assertValid;
/**
 * Express middleware variant — chainable after express-validator's
 * `checkSchema(...)` so handlers don't have to call assertValid themselves.
 */
const validate = (req, _res, next) => {
    try {
        (0, exports.assertValid)(req);
        next();
    }
    catch (err) {
        next(err);
    }
};
exports.validate = validate;
