import type { JwtPayload } from "jsonwebtoken";
import type { Logger } from "winston";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { fakeId } from "../utils";
import { TokenService } from "./TokenService";
import { CredentialService } from "./CredentialService";
import { UsersRepo, type UserRecord } from "../repositories/UsersRepo";

export interface LoginInput {
    email: string;
    password: string;
    userAgent?: string;
    ipAddress?: string;
}

export interface LoginResult {
    user: UserRecord;
    accessToken: string;
    refreshToken: string;
    sessionId: string;
}

export class AuthService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private tokens: TokenService,
        private creds: CredentialService,
        private users: UsersRepo,
        private logger: Logger,
    ) {}

    /**
     * Verify an email/password pair and return tokens. The caller is
     * responsible for setting the refresh cookie on the HTTP response.
     *
     * Every failure path emits the same `auth.invalid_credentials` error so
     * the client cannot tell whether the email is registered, whether the
     * account is active, or whether the password is wrong.
     */
    async login(input: LoginInput): Promise<LoginResult> {
        const user = await this.users.findByEmail(input.email);

        if (!user) {
            // Anti-timing: run a dummy bcrypt compare so the wall-clock time
            // matches the wrong-password branch. Closes the email enumeration
            // oracle.
            await this.creds.dummyCompare(input.password);
            throw AppError.unauthorized(
                "auth.invalid_credentials",
                "Email or password does not match",
            );
        }

        if (user.status !== "active") {
            // Same generic error — never reveal account state. (No bcrypt run
            // here: discovering "invited vs deactivated vs not-found" is not a
            // meaningful threat once the email is already known to exist.)
            throw AppError.unauthorized(
                "auth.invalid_credentials",
                "Email or password does not match",
            );
        }

        const ok = await this.creds.comparePassword(
            input.password,
            user.passwordHash,
        );
        if (!ok) {
            throw AppError.unauthorized(
                "auth.invalid_credentials",
                "Email or password does not match",
            );
        }

        // Generate the session id up front so the refresh JWT can embed it
        // BEFORE the row is inserted. The persisted `token_hash` matches the
        // final cookie value, not a stand-in.
        const sessionId = fakeId("ses");
        const payload: JwtPayload = {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
        };
        const accessToken = this.tokens.generateAccessToken(payload);
        const refreshToken = this.tokens.generateRefreshToken({
            ...payload,
            id: sessionId,
        });

        await this.tokens.persistSession({
            id: sessionId,
            userId: user.id,
            refreshToken,
            userAgent: input.userAgent,
            ipAddress: input.ipAddress,
        });

        // Fire-and-forget last-login update — never block login on this.
        void this.users.touchLastLogin(user.id).catch((err: unknown) => {
            this.logger.warn("auth.touch_last_login.failed", {
                userId: user.id,
                error: err instanceof Error ? err.message : String(err),
            });
        });

        return { user, accessToken, refreshToken, sessionId };
    }
}
