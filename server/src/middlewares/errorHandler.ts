import type { ErrorRequestHandler, Request, Response } from "express";
import { HttpError } from "http-errors";
import { UnauthorizedError } from "express-jwt";
import logger from "../config/logger";
import { AppError } from "../errors";
import type { ErrorDetail } from "../errors";

/**
 * Final error handler. Translates every error into the spec envelope:
 *
 *   { error: { code, message, request_id, details? } }
 *
 * Order of translation:
 *   1. `AppError`     — used as-is.
 *   2. `HttpError`    — from http-errors, mapped to a sensible code.
 *   3. `UnauthorizedError` — from express-jwt (missing/invalid/expired token).
 *   4. Anything else — treated as a 500 `internal`.
 *
 * All errors are logged with `requestId` so a 5xx can be cross-referenced
 * to the per-request log line emitted by `requestLoggerMiddleware`.
 */

interface SpecErrorBody {
    error: {
        code: string;
        message: string;
        request_id: string;
        details?: ErrorDetail[];
    };
}

const buildBody = (
    req: Request,
    code: string,
    message: string,
    details?: ErrorDetail[],
): SpecErrorBody => ({
    error: {
        code,
        message,
        request_id: req.requestId ?? "unknown",
        ...(details && details.length > 0 ? { details } : {}),
    },
});

const inferHttpErrorCode = (status: number): string => {
    if (status === 401) return "auth.unauthorized";
    if (status === 403) return "auth.forbidden";
    if (status === 404) return "not_found";
    if (status === 409) return "conflict";
    if (status === 413) return "payload.too_large";
    if (status === 422) return "validation.failed";
    if (status === 429) return "rate.exceeded";
    if (status >= 500) return "internal";
    return "bad_request";
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    // 1. AppError — already shaped
    if (err instanceof AppError) {
        if (err.statusCode >= 500) {
            logger.error("AppError", {
                requestId: req.requestId,
                code: err.code,
                message: err.message,
                stack: err.stack,
            });
        }
        res.status(err.statusCode).json(
            buildBody(req, err.code, err.message, err.details),
        );
        return;
    }

    // 2. express-jwt UnauthorizedError — map to the spec-defined codes from
    //    API_DESIGN.md §32. `auth.invalid_token` is not in the table but is
    //    the only sensible code for a bad-signature / wrong-algorithm /
    //    malformed JWT; documented as an intentional extension.
    if (err instanceof UnauthorizedError) {
        const inner = (err as UnauthorizedError & { inner?: Error }).inner;
        let code = "auth.invalid_token";
        if (err.code === "credentials_required") {
            code = "auth.missing_token";
        } else if (inner?.name === "TokenExpiredError") {
            code = "auth.expired_token";
        }
        res.status(401).json(buildBody(req, code, err.message));
        return;
    }

    // 3. http-errors (from `createHttpError(status, message)`)
    if (err instanceof HttpError) {
        const status = err.statusCode || err.status || 500;
        if (status >= 500) {
            logger.error("HttpError", {
                requestId: req.requestId,
                status,
                message: err.message,
                stack: err.stack,
            });
        }
        res.status(status).json(
            buildBody(req, inferHttpErrorCode(status), err.message),
        );
        return;
    }

    // 4. body-parser conventions: any error with a numeric `statusCode` in the
    //    4xx range and `expose: true` is meant to be surfaced to the client
    //    (e.g. malformed JSON SyntaxError). We render it as the spec envelope
    //    using `inferHttpErrorCode` for a sensible domain code.
    const annotated = err as { statusCode?: number; status?: number; expose?: boolean };
    const annotatedStatus = annotated?.statusCode ?? annotated?.status;
    if (
        typeof annotatedStatus === "number" &&
        annotatedStatus >= 400 &&
        annotatedStatus < 500 &&
        annotated?.expose === true
    ) {
        res.status(annotatedStatus).json(
            buildBody(
                req,
                inferHttpErrorCode(annotatedStatus),
                (err as Error)?.message ?? "Bad request",
            ),
        );
        return;
    }

    // 5. Unknown — log full detail, hide internals from client
    logger.error("Unhandled error", {
        requestId: req.requestId,
        name: (err as Error)?.name,
        message: (err as Error)?.message,
        stack: (err as Error)?.stack,
    });
    res.status(500).json(
        buildBody(req, "internal", "Internal server error"),
    );
};

export const _testOnly = { buildBody, inferHttpErrorCode };
export type { Response };
