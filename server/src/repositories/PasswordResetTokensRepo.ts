import { and, eq, isNull } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { passwordResetTokens } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for the `password_reset_tokens` table. Owns the Drizzle queries;
 * `AuthService` composes the reset flow over the rows this repo returns.
 *
 * Tokens are short-lived (≤ 30 min) and single-use via `consumed_at`. The raw
 * token is never stored — `token_hash` holds `sha256(rawToken)`, looked up by
 * the same hash the reset flow computes from the request body.
 */

/** Projection the reset flow needs to validate + consume a token. */
export interface PasswordResetTokenRow {
    id: string;
    userId: string;
    expiresAt: Date;
    consumedAt: Date | null;
}

export class PasswordResetTokensRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Look up a token row by its `sha256` hash and take a `FOR UPDATE` row
     * lock. The lock serializes concurrent uses of the SAME token so the
     * service's "unconsumed?" check and the consume write cannot race — a
     * replay sees `consumed_at` already set. Must run inside a transaction;
     * pass the `tx` executor.
     */
    async findByTokenHashForUpdate(
        tokenHash: string,
        exec: DbExecutor,
    ): Promise<PasswordResetTokenRow | null> {
        const [row] = await exec
            .select({
                id: passwordResetTokens.id,
                userId: passwordResetTokens.userId,
                expiresAt: passwordResetTokens.expiresAt,
                consumedAt: passwordResetTokens.consumedAt,
            })
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenHash, tokenHash))
            .limit(1)
            .for("update");
        return row ?? null;
    }

    /** Mark a token consumed (single-use). Idempotent re-stamp of `consumed_at`. */
    async markConsumed(id: string, exec: DbExecutor = this.db): Promise<void> {
        await exec
            .update(passwordResetTokens)
            .set({ consumedAt: new Date() })
            .where(eq(passwordResetTokens.id, id));
    }

    /**
     * Insert a fresh reset-token row. The caller hashes the raw token; only
     * `sha256(rawToken)` is stored here. Accepts an executor so the
     * invalidate-prior + insert-new pair runs inside one transaction.
     */
    async create(
        input: {
            id: string;
            userId: string;
            tokenHash: string;
            expiresAt: Date;
        },
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(passwordResetTokens).values({
            id: input.id,
            userId: input.userId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
        });
    }

    /**
     * Delete every still-usable (unconsumed) reset token for a user, so a fresh
     * forgot-password request invalidates any prior outstanding links. Consumed
     * rows are left for audit.
     */
    async deleteActiveForUser(
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .delete(passwordResetTokens)
            .where(
                and(
                    eq(passwordResetTokens.userId, userId),
                    isNull(passwordResetTokens.consumedAt),
                ),
            );
    }
}
