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

/**
 * The refresh endpoint takes no body fields — the `bb_refresh` cookie is the
 * sole input. Aliased to `Request` for typing parallelism with `LoginRequest`
 * so future readers see the intentional empty body.
 */
export type RefreshRequest = Request;
