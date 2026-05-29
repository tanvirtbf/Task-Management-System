import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";

/**
 * Catch-all 404 — placed AFTER every route and BEFORE the error handler.
 * Per API_DESIGN.md §1 the response body still follows the standard error
 * envelope.
 */

export const notFoundMiddleware = (
    req: Request,
    _res: Response,
    next: NextFunction,
) => {
    next(
        AppError.notFound(
            "route.not_found",
            `No route for ${req.method} ${req.originalUrl}`,
        ),
    );
};
