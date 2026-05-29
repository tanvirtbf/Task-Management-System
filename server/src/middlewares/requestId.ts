import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Request-ID middleware. Per API_DESIGN.md §1 — the server reads the
 * `X-Request-Id` header from the client (if provided), or generates a fresh
 * UUID v4. The id is attached to `req.requestId`, echoed on the response,
 * and is the same value the error envelope returns under `error.request_id`.
 *
 * Keep this middleware FIRST in the chain so every later middleware
 * (auth, validators, error handler, logger) can read the id.
 */

declare module "express-serve-static-core" {
    interface Request {
        requestId: string;
    }
}

const REQUEST_ID_HEADER = "x-request-id";
const MAX_INCOMING_ID_LENGTH = 200;

export const requestIdMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id =
        incoming && incoming.length > 0 && incoming.length <= MAX_INCOMING_ID_LENGTH
            ? incoming
            : `req_${randomUUID()}`;

    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
};
