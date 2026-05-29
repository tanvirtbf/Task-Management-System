import { verify, type JwtPayload } from "jsonwebtoken";
import type { Logger } from "winston";
import { MySql2Database } from "drizzle-orm/mysql2";
import { Config } from "../config";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { fakeId, sha256 } from "../utils";
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

export interface RefreshInput {
    refreshCookie?: string;
    userAgent?: string;
    ipAddress?: string;
}

// One canonical message for every refresh failure path. Sharing the wording
// across "missing cookie", "bad signature", "session revoked", etc. denies
// the client a discrimination oracle.
const REFRESH_FAIL_MESSAGE = "Refresh token is invalid or expired";

const invalidRefresh = () =>
    AppError.unauthorized("auth.invalid_refresh", REFRESH_FAIL_MESSAGE);

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

    /**
     * Rotate a refresh-token session. Reads the `bb_refresh` cookie value,
     * verifies it cryptographically, checks the backing `sessions` row, and
     * atomically issues a new pair (access + refresh) while revoking the
     * old session row.
     *
     * Reuse detection: if the presented cookie corresponds to a session that
     * is already revoked — or whose `token_hash` no longer matches — every
     * active session for that user is revoked. The textbook RTR algorithm:
     * a replayed refresh token is strong evidence of theft.
     *
     * Every failure path emits the same `auth.invalid_refresh` envelope so
     * the client cannot tell which check failed.
     */
    async refresh(input: RefreshInput): Promise<LoginResult> {
        const cookie = input.refreshCookie;
        if (!cookie) {
            throw invalidRefresh();
        }

        if (!Config.REFRESH_TOKEN_SECRET) {
            // A misconfigured server is a 5xx, not a client problem.
            throw AppError.internal("Refresh token secret not configured");
        }

        // Verify signature + expiry. Algorithm whitelist denies `alg:none` and
        // RS/HS confusion attacks.
        let payload: JwtPayload;
        try {
            const decoded = verify(cookie, Config.REFRESH_TOKEN_SECRET, {
                algorithms: ["HS256"],
            });
            if (typeof decoded === "string") throw invalidRefresh();
            payload = decoded;
        } catch (err) {
            // jsonwebtoken throws JsonWebTokenError, TokenExpiredError, etc.
            // Re-emit as our generic invalid-refresh envelope unless it was
            // already one of our AppErrors (e.g. the misconfig above).
            if (err instanceof AppError) throw err;
            throw invalidRefresh();
        }

        const sessionId =
            typeof payload.jti === "string" && payload.jti.length > 0
                ? payload.jti
                : typeof payload.id === "string" && payload.id.length > 0
                  ? payload.id
                  : null;
        if (!sessionId) {
            throw invalidRefresh();
        }

        const session = await this.tokens.findSessionAny(sessionId);
        if (!session) {
            throw invalidRefresh();
        }

        if (session.revokedAt) {
            // Reuse of an already-revoked token → treat as theft.
            this.logger.warn("auth.refresh.reuse_detected", {
                userId: session.userId,
                sessionId,
            });
            await this.tokens.revokeAllForUser(session.userId);
            throw invalidRefresh();
        }

        if (session.expiresAt.getTime() < Date.now()) {
            // Natural expiry — no mass revoke. The hourly cleanup job will
            // hard-delete the row eventually.
            throw invalidRefresh();
        }

        if (session.tokenHash !== sha256(cookie)) {
            // Signature was valid but the persisted hash differs. Either the
            // row was tampered with or the secret rotation produced a JWT we
            // shouldn't honour. Treat conservatively as theft.
            this.logger.warn("auth.refresh.hash_mismatch", {
                userId: session.userId,
                sessionId,
            });
            await this.tokens.revokeAllForUser(session.userId);
            throw invalidRefresh();
        }

        const user = await this.users.findById(session.userId);
        if (!user) {
            throw invalidRefresh();
        }
        if (user.status !== "active") {
            // The deactivate / invite paths own the mass-revoke; refresh just
            // refuses to mint new tokens.
            throw invalidRefresh();
        }

        // Fresh claims from the users row — never trust the cookie's role /
        // workspaceId. A demoted member who still has a valid cookie gets a
        // member-scoped access token after refresh, not the admin one.
        const newSessionId = fakeId("ses");
        const newPayload: JwtPayload = {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
        };
        const accessToken = this.tokens.generateAccessToken(newPayload);
        const refreshToken = this.tokens.generateRefreshToken({
            ...newPayload,
            id: newSessionId,
        });

        await this.tokens.rotateSession({
            oldSessionId: sessionId,
            newSessionId,
            userId: user.id,
            refreshToken,
            userAgent: input.userAgent,
            ipAddress: input.ipAddress,
        });

        return { user, accessToken, refreshToken, sessionId: newSessionId };
    }
}
