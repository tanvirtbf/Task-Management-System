"use strict";
/**
 * Domain error type carrying the spec-compliant error envelope.
 *
 * Per API_DESIGN.md §1 — every error response has the shape:
 *   { error: { code, message, request_id, details? } }
 *
 * Application code throws `new AppError(...)` and the global error handler
 * translates it into the JSON envelope above.
 *
 * Use one of the static factories for the common cases — they ensure the
 * error code follows the dotted-namespace convention from §32.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        // Preserve stack
        Error.captureStackTrace?.(this, AppError);
    }
    // ─── 4xx factories ─────────────────────────────────────────────────────
    static badRequest(code, message, details) {
        return new AppError(400, code, message, details);
    }
    static validationFailed(details) {
        return new AppError(422, "validation.failed", "One or more fields failed validation", details);
    }
    static unauthorized(code = "auth.unauthorized", message = "Authentication required") {
        return new AppError(401, code, message);
    }
    static forbidden(code = "auth.forbidden", message = "You don't have permission to perform this action", details) {
        return new AppError(403, code, message, details);
    }
    static notFound(code, message) {
        return new AppError(404, code, message);
    }
    static conflict(code, message) {
        return new AppError(409, code, message);
    }
    static unprocessable(code, message, details) {
        return new AppError(422, code, message, details);
    }
    static rateLimited(message = "Rate limit exceeded") {
        return new AppError(429, "rate.exceeded", message);
    }
    // ─── 5xx factories ─────────────────────────────────────────────────────
    static internal(message = "Internal server error") {
        return new AppError(500, "internal", message);
    }
    static maintenance(message = "Service temporarily unavailable") {
        return new AppError(503, "maintenance", message);
    }
}
exports.AppError = AppError;
