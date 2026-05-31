import { JwtPayload, sign } from "jsonwebtoken";
import createHttpError from "http-errors";
import { and, count, eq, isNull, lt } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import { Config } from "../config";
import * as schema from "../db/schema";
import { sessions } from "../db/schema";
import { fakeId, sha256 } from "../utils";
import type { DbExecutor } from "../repositories/types";

export class TokenService {
    constructor(private db: MySql2Database<typeof schema>) {}

    generateAccessToken(payload: JwtPayload) {
        if (!Config.ACCESS_TOKEN_SECRET) {
            throw createHttpError(500, "Access token secret not configured");
        }
        return sign(payload, Config.ACCESS_TOKEN_SECRET, {
            algorithm: "HS256",
            expiresIn: "15m",
            issuer: "task-management-server",
        });
    }

    generateRefreshToken(payload: JwtPayload & { id: string }) {
        if (!Config.REFRESH_TOKEN_SECRET) {
            throw createHttpError(500, "Refresh token secret not configured");
        }
        return sign(payload, Config.REFRESH_TOKEN_SECRET, {
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
    async persistSession(input: {
        id?: string;
        userId: string;
        refreshToken: string;
        userAgent?: string;
        ipAddress?: string;
    }) {
        const MS_IN_30_DAYS = 1000 * 60 * 60 * 24 * 30;
        const id = input.id ?? fakeId("ses");
        const tokenHash = sha256(input.refreshToken);

        await this.db.insert(sessions).values({
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
    async revokeSession(sessionId: string) {
        await this.db
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(eq(sessions.id, sessionId));
    }

    /** Check if a session exists and is still valid (not revoked, not expired). */
    async findActiveSession(sessionId: string) {
        const [row] = await this.db
            .select({
                id: sessions.id,
                userId: sessions.userId,
                expiresAt: sessions.expiresAt,
                revokedAt: sessions.revokedAt,
            })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!row) return null;
        if (row.revokedAt) return null;
        if (row.expiresAt.getTime() < Date.now()) return null;
        return row;
    }

    /**
     * Fetch a session row without filtering on `revoked_at` / `expires_at`.
     * The refresh-rotation flow needs to distinguish "revoked" from "expired"
     * from "missing" to drive the reuse-detection branch — `findActiveSession`
     * collapses all three to `null`, which is the wrong primitive here.
     */
    async findSessionAny(sessionId: string) {
        const [row] = await this.db
            .select({
                id: sessions.id,
                userId: sessions.userId,
                tokenHash: sessions.tokenHash,
                expiresAt: sessions.expiresAt,
                revokedAt: sessions.revokedAt,
            })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
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
    async rotateSession(input: {
        oldSessionId: string;
        newSessionId: string;
        userId: string;
        refreshToken: string;
        userAgent?: string;
        ipAddress?: string;
    }) {
        const MS_IN_30_DAYS = 1000 * 60 * 60 * 24 * 30;
        const tokenHash = sha256(input.refreshToken);
        const now = new Date();

        await this.db.transaction(async (tx) => {
            await tx.insert(sessions).values({
                id: input.newSessionId,
                userId: input.userId,
                tokenHash,
                userAgent: input.userAgent ?? null,
                ipAddress: input.ipAddress ?? null,
                expiresAt: new Date(now.getTime() + MS_IN_30_DAYS),
            });
            await tx
                .update(sessions)
                .set({ revokedAt: now })
                .where(eq(sessions.id, input.oldSessionId));
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
    async revokeAllForUser(userId: string, exec: DbExecutor = this.db) {
        await exec
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    }

    /**
     * Count sessions whose refresh window expired before `cutoff` — the dry-run
     * companion to `deleteExpiredBefore` for the §28 session-cleanup job.
     */
    async countExpiredBefore(cutoff: Date): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(sessions)
            .where(lt(sessions.expiresAt, cutoff));
        return row?.value ?? 0;
    }

    /**
     * Hard-delete sessions whose refresh window expired before `cutoff` (the §28
     * session-cleanup job passes NOW() - 30 days). Returns the affected-row
     * count. A pure `DELETE ... WHERE expires_at < ?` — naturally idempotent (a
     * re-run with a barely-moved cutoff removes nothing new). Nothing references
     * `sessions`, so a plain row delete is safe (no cascade concerns).
     */
    async deleteExpiredBefore(cutoff: Date): Promise<number> {
        const [result] = await this.db
            .delete(sessions)
            .where(lt(sessions.expiresAt, cutoff));
        return result.affectedRows;
    }
}
