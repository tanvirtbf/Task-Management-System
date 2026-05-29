import type { Request } from "express";

/**
 * Endpoint-specific request body shapes for §2 Authentication.
 *
 * Per the project convention these live alongside the feature, not in
 * `types/index.ts` (which is reserved for framework-level types such as
 * `AuthRequest`, `AuthCookie`, `IRefreshTokenPayload`).
 */

export interface LoginRequestBody {
    email: string;
    password: string;
}

export interface LoginRequest extends Request {
    body: LoginRequestBody;
}
