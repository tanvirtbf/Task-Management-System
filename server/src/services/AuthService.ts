import { verify, type JwtPayload } from "jsonwebtoken";
import type { Logger } from "winston";
import { MySql2Database } from "drizzle-orm/mysql2";
import { Config } from "../config";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { fakeId, randomToken, sha256 } from "../utils";
import { TokenService } from "./TokenService";
import { CredentialService } from "./CredentialService";
import { UsersRepo, type UserRecord } from "../repositories/UsersRepo";
import { PasswordResetTokensRepo } from "../repositories/PasswordResetTokensRepo";
import { InvitationsRepo } from "../repositories/InvitationsRepo";
import { MailService } from "./MailService";

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

export interface ResetPasswordInput {
    /** The raw reset token from the request body (hashed before lookup). */
    token: string;
    /** The new plaintext password (validated 8-200 chars upstream). */
    newPassword: string;
}

export interface ChangePasswordInput {
    /** The authenticated user (verified JWT `sub` — never client input). */
    userId: string;
    /** The caller's current password, re-verified before any write. */
    currentPassword: string;
    /** The replacement password (validated 8-200 chars upstream). */
    newPassword: string;
}

// One canonical message for every refresh failure path. Sharing the wording
// across "missing cookie", "bad signature", "session revoked", etc. denies
// the client a discrimination oracle.
const REFRESH_FAIL_MESSAGE = "Refresh token is invalid or expired";

const invalidRefresh = () =>
    AppError.unauthorized("auth.invalid_refresh", REFRESH_FAIL_MESSAGE);

// Password-reset tokens are short-lived per database/schema.sql §4 ("≤ 30 min").
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** mysql2 transient lock errors worth retrying a transaction on. */
const isRetryableTxError = (err: unknown): boolean => {
    const e = err as { errno?: number } | null;
    return e?.errno === 1213 || e?.errno === 1205; // ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT
};

// A forgot-password DELETE+INSERT pair can deadlock under concurrent requests
// for the same user — bound the retry the same way OnCallService does.
const MAX_FORGOT_TX_ATTEMPTS = 3;

export class AuthService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private tokens: TokenService,
        private creds: CredentialService,
        private users: UsersRepo,
        private resetTokens: PasswordResetTokensRepo,
        private invitations: InvitationsRepo,
        private mailer: MailService,
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

        // Generate the session id up front so BOTH the refresh JWT and the
        // access JWT can embed it. The access token's `id` claim is what
        // `/auth/logout` reads from `req.auth.id` to know which session to
        // revoke; the refresh token's `jti` is what `/auth/refresh` reads to
        // do the same. The persisted `token_hash` matches the final cookie
        // value, not a stand-in.
        const sessionId = fakeId("ses");
        const payload: JwtPayload = {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
        };
        const accessToken = this.tokens.generateAccessToken({
            ...payload,
            id: sessionId,
        });
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
        // member-scoped access token after refresh, not the admin one. The
        // new `id` claim binds the access token to the new session row so
        // `/auth/logout` can revoke exactly the right session.
        const newSessionId = fakeId("ses");
        const newPayload: JwtPayload = {
            sub: user.id,
            role: user.role,
            workspaceId: user.workspaceId,
        };
        const accessToken = this.tokens.generateAccessToken({
            ...newPayload,
            id: newSessionId,
        });
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

    /**
     * Revoke the session bound to the calling access token. Idempotent: a
     * row that is already revoked is silently re-stamped with `revoked_at =
     * NOW()`, and a missing `sessionId` is a no-op (still 204 upstream).
     *
     * The access token itself stays valid until its 15-minute natural
     * expiry — per API_DESIGN.md §2 logout does NOT revoke the access
     * token, only the refresh session it was minted from.
     */
    async logout(input: { sessionId?: string }): Promise<void> {
        if (input.sessionId) {
            await this.tokens.revokeSession(input.sessionId);
        }
    }

    /**
     * Revoke every active session for the user (sign out all devices). The
     * filter inside `revokeAllForUser` skips already-revoked rows, so the
     * call is idempotent and a user with zero active sessions still resolves
     * cleanly. Per API_DESIGN.md §2 the calling access token is NOT
     * invalidated — it expires naturally within 15 minutes.
     */
    async logoutAll(input: { userId: string }): Promise<void> {
        await this.tokens.revokeAllForUser(input.userId);
    }

    /**
     * Consume a one-time password-reset token and set the user's new password,
     * revoking every active session for that user (API_DESIGN.md §2). The token
     * is the capability — the `user_id` comes from the token row, never client
     * input, so there is no IDOR surface.
     *
     * Single generic failure (`auth.reset_token_invalid`) for missing / expired
     * / already-consumed tokens — the client cannot distinguish them, denying a
     * token-validity oracle. The bcrypt hash is computed BEFORE the transaction
     * (so the ~100 ms work never holds the row lock) and is run even when the
     * token turns out invalid, keeping the wall-clock time uniform.
     *
     * The password update, token consume, and session revoke run in one
     * transaction: all-or-nothing. The `FOR UPDATE` lock on the token row makes
     * the "unconsumed?" check race-free, so a concurrent replay of the same
     * token writes nothing and fails.
     */
    async resetPassword(input: ResetPasswordInput): Promise<void> {
        const tokenHash = sha256(input.token);
        const passwordHash = await this.creds.hashPassword(input.newPassword);

        await this.db.transaction(async (tx) => {
            const row = await this.resetTokens.findByTokenHashForUpdate(
                tokenHash,
                tx,
            );
            if (
                !row ||
                row.consumedAt !== null ||
                row.expiresAt.getTime() <= Date.now()
            ) {
                throw AppError.badRequest(
                    "auth.reset_token_invalid",
                    "This password reset link is invalid or has expired",
                );
            }

            await this.users.updatePassword(row.userId, passwordHash, tx);
            await this.resetTokens.markConsumed(row.id, tx);
            await this.tokens.revokeAllForUser(row.userId, tx);
        });
    }

    /**
     * Change the authenticated user's password. The CURRENT password is
     * re-verified first, so a stolen ≤15-min access token alone cannot rotate
     * the credential. On success EVERY refresh session is revoked (F10 /
     * ISS-015 — mirroring the reset path; the old "leave sessions intact" V1
     * choice meant a password change did not evict whoever prompted it).
     * `userId` is the verified JWT `sub`, never client input, so there is no
     * IDOR surface.
     */
    async changePassword(input: ChangePasswordInput): Promise<void> {
        const user = await this.users.findById(input.userId);
        if (!user) {
            throw AppError.notFound(
                "user.not_found",
                `User ${input.userId} does not exist`,
            );
        }
        const ok = await this.creds.comparePassword(
            input.currentPassword,
            user.passwordHash,
        );
        if (!ok) {
            throw AppError.unprocessable(
                "auth.incorrect_password",
                "Your current password is incorrect",
            );
        }
        if (input.currentPassword === input.newPassword) {
            throw AppError.unprocessable(
                "auth.password_unchanged",
                "The new password must be different from your current one",
            );
        }
        const passwordHash = await this.creds.hashPassword(input.newPassword);
        await this.users.updatePassword(input.userId, passwordHash);
        // F10 (ISS-015): rotating the credential revokes every refresh session,
        // exactly as the reset path always has — the two password paths agreed
        // on everything except this, and the more common one was the unsafe
        // one. The caller's own device keeps its ≤15-min access token and then
        // signs in again with the new password (same UX as reset).
        await this.tokens.revokeAllForUser(input.userId);
    }

    /**
     * Resolve the authenticated principal to a fresh `users` row. Identity is
     * the verified JWT `sub` claim (never client input), so a caller can only
     * ever read themselves — there is no IDOR surface.
     *
     * Returns the live row, so the response reflects the user's CURRENT role
     * and status even when the access token's claims are stale. A
     * `deactivated` user holding a still-valid access token is returned as-is
     * (200): deactivation revokes refresh tokens, not the ≤15-min access
     * token, and reads do not re-check status per request (API_DESIGN.md
     * §2/§4).
     *
     * A valid token whose `sub` has no row is a near-impossible data-integrity
     * case — users are soft-deactivated, never hard-deleted in V1 — surfaced
     * as `user.not_found` (404) to match the sibling `WorkspaceService`.
     */
    async me(userId: string): Promise<UserRecord> {
        const user = await this.users.findById(userId);
        if (!user) {
            throw AppError.notFound(
                "user.not_found",
                `User ${userId} does not exist`,
            );
        }
        return user;
    }

    /**
     * Begin a password reset. For an ACTIVE account, atomically invalidate any
     * outstanding reset tokens and issue a fresh single-use one (≤30 min), then
     * email the link. For a missing or non-active account, do nothing. Either
     * way the method resolves the same way — the controller always returns 202,
     * so the response never reveals whether the email is registered
     * (enumeration protection, API_DESIGN.md §2).
     */
    async forgotPassword(input: { email: string }): Promise<void> {
        const user = await this.users.findByEmail(input.email);
        if (!user || user.status !== "active") {
            return;
        }

        const rawToken = randomToken();
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        // Invalidate-prior + insert-new in one transaction: only the newest
        // link is ever live, with no window where the user has zero tokens.
        //
        // The DELETE (a `user_id` range) + INSERT pair can deadlock when several
        // forgot-password requests for the SAME user race — each holds a gap lock
        // the other's insert needs (ER_LOCK_DEADLOCK 1213). A victim transaction
        // is rolled back cleanly, so a bounded retry turns the transient lock
        // error into the same 202 the caller expects (mirrors OnCallService's
        // tx-retry). `rawToken` is fixed across attempts so the emailed link
        // stays valid; each attempt mints a fresh row id.
        let lastErr: unknown;
        for (let attempt = 0; attempt < MAX_FORGOT_TX_ATTEMPTS; attempt++) {
            try {
                await this.db.transaction(async (tx) => {
                    // Serialize concurrent forgot-password for the SAME user by
                    // taking the user-row lock FIRST (lock-ordering). Without it,
                    // parallel DELETE+INSERT pairs deadlock on the
                    // password_reset_tokens `user_id` gap locks (ER_LOCK_DEADLOCK
                    // 1213) and can exhaust the retry; queuing every request on the
                    // single users row removes the lock cycle. The retry below
                    // stays as a defensive backstop.
                    await this.users.findByIdForUpdate(
                        user.id,
                        user.workspaceId,
                        tx,
                    );
                    await this.resetTokens.deleteActiveForUser(user.id, tx);
                    await this.resetTokens.create(
                        {
                            id: fakeId("prt"),
                            userId: user.id,
                            tokenHash: sha256(rawToken),
                            expiresAt,
                        },
                        tx,
                    );
                });
                lastErr = undefined;
                break;
            } catch (err) {
                if (isRetryableTxError(err)) {
                    lastErr = err;
                    continue;
                }
                throw err;
            }
        }
        if (lastErr) {
            throw lastErr instanceof Error
                ? lastErr
                : AppError.internal(
                      "Password reset token persist failed after retries",
                  );
        }

        // Send AFTER commit so SMTP latency never holds the transaction open. A
        // transport failure must not turn a committed token into a 5xx (the user
        // can request another link), so we swallow + log it.
        const base = Config.FRONTEND_URL ?? "";
        const resetUrl = `${base}/reset-password/${rawToken}`;
        try {
            await this.mailer.sendPasswordResetEmail(user.email, resetUrl);
        } catch (err: unknown) {
            this.logger.warn("auth.forgot_password.email_failed", {
                userId: user.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Public invitation summary for the accept landing page (`GET
     * /api/v1/auth/invitation/:token`). The raw token is hashed before lookup;
     * only a still-pending, unexpired invitation resolves — otherwise a clear
     * 404 / 409 / 410 so the page can explain why the link won't work. No token
     * or hash is ever returned.
     */
    async getInvitation(token: string): Promise<{
        email: string;
        role: "admin" | "member" | "guest";
        workspaceName: string;
    }> {
        const detail = await this.invitations.findDetailByTokenHash(
            sha256(token),
        );
        this.assertInvitationUsable(detail);
        return {
            email: detail.email,
            role: detail.role,
            workspaceName: detail.workspaceName,
        };
    }

    /**
     * Accept an invitation (`POST /api/v1/auth/accept-invitation`). The emailed
     * token is the capability — there is no prior session. In ONE transaction it
     * locks the invitation, sets the invited user's first password (bcrypt),
     * flips their status `invited → active`, and stamps the invitation
     * `accepted_at` / `accepted_by` (single-use). The user is then
     * auto-logged-in (a fresh session + token pair, exactly like `/auth/login`),
     * so the caller lands straight in the app. The invitation row itself is the
     * audit record (`accepted_by` = the user's own id), so no extra
     * `workspace_activity` row is written.
     */
    async acceptInvitation(input: {
        token: string;
        password: string;
        userAgent?: string;
        ipAddress?: string;
    }): Promise<LoginResult> {
        const tokenHash = sha256(input.token);
        // Hash the password BEFORE the transaction so the ~100 ms bcrypt work
        // never holds the invitation row lock.
        const passwordHash = await this.creds.hashPassword(input.password);

        const accepted = await this.db.transaction(async (tx) => {
            const invitation = await this.invitations.findByTokenHashForUpdate(
                tokenHash,
                tx,
            );
            this.assertInvitationUsable(invitation);

            // The invited user row was created alongside the invitation (same
            // workspace + email). Lock it so a concurrent deactivate / role
            // change serializes with the accept.
            const user = await this.users.findByWorkspaceEmailForUpdate(
                invitation.workspaceId,
                invitation.email,
                tx,
            );
            if (!user) {
                // The invite flow always creates the matching user row — its
                // absence is a data-integrity fault, not a client error.
                throw AppError.internal(
                    "Invited user row is missing for this invitation",
                );
            }
            if (user.status !== "invited") {
                // Already accepted (active) or since deactivated — not (re)acceptable.
                throw AppError.conflict(
                    "invitation.already_accepted",
                    "This invitation has already been accepted",
                );
            }

            await this.users.updatePassword(user.id, passwordHash, tx);
            await this.users.update(user.id, { status: "active" }, tx);
            await this.invitations.markAccepted(invitation.id, user.id, tx);

            return {
                userId: user.id,
                role: user.role,
                workspaceId: invitation.workspaceId,
            };
        });

        // Auto-login OUTSIDE the transaction (mirrors `/auth/login`, which
        // persists the session without a transaction). The committed state above
        // is the source of truth; a failed session insert just means the user
        // signs in manually with the password they just set.
        const sessionId = fakeId("ses");
        const payload: JwtPayload = {
            sub: accepted.userId,
            role: accepted.role,
            workspaceId: accepted.workspaceId,
        };
        const accessToken = this.tokens.generateAccessToken({
            ...payload,
            id: sessionId,
        });
        const refreshToken = this.tokens.generateRefreshToken({
            ...payload,
            id: sessionId,
        });
        await this.tokens.persistSession({
            id: sessionId,
            userId: accepted.userId,
            refreshToken,
            userAgent: input.userAgent,
            ipAddress: input.ipAddress,
        });

        const user = await this.users.findById(accepted.userId);
        if (!user) {
            throw AppError.internal("Accepted user could not be loaded");
        }
        return { user, accessToken, refreshToken, sessionId };
    }

    /**
     * Shared invitation precondition check for both the read and the accept.
     * Narrows `detail` to non-null on success; otherwise throws the clear,
     * client-facing reason (missing → 404, already accepted → 409, expired →
     * 410). The token holder legitimately owns the link, so — unlike
     * password-reset — distinct codes are a UX win, not an enumeration risk.
     */
    private assertInvitationUsable<
        T extends { expiresAt: Date; acceptedAt: Date | null },
    >(detail: T | null): asserts detail is T {
        if (!detail) {
            throw AppError.notFound(
                "invitation.not_found",
                "This invitation link is not valid",
            );
        }
        if (detail.acceptedAt) {
            throw AppError.conflict(
                "invitation.already_accepted",
                "This invitation has already been accepted",
            );
        }
        if (detail.expiresAt.getTime() <= Date.now()) {
            throw new AppError(
                410,
                "invitation.expired",
                "This invitation link has expired",
            );
        }
    }
}
