import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { AuthService } from "../services/AuthService";
import type { LoginRequest, RefreshRequest } from "../types/auth";
import type { UserRecord } from "../repositories/UsersRepo";

/**
 * §2 Authentication HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

// Token + cookie settings — derived from API_DESIGN.md §2 + §1 Conventions.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 min, matches TokenService
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_COOKIE_NAME = "bb_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

/**
 * Wire-format `User` per API_DESIGN.md Appendix A. snake_case fields, never
 * leak `password_hash`, `workspace_id`, or `updated_at`.
 */
interface WireUser {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: UserRecord["role"];
    avatar_url: string | null;
    status: UserRecord["status"];
    timezone: string;
    created_at: string;
    last_login_at: string | null;
}

const toWireUser = (u: UserRecord): WireUser => ({
    id: u.id,
    first_name: u.firstName,
    last_name: u.lastName,
    email: u.email,
    role: u.role,
    avatar_url: u.avatarUrl,
    status: u.status,
    timezone: u.timezone,
    created_at: u.createdAt.toISOString(),
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
});

export class AuthController {
    constructor(
        private authService: AuthService,
        private logger: Logger,
    ) {}

    async login(req: LoginRequest, res: Response, next: NextFunction) {
        try {
            const { email, password } = req.body;

            this.logger.debug("auth.login.attempt", {
                requestId: req.requestId,
                email,
            });

            const result = await this.authService.login({
                email,
                password,
                userAgent: req.headers["user-agent"],
                ipAddress: req.ip,
            });

            this.setRefreshCookie(res, result.refreshToken);

            this.logger.info("auth.login.ok", {
                requestId: req.requestId,
                userId: result.user.id,
            });

            res.status(200).json({
                access_token: result.accessToken,
                expires_in: ACCESS_TOKEN_TTL_SECONDS,
                user: toWireUser(result.user),
            });
        } catch (err) {
            next(err);
        }
    }

    async refresh(req: RefreshRequest, res: Response, next: NextFunction) {
        try {
            const rawCookie: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
            const cookie =
                typeof rawCookie === "string" ? rawCookie : undefined;

            this.logger.debug("auth.refresh.attempt", {
                requestId: req.requestId,
                hasCookie: Boolean(cookie),
            });

            const result = await this.authService.refresh({
                refreshCookie: cookie,
                userAgent: req.headers["user-agent"],
                ipAddress: req.ip,
            });

            this.setRefreshCookie(res, result.refreshToken);

            this.logger.info("auth.refresh.ok", {
                requestId: req.requestId,
                userId: result.user.id,
                sessionId: result.sessionId,
            });

            res.status(200).json({
                access_token: result.accessToken,
                expires_in: ACCESS_TOKEN_TTL_SECONDS,
                user: toWireUser(result.user),
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Set the `bb_refresh` cookie with the attributes mandated by
     * API_DESIGN.md §2. Shared by login and refresh so the contract stays in
     * exactly one place.
     */
    private setRefreshCookie(res: Response, refreshToken: string) {
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "prod",
            sameSite: "strict",
            path: REFRESH_COOKIE_PATH,
            maxAge: REFRESH_COOKIE_MAX_AGE_MS,
        });
    }
}
