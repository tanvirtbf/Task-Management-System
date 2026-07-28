"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionCleanup = void 0;
const client_1 = require("../db/client");
const TokenService_1 = require("../services/TokenService");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * §28 #5 session-cleanup (hourly): hard-delete `sessions` rows whose refresh
 * window expired more than 30 days ago (`expires_at < NOW() - 30 days`).
 * Revoked-but-not-yet-expired rows are intentionally kept until they too age
 * out (the contract keys only on `expires_at + 30d`).
 *
 * Idempotent: a pure `DELETE ... WHERE expires_at < cutoff` removes nothing new
 * on a re-run in the same hour (the cutoff barely moves). `dry_run` counts the
 * same rows without deleting.
 */
const sessionCleanup = async ({ dryRun, }) => {
    const tokens = new TokenService_1.TokenService((0, client_1.getDb)());
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    if (dryRun) {
        const wouldDelete = await tokens.countExpiredBefore(cutoff);
        return { processed: wouldDelete, wouldDelete };
    }
    const deleted = await tokens.deleteExpiredBefore(cutoff);
    return { processed: deleted, deleted };
};
exports.sessionCleanup = sessionCleanup;
