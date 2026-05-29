import { NextFunction, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { Logger } from "winston";

import { AuthRequest, LoginRequest, RegisterUserRequest } from "../types";
import { UserService } from "../services/UserService";
import { TokenService } from "../services/TokenService";
import { CredentialService } from "../services/CredentialService";
import { AppError } from "../errors";
import { Roles } from "../constants";

export class AuthController {
    constructor(
        private userService: UserService,
        private logger: Logger,
        private tokenService: TokenService,
        private credentialService: CredentialService,
    ) {}

    async register(
        req: RegisterUserRequest,
        res: Response,
        next: NextFunction,
    ) {
        const { firstName, lastName, email, password, workspaceId } = req.body;

        this.logger.debug("auth.register", {
            requestId: req.requestId,
            firstName,
            lastName,
            email,
        });

        if (!workspaceId) {
            return next(
                AppError.badRequest(
                    "workspace.required",
                    "workspaceId is required for registration",
                ),
            );
        }

        try {
            const user = await this.userService.create({
                firstName,
                lastName,
                email,
                password,
                role: Roles.MEMBER,
                workspaceId,
            });
            if (!user) {
                return next(AppError.internal("User creation failed"));
            }
            this.logger.info("auth.register.ok", {
                requestId: req.requestId,
                userId: user.id,
            });

            await this.issueTokens(res, {
                userId: user.id,
                role: user.role,
                workspaceId: user.workspaceId,
                userAgent: req.headers["user-agent"],
                ipAddress: req.ip,
            });

            res.status(201).json({ id: user.id });
        } catch (err) {
            next(err);
        }
    }

    async login(req: LoginRequest, res: Response, next: NextFunction) {
        const { email, password } = req.body;

        this.logger.debug("auth.login", { requestId: req.requestId, email });

        try {
            const user = await this.userService.findByEmailWithPassword(email);
            if (!user) {
                return next(
                    AppError.badRequest(
                        "auth.invalid_credentials",
                        "Email or password does not match",
                    ),
                );
            }

            const passwordMatch = await this.credentialService.comparePassword(
                password,
                user.passwordHash,
            );
            if (!passwordMatch) {
                return next(
                    AppError.badRequest(
                        "auth.invalid_credentials",
                        "Email or password does not match",
                    ),
                );
            }

            await this.issueTokens(res, {
                userId: user.id,
                role: user.role,
                workspaceId: user.workspaceId,
                userAgent: req.headers["user-agent"],
                ipAddress: req.ip,
            });

            void this.userService.touchLastLogin(user.id).catch((err) => {
                this.logger.warn("auth.touch_last_login.fail", {
                    requestId: req.requestId,
                    error: err instanceof Error ? err.message : err,
                });
            });

            this.logger.info("auth.login.ok", {
                requestId: req.requestId,
                userId: user.id,
            });
            res.json({ id: user.id });
        } catch (err) {
            next(err);
        }
    }

    async self(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = await this.userService.findById(req.auth.sub);
            if (!user) {
                return next(AppError.notFound("user.not_found", "User not found"));
            }
            res.json(user);
        } catch (err) {
            next(err);
        }
    }

    async refresh(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = await this.userService.findById(req.auth.sub);
            if (!user) {
                return next(
                    AppError.unauthorized(
                        "auth.user_missing",
                        "User with the token could not be found",
                    ),
                );
            }

            // Rotate: revoke old session, issue new tokens with a fresh session row
            if (req.auth.id) {
                await this.tokenService.revokeSession(req.auth.id);
            }

            await this.issueTokens(res, {
                userId: user.id,
                role: user.role,
                workspaceId: user.workspaceId,
                userAgent: req.headers["user-agent"],
                ipAddress: req.ip,
            });

            this.logger.info("auth.refresh.ok", {
                requestId: req.requestId,
                userId: user.id,
            });
            res.json({ id: user.id });
        } catch (err) {
            next(err);
        }
    }

    async logout(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (req.auth.id) {
                await this.tokenService.revokeSession(req.auth.id);
                this.logger.info("auth.logout.session_revoked", {
                    requestId: req.requestId,
                    sessionId: req.auth.id,
                });
            }
            this.logger.info("auth.logout.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
            });

            res.clearCookie("accessToken");
            res.clearCookie("refreshToken");
            res.json({});
        } catch (err) {
            next(err);
        }
    }

    // ─── internal helpers ──────────────────────────────────────────────────
    private async issueTokens(
        res: Response,
        input: {
            userId: string;
            role: string;
            workspaceId: string;
            userAgent?: string;
            ipAddress?: string;
        },
    ) {
        const accessPayload: JwtPayload = {
            sub: input.userId,
            role: input.role,
            workspaceId: input.workspaceId,
        };
        const accessToken = this.tokenService.generateAccessToken(accessPayload);

        const tempToken = this.tokenService.generateRefreshToken({
            ...accessPayload,
            id: "pending",
        });
        const session = await this.tokenService.persistSession({
            userId: input.userId,
            refreshToken: tempToken,
            userAgent: input.userAgent,
            ipAddress: input.ipAddress,
        });

        const refreshToken = this.tokenService.generateRefreshToken({
            ...accessPayload,
            id: session.id,
        });

        res.cookie("accessToken", accessToken, {
            sameSite: "strict",
            maxAge: 1000 * 60 * 15, // 15 min
            httpOnly: true,
            secure: process.env.NODE_ENV === "prod",
        });
        res.cookie("refreshToken", refreshToken, {
            sameSite: "strict",
            maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
            httpOnly: true,
            secure: process.env.NODE_ENV === "prod",
        });
    }
}
