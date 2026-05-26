import { NextFunction, Request, Response } from "express";
import { validationResult } from "express-validator";
import createHttpError from "http-errors";
import { AuthService } from "../services/authService";
import { Config } from "../config";
import { AuthRequest, LoginBody, RegisterBody } from "../types/authTypes";
import { UserService } from "../services/userService";

const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: Config.NODE_ENV === "prod",
};

const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 1000;

export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
    ) {}

    register = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const user = await this.authService.register(req.body as RegisterBody);

            res.status(201).json({
                data: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                },
            });
        } catch (err) {
            next(err);
        }
    };

    login = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { user, accessToken, refreshToken } = await this.authService.login(
                req.body as LoginBody,
                { user_agent: req.get("user-agent") ?? undefined, ip_address: req.ip },
            );

            res.cookie("accessToken", accessToken, {
                ...cookieOptions,
                maxAge: ACCESS_COOKIE_MAX_AGE,
            });
            res.cookie("refreshToken", refreshToken, {
                ...cookieOptions,
                maxAge: Config.REFRESH_TOKEN_TTL_MS,
            });

            res.json({
                data: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                },
            });
        } catch (err) {
            next(err);
        }
    };

    refresh = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const oldToken = req.cookies?.refreshToken as string | undefined;
            if (!oldToken) {
                throw createHttpError(401, "Missing refresh token");
            }

            const { accessToken, refreshToken } = await this.authService.refresh(oldToken, {
                user_agent: req.get("user-agent") ?? undefined,
                ip_address: req.ip,
            });

            res.cookie("accessToken", accessToken, {
                ...cookieOptions,
                maxAge: ACCESS_COOKIE_MAX_AGE,
            });
            res.cookie("refreshToken", refreshToken, {
                ...cookieOptions,
                maxAge: Config.REFRESH_TOKEN_TTL_MS,
            });

            res.json({ data: { success: true } });
        } catch (err) {
            next(err);
        }
    };

    logout = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const refreshToken = req.cookies?.refreshToken as string | undefined;
            await this.authService.logout(refreshToken);

            res.clearCookie("accessToken", cookieOptions);
            res.clearCookie("refreshToken", cookieOptions);
            res.json({ data: { success: true } });
        } catch (err) {
            next(err);
        }
    };

    me = async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.auth?.sub);
            const user = await this.userService.findById(userId);
            if (!user) throw createHttpError(404, "User not found");

            res.json({
                data: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    avatar_url: user.avatar_url,
                    role: user.role,
                    is_active: user.is_active,
                    last_login_at: user.last_login_at,
                },
            });
        } catch (err) {
            next(err);
        }
    };
}
