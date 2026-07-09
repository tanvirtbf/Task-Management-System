import { Request } from "express";
import type { Role } from "../constants";

/**
 * Framework-level shared types only. Endpoint-specific request bodies and
 * domain entity shapes live alongside the controller / service that owns
 * them, not in this file.
 *
 * Anything you put here should be referenced from middlewares or
 * cross-cutting concerns — not from a single feature's code path.
 */

/**
 * Decorated `Request` after the `authenticate` middleware runs. The JWT
 * payload is attached at `req.auth` and carries the user's id, role and
 * the workspace they belong to.
 */
export interface AuthRequest extends Request {
    auth: {
        sub: string; // user id (VARCHAR(64))
        role: Role;
        workspaceId: string;
        id?: string; // session id, present only when a refresh token was used
    };
}

/**
 * Cookie shape set / read by the auth flow. Both names match what we emit
 * from `AuthController`-style controllers.
 */
export type AuthCookie = {
    accessToken: string;
    refreshToken: string;
};

/**
 * Payload embedded in the refresh JWT. `id` is the `sessions.id` row that
 * the refresh token is bound to — looked up by `validateRefreshToken` to
 * confirm the session is still active.
 */
export interface IRefreshTokenPayload {
    id: string;
}
