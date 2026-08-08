"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._testOnly = exports.errorHandler = void 0;
const http_errors_1 = require("http-errors");
const express_jwt_1 = require("express-jwt");
const logger_1 = __importDefault(require("../config/logger"));
const errors_1 = require("../errors");
const buildBody = (req, code, message, details) => ({
    error: {
        code,
        message,
        request_id: req.requestId ?? "unknown",
        ...(details && details.length > 0 ? { details } : {}),
    },
});
/**
 * F11 (ISS-087): the connection pool is exhausted — the request never reached
 * the database.
 *
 * mysql2 signals a full wait queue by throwing a plain `Error("Queue limit
 * reached.")`, which fell through to the unknown-error branch and rendered as a
 * generic 500. That is wrong twice over: the client cannot tell it apart from a
 * genuine fault (so it retries immediately, or not at all), and monitoring
 * counts capacity pressure as server errors. It is a textbook **503** — the
 * server is temporarily unable to handle the request — and it deserves a
 * `Retry-After` so clients back off.
 *
 * The deployed config now uses an unlimited queue (`DB_POOL_QUEUE_LIMIT=0`), so
 * this should never fire here; it stays as the safety net for any deployment
 * that sets a limit, and for the `PROTOCOL_ENQUEUE_AFTER_*` family a closing
 * pool raises during shutdown.
 */
const POOL_EXHAUSTED_RE = /queue limit reached|pool is closed|too many connections|enqueue after (?:fatal error|being destroyed|invoking quit)/i;
const isPoolExhaustion = (err) => {
    const e = err;
    if (!e)
        return false;
    if (e.code === "ER_CON_COUNT_ERROR" || e.code === "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR") {
        return true;
    }
    return typeof e.message === "string" && POOL_EXHAUSTED_RE.test(e.message);
};
/** Seconds a client should wait before retrying a shed request. */
const RETRY_AFTER_SECONDS = 2;
const inferHttpErrorCode = (status) => {
    if (status === 401)
        return "auth.unauthorized";
    if (status === 403)
        return "auth.forbidden";
    if (status === 404)
        return "not_found";
    if (status === 409)
        return "conflict";
    if (status === 413)
        return "payload.too_large";
    if (status === 422)
        return "validation.failed";
    if (status === 429)
        return "rate.exceeded";
    if (status >= 500)
        return "internal";
    return "bad_request";
};
const errorHandler = (err, req, res, _next) => {
    // 1. AppError — already shaped
    if (err instanceof errors_1.AppError) {
        if (err.statusCode >= 500) {
            logger_1.default.error("AppError", {
                requestId: req.requestId,
                code: err.code,
                message: err.message,
                stack: err.stack,
            });
        }
        res.status(err.statusCode).json(buildBody(req, err.code, err.message, err.details));
        return;
    }
    // 2. express-jwt UnauthorizedError — map to the spec-defined codes from
    //    API_DESIGN.md §32. `auth.invalid_token` is not in the table but is
    //    the only sensible code for a bad-signature / wrong-algorithm /
    //    malformed JWT; documented as an intentional extension.
    if (err instanceof express_jwt_1.UnauthorizedError) {
        const inner = err.inner;
        let code = "auth.invalid_token";
        if (err.code === "credentials_required") {
            code = "auth.missing_token";
        }
        else if (inner?.name === "TokenExpiredError") {
            code = "auth.expired_token";
        }
        res.status(401).json(buildBody(req, code, err.message));
        return;
    }
    // 3. http-errors (from `createHttpError(status, message)`)
    if (err instanceof http_errors_1.HttpError) {
        const status = err.statusCode || err.status || 500;
        if (status >= 500) {
            logger_1.default.error("HttpError", {
                requestId: req.requestId,
                status,
                message: err.message,
                stack: err.stack,
            });
        }
        res.status(status).json(buildBody(req, inferHttpErrorCode(status), err.message));
        return;
    }
    // 4. body-parser conventions: any error with a numeric `statusCode` in the
    //    4xx range and `expose: true` is meant to be surfaced to the client
    //    (e.g. malformed JSON SyntaxError). We render it as the spec envelope
    //    using `inferHttpErrorCode` for a sensible domain code.
    const annotated = err;
    const annotatedStatus = annotated?.statusCode ?? annotated?.status;
    if (typeof annotatedStatus === "number" &&
        annotatedStatus >= 400 &&
        annotatedStatus < 500 &&
        annotated?.expose === true) {
        res.status(annotatedStatus).json(buildBody(req, inferHttpErrorCode(annotatedStatus), err?.message ?? "Bad request"));
        return;
    }
    // 5. Pool exhaustion — capacity, not a fault. 503 + Retry-After (F11).
    //    Logged at WARN: this is a load signal, and paging on it as an error
    //    is exactly the monitoring pollution ISS-087 describes.
    if (isPoolExhaustion(err)) {
        logger_1.default.warn("Database pool exhausted — shedding with 503", {
            requestId: req.requestId,
            path: req.originalUrl,
            message: err?.message,
        });
        res.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
        res.status(503).json(buildBody(req, "service.unavailable", "The server is busy. Please retry in a moment."));
        return;
    }
    // 6. Unknown — log full detail, hide internals from client
    logger_1.default.error("Unhandled error", {
        requestId: req.requestId,
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
    });
    res.status(500).json(buildBody(req, "internal", "Internal server error"));
};
exports.errorHandler = errorHandler;
exports._testOnly = { buildBody, inferHttpErrorCode };
