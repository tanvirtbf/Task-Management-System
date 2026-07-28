"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenService = void 0;
const jsonwebtoken_1 = require("jsonwebtoken");
const drizzle_orm_1 = require("drizzle-orm");
const config_1 = require("../config");
const errors_1 = require("../errors");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
class TokenService {
    db;
    constructor(db) {
        this.db = db;
    }
    generateAccessToken(payload) {
        if (!config_1.Config.ACCESS_TOKEN_SECRET) {
            throw new errors_1.AppError(500, "auth.token_config_missing", "Access token secret not configured");
        }
        return (0, jsonwebtoken_1.sign)(payload, config_1.Config.ACCESS_TOKEN_SECRET, {
            algorithm: "HS256",
            expiresIn: "15m",
            issuer: "task-management-server",
        });
    }
    generateRefreshToken(payload) {
        if (!config_1.Config.REFRESH_TOKEN_SECRET) {
            throw new errors_1.AppError(500, "auth.token_config_missing", "Refresh token secret not configured");
        }
        return (0, jsonwebtoken_1.sign)(payload, config_1.Config.REFRESH_TOKEN_SECRET, {
            algorithm: "HS256",
            expiresIn: "30d",
            issuer: "task-management-server",
            jwtid: payload.id,
        });
    }
    /**
     * Persist a session row. We store `sha256(refreshToken)` in `token_hash` so
     * the raw refresh JWT is never written to disk.
     *
     * Callers may supply `id` so they can mint the refresh JWT with the
     * session id embedded BEFORE the row is inserted (login does this so the
     * cookie value carries the same id that ends up in the row). When omitted
     * a fresh id is generated.
     */
    async persistSession(input) {
        const MS_IN_30_DAYS = 1000 * 60 * 60 * 24 * 30;
        const id = input.id ?? (0, utils_1.fakeId)("ses");
        const tokenHash = (0, utils_1.sha256)(input.refreshToken);
        await this.db.insert(schema_1.sessions).values({
            id,
            userId: input.userId,
            tokenHash,
            userAgent: input.userAgent ?? null,
            ipAddress: input.ipAddress ?? null,
            expiresAt: new Date(Date.now() + MS_IN_30_DAYS),
        });
        return { id, tokenHash };
    }
    /** Revoke a session (logout). Soft delete via `revoked_at`. */
    async revokeSession(sessionId) {
        await this.db
            .update(schema_1.sessions)
            .set({ revokedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.sessions.id, sessionId));
    }
    /** Check if a session exists and is still valid (not revoked, not expired). */
    async findActiveSession(sessionId) {
        const [row] = await this.db
            .select({
            id: schema_1.sessions.id,
            userId: schema_1.sessions.userId,
            expiresAt: schema_1.sessions.expiresAt,
            revokedAt: schema_1.sessions.revokedAt,
        })
            .from(schema_1.sessions)
            .where((0, drizzle_orm_1.eq)(schema_1.sessions.id, sessionId))
            .limit(1);
        if (!row)
            return null;
        if (row.revokedAt)
            return null;
        if (row.expiresAt.getTime() < Date.now())
            return null;
        return row;
    }
    /**
     * Fetch a session row without filtering on `revoked_at` / `expires_at`.
     * The refresh-rotation flow needs to distinguish "revoked" from "expired"
     * from "missing" to drive the reuse-detection branch — `findActiveSession`
     * collapses all three to `null`, which is the wrong primitive here.
     */
    async findSessionAny(sessionId) {
        const [row] = await this.db
            .select({
            id: schema_1.sessions.id,
            userId: schema_1.sessions.userId,
            tokenHash: schema_1.sessions.tokenHash,
            expiresAt: schema_1.sessions.expiresAt,
            revokedAt: schema_1.sessions.revokedAt,
        })
            .from(schema_1.sessions)
            .where((0, drizzle_orm_1.eq)(schema_1.sessions.id, sessionId))
            .limit(1);
        return row ?? null;
    }
    /**
     * Atomically rotate a refresh session: insert the new row, then revoke
     * the old one. Insert-before-revoke means a crash between the two leaves
     * the user with the NEW cookie still valid and the OLD cookie still
     * valid (worst case: a brief duplicate). Revoke-before-insert would
     * orphan the user instead — far worse UX.
     */
    async rotateSession(input) {
        const MS_IN_30_DAYS = 1000 * 60 * 60 * 24 * 30;
        const tokenHash = (0, utils_1.sha256)(input.refreshToken);
        const now = new Date();
        await this.db.transaction(async (tx) => {
            await tx.insert(schema_1.sessions).values({
                id: input.newSessionId,
                userId: input.userId,
                tokenHash,
                userAgent: input.userAgent ?? null,
                ipAddress: input.ipAddress ?? null,
                expiresAt: new Date(now.getTime() + MS_IN_30_DAYS),
            });
            await tx
                .update(schema_1.sessions)
                .set({ revokedAt: now })
                .where((0, drizzle_orm_1.eq)(schema_1.sessions.id, input.oldSessionId));
        });
        return { id: input.newSessionId, tokenHash };
    }
    /**
     * Revoke every active session for a user. Triggered by the reuse-detection
     * branch of refresh (replaying a revoked refresh token signals theft) and
     * by password reset (force re-login everywhere). Takes an optional `exec`
     * so the reset flow can run it inside the same transaction as the password
     * change. Filters on `revoked_at IS NULL`, so it is idempotent and a user
     * with no active sessions resolves cleanly.
     */
    async revokeAllForUser(userId, exec = this.db) {
        await exec
            .update(schema_1.sessions)
            .set({ revokedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sessions.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.sessions.revokedAt)));
    }
    /**
     * Count sessions whose refresh window expired before `cutoff` — the dry-run
     * companion to `deleteExpiredBefore` for the §28 session-cleanup job.
     */
    async countExpiredBefore(cutoff) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.sessions)
            .where((0, drizzle_orm_1.lt)(schema_1.sessions.expiresAt, cutoff));
        return row?.value ?? 0;
    }
    /**
     * Hard-delete sessions whose refresh window expired before `cutoff` (the §28
     * session-cleanup job passes NOW() - 30 days). Returns the affected-row
     * count. A pure `DELETE ... WHERE expires_at < ?` — naturally idempotent (a
     * re-run with a barely-moved cutoff removes nothing new). Nothing references
     * `sessions`, so a plain row delete is safe (no cascade concerns).
     */
    async deleteExpiredBefore(cutoff) {
        const [result] = await this.db
            .delete(schema_1.sessions)
            .where((0, drizzle_orm_1.lt)(schema_1.sessions.expiresAt, cutoff));
        return result.affectedRows;
    }
}
exports.TokenService = TokenService;
