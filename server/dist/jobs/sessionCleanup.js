"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionCleanup = void 0;
const client_1 = require("../db/client");
const TokenService_1 = require("../services/TokenService");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * §28 #5 session-cleanup (hourly), two prune rules since F10 (ISS-017):
 *
 *   1. `expires_at < NOW() - 30d`  — the original rule: long-dead windows go.
 *   2. `revoked_at < NOW() - 7d`   — a revoked session can never authenticate
 *      again (rotation, logout, reset, deactivation all revoke); before this
 *      rule it still survived until `expires_at + 30d` ≈ 60 days, which at
 *      BeautyBooth's refresh cadence (~3.2k rows/day) is a ~190k-row steady
 *      state. Seven days keeps a comfortable forensic window; steady state
 *      drops to ~23k rows.
 *
 * Idempotent: both are pure `DELETE ... WHERE < cutoff` — a re-run in the same
 * hour removes nothing new. `dry_run` counts the same rows without deleting.
 */
const sessionCleanup = async ({ dryRun, }) => {
    const tokens = new TokenService_1.TokenService((0, client_1.getDb)());
    const expiryCutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const revokedCutoff = new Date(Date.now() - SEVEN_DAYS_MS);
    if (dryRun) {
        const wouldDelete = await tokens.countPrunable(expiryCutoff, revokedCutoff);
        return { processed: wouldDelete, wouldDelete };
    }
    const deletedExpired = await tokens.deleteExpiredBefore(expiryCutoff);
    const deletedRevoked = await tokens.deleteRevokedBefore(revokedCutoff);
    const deleted = deletedExpired + deletedRevoked;
    return {
        processed: deleted,
        deleted,
        deleted_expired: deletedExpired,
        deleted_revoked: deletedRevoked,
    };
};
exports.sessionCleanup = sessionCleanup;
