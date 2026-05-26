import createHttpError from "http-errors";
import { CredentialService } from "./credentialService";
import { TokenService } from "./tokenService";
import { UserService } from "./userService";
import { AuthPayload, LoginBody, RegisterBody } from "../types/authTypes";

export class AuthService {
    constructor(
        private readonly userService: UserService,
        private readonly credentialService: CredentialService,
        private readonly tokenService: TokenService,
    ) {}

    async register(body: RegisterBody) {
        const existing = await this.userService.findByEmail(body.email);
        if (existing) {
            throw createHttpError(409, "Email already registered");
        }

        const password_hash = await this.credentialService.hashPassword(body.password);
        const user = await this.userService.create({
            email: body.email,
            password_hash,
            first_name: body.first_name,
            last_name: body.last_name,
        });

        if (!user) {
            throw createHttpError(500, "Failed to create user");
        }

        return user;
    }

    async login(body: LoginBody, metadata: { user_agent?: string; ip_address?: string }) {
        const user = await this.userService.findByEmail(body.email);
        if (!user || !user.is_active) {
            throw createHttpError(401, "Invalid email or password");
        }

        const ok = await this.credentialService.comparePassword(body.password, user.password_hash);
        if (!ok) {
            throw createHttpError(401, "Invalid email or password");
        }

        const payload: AuthPayload = {
            sub: String(user.id),
            role: user.role,
            email: user.email,
        };

        const accessToken = this.tokenService.generateAccessToken(payload);
        const refreshToken = this.tokenService.generateRefreshToken(payload);

        await this.tokenService.persistRefreshToken(user.id, refreshToken, metadata);
        await this.userService.updateLastLogin(user.id);

        return { user, accessToken, refreshToken };
    }

    async refresh(oldToken: string, metadata: { user_agent?: string; ip_address?: string }) {
        const valid = await this.tokenService.isRefreshTokenValid(oldToken);
        if (!valid) {
            throw createHttpError(401, "Invalid refresh token");
        }

        const decoded = this.tokenService.verifyToken(oldToken);
        const userId = Number(decoded.sub);
        const user = await this.userService.findById(userId);

        if (!user || !user.is_active) {
            throw createHttpError(401, "User no longer active");
        }

        const payload: AuthPayload = {
            sub: String(user.id),
            role: user.role,
            email: user.email,
        };

        await this.tokenService.revokeRefreshToken(oldToken);

        const accessToken = this.tokenService.generateAccessToken(payload);
        const refreshToken = this.tokenService.generateRefreshToken(payload);
        await this.tokenService.persistRefreshToken(user.id, refreshToken, metadata);

        return { user, accessToken, refreshToken };
    }

    async logout(refreshToken: string | undefined) {
        if (refreshToken) {
            await this.tokenService.revokeRefreshToken(refreshToken);
        }
    }
}
