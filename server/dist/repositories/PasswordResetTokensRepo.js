"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasswordResetTokensRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
class PasswordResetTokensRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Look up a token row by its `sha256` hash and take a `FOR UPDATE` row
     * lock. The lock serializes concurrent uses of the SAME token so the
     * service's "unconsumed?" check and the consume write cannot race — a
     * replay sees `consumed_at` already set. Must run inside a transaction;
     * pass the `tx` executor.
     */
    async findByTokenHashForUpdate(tokenHash, exec) {
        const [row] = await exec
            .select({
            id: schema_1.passwordResetTokens.id,
            userId: schema_1.passwordResetTokens.userId,
            expiresAt: schema_1.passwordResetTokens.expiresAt,
            consumedAt: schema_1.passwordResetTokens.consumedAt,
        })
            .from(schema_1.passwordResetTokens)
            .where((0, drizzle_orm_1.eq)(schema_1.passwordResetTokens.tokenHash, tokenHash))
            .limit(1)
            .for("update");
        return row ?? null;
    }
    /** Mark a token consumed (single-use). Idempotent re-stamp of `consumed_at`. */
    async markConsumed(id, exec = this.db) {
        await exec
            .update(schema_1.passwordResetTokens)
            .set({ consumedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.passwordResetTokens.id, id));
    }
    /**
     * Insert a fresh reset-token row. The caller hashes the raw token; only
     * `sha256(rawToken)` is stored here. Accepts an executor so the
     * invalidate-prior + insert-new pair runs inside one transaction.
     */
    async create(input, exec = this.db) {
        await exec.insert(schema_1.passwordResetTokens).values({
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
    async deleteActiveForUser(userId, exec = this.db) {
        await exec
            .delete(schema_1.passwordResetTokens)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.passwordResetTokens.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.passwordResetTokens.consumedAt)));
    }
}
exports.PasswordResetTokensRepo = PasswordResetTokensRepo;
