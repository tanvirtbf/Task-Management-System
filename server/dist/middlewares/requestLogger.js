"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLoggerMiddleware = void 0;
const logger_1 = __importDefault(require("../config/logger"));
/**
 * Structured per-request logger. Emits one JSON line per request when the
 * response finishes, with method, route, status, duration, and request_id.
 *
 * Place AFTER `requestIdMiddleware` so `req.requestId` is populated.
 */
const requestLoggerMiddleware = (req, res, next) => {
    const start = process.hrtime.bigint();
    const requestId = req.requestId;
    res.on("finish", () => {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationMs = +(durationNs / 1_000_000).toFixed(2);
        const level = res.statusCode >= 500
            ? "error"
            : res.statusCode >= 400
                ? "warn"
                : "info";
        logger_1.default.log(level, "request", {
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs,
            userAgent: req.headers["user-agent"],
            ip: req.ip,
        });
    });
    next();
};
exports.requestLoggerMiddleware = requestLoggerMiddleware;
