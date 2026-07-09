import type { NextFunction, Request, Response } from "express";
import { validationResult, type ValidationError } from "express-validator";
import { AppError, type ErrorDetail } from "../errors";

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

const formatDetail = (e: ValidationError): ErrorDetail => {
    // `field` (the canonical name in express-validator >=7) or fallback to legacy `param`.
    const field =
        "path" in e && typeof e.path === "string"
            ? e.path
            : "param" in e && typeof e.param === "string"
              ? e.param
              : undefined;
    const issue =
        typeof e.msg === "string"
            ? e.msg
            : "Invalid value";
    return field ? { field, issue } : { issue };
};

export const assertValid = (req: Request): void => {
    const result = validationResult(req);
    if (result.isEmpty()) return;
    const details = result.array().map(formatDetail);
    throw AppError.validationFailed(details);
};

/**
 * Express middleware variant — chainable after express-validator's
 * `checkSchema(...)` so handlers don't have to call assertValid themselves.
 */
export const validate = (
    req: Request,
    _res: Response,
    next: NextFunction,
): void => {
    try {
        assertValid(req);
        next();
    } catch (err) {
        next(err);
    }
};
