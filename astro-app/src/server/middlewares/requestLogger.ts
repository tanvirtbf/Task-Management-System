import type { NextFunction, Request, Response } from "express";
import logger from "../config/logger";

/**
 * Structured per-request logger. Emits one JSON line per request when the
 * response finishes, with method, route, status, duration, and request_id.
 *
 * Place AFTER `requestIdMiddleware` so `req.requestId` is populated.
 */

export const requestLoggerMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
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

        logger.log(level, "request", {
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
