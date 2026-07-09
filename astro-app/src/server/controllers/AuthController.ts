import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { AuthService } from "../services/AuthService";
import type { AuthRequest } from "../types";
import type {
    AcceptInvitationRequest,
    ForgotPasswordRequest,
    GetInvitationRequest,
    LoginRequest,
    LogoutAllRequest,
    LogoutRequest,
    MeRequest,
    RefreshRequest,
    ResetPasswordRequest,
} from "../types/auth";
import { toWireUser } from "../serializers/userSerializer";

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

    async forgotPassword(
        req: ForgotPasswordRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { email } = req.body;

            this.logger.debug("auth.forgot_password.attempt", {
                requestId: req.requestId,
                email,
            });

            await this.authService.forgotPassword({ email });

            // Always 202 with an empty body — never reveal whether the email is
            // registered (API_DESIGN.md §2 enumeration protection).
            res.status(202).json({});
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

    async logout(req: LogoutRequest, res: Response, next: NextFunction) {
        try {
            const sessionId =
                typeof req.auth?.id === "string" && req.auth.id.length > 0
                    ? req.auth.id
                    : undefined;

            await this.authService.logout({ sessionId });

            this.clearRefreshCookie(res);

            this.logger.info("auth.logout.ok", {
                requestId: req.requestId,
                userId: req.auth?.sub,
                sessionId: sessionId ?? null,
            });

            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    async logoutAll(req: LogoutAllRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.auth?.sub;

            await this.authService.logoutAll({ userId });

            this.clearRefreshCookie(res);

            this.logger.info("auth.logout_all.ok", {
                requestId: req.requestId,
                userId,
            });

            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    async resetPassword(
        req: ResetPasswordRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { token, new_password } = req.body;

            // Log the attempt with NO sensitive material — never the token or
            // the password. `requestId` alone correlates with the access log.
            this.logger.debug("auth.reset_password.attempt", {
                requestId: req.requestId,
            });

            await this.authService.resetPassword({
                token,
                newPassword: new_password,
            });

            this.logger.info("auth.reset_password.ok", {
                requestId: req.requestId,
            });

            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    async changePassword(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { current_password, new_password } = req.body as {
                current_password: string;
                new_password: string;
            };

            await this.authService.changePassword({
                userId: req.auth.sub,
                currentPassword: current_password,
                newPassword: new_password,
            });

            this.logger.info("auth.change_password.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
            });

            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    async me(req: MeRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.auth.sub;

            this.logger.debug("auth.me.attempt", {
                requestId: req.requestId,
                userId,
            });

            const user = await this.authService.me(userId);

            this.logger.info("auth.me.ok", {
                requestId: req.requestId,
                userId,
            });

            res.status(200).json(toWireUser(user));
        } catch (err) {
            next(err);
        }
    }

    async getInvitation(
        req: GetInvitationRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const detail = await this.authService.getInvitation(
                req.params.token,
            );
            res.status(200).json({
                email: detail.email,
                role: detail.role,
                workspace_name: detail.workspaceName,
            });
        } catch (err) {
            next(err);
        }
    }

    async acceptInvitation(
        req: AcceptInvitationRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { token, password } = req.body;

            const result = await this.authService.acceptInvitation({
                token,
                password,
                userAgent: req.headers["user-agent"],
                ipAddress: req.ip,
            });

            this.setRefreshCookie(res, result.refreshToken);

            this.logger.info("auth.accept_invitation.ok", {
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

    /**
     * Set the `bb_refresh` cookie with the attributes mandated by
     * API_DESIGN.md §2. Shared by login and refresh so the contract stays in
     * exactly one place.
     */
    private setRefreshCookie(res: Response, refreshToken: string) {
        const isSecure = process.env.NODE_ENV === "prod" || process.env.FORCE_SECURE === "true";
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
            httpOnly: true,
            secure: isSecure,
            sameSite: "strict",
            path: REFRESH_COOKIE_PATH,
            maxAge: REFRESH_COOKIE_MAX_AGE_MS,
        });
    }

    /**
     * Clear the `bb_refresh` cookie. The attributes here MUST match the set
     * attributes (especially `Path`) or the browser will keep the cookie.
     */
    private clearRefreshCookie(res: Response) {
        const isSecure = process.env.NODE_ENV === "prod" || process.env.FORCE_SECURE === "true";
        res.clearCookie(REFRESH_COOKIE_NAME, {
            httpOnly: true,
            secure: isSecure,
            sameSite: "strict",
            path: REFRESH_COOKIE_PATH,
        });
    }
}
