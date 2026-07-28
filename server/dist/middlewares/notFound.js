"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundMiddleware = void 0;
const errors_1 = require("../errors");
/**
 * Catch-all 404 — placed AFTER every route and BEFORE the error handler.
 * Per API_DESIGN.md §1 the response body still follows the standard error
 * envelope.
 */
const notFoundMiddleware = (req, _res, next) => {
    next(errors_1.AppError.notFound("route.not_found", `No route for ${req.method} ${req.originalUrl}`));
};
exports.notFoundMiddleware = notFoundMiddleware;
