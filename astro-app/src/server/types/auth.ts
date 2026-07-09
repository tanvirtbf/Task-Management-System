import type { Request } from "express";
import type { AuthRequest } from "./index";

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

export interface ResetPasswordRequestBody {
    token: string;
    new_password: string;
}

/** `POST /api/v1/auth/reset-password` — public; the token is the credential. */
export interface ResetPasswordRequest extends Request {
    body: ResetPasswordRequestBody;
}

export interface ForgotPasswordRequestBody {
    email: string;
}

/** `POST /api/v1/auth/forgot-password` — public; only the email is read. */
export interface ForgotPasswordRequest extends Request {
    body: ForgotPasswordRequestBody;
}

/**
 * The refresh endpoint takes no body fields — the `bb_refresh` cookie is the
 * sole input. Aliased to `Request` for typing parallelism with `LoginRequest`
 * so future readers see the intentional empty body.
 */
export type RefreshRequest = Request;

/**
 * The logout endpoint takes no body fields. Identity is established by the
 * `authenticate` middleware, which decorates the request with `req.auth`
 * carrying the session id to revoke.
 */
export type LogoutRequest = AuthRequest;

/**
 * The logout-all endpoint takes no body fields. Identity is established by
 * the `authenticate` middleware; only `req.auth.sub` is needed to scope the
 * mass-revoke to the calling user.
 */
export type LogoutAllRequest = AuthRequest;

/**
 * The whoami endpoint takes no body / path / query input — identity is
 * established by the `authenticate` middleware via `req.auth.sub`. Aliased to
 * `AuthRequest` for typing parallelism with the other §2 request shapes.
 */
export type MeRequest = AuthRequest;

export interface AcceptInvitationRequestBody {
    token: string;
    password: string;
}

/** `POST /api/v1/auth/accept-invitation` — public; the token is the credential. */
export interface AcceptInvitationRequest extends Request {
    body: AcceptInvitationRequestBody;
}

/** `GET /api/v1/auth/invitation/:token` — public; the path token is the input. */
export type GetInvitationRequest = Request;
