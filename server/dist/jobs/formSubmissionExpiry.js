"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formSubmissionExpiry = void 0;
const client_1 = require("../db/client");
const FormSubmissionsRepo_1 = require("../repositories/FormSubmissionsRepo");
/**
 * §18 form-submission-expiry (daily): hard-delete `form_submissions` rows
 * whose retention period expired (`expires_at < NOW()`). PII retention
 * policy — all submissions auto-delete after 90 days.
 *
 * Idempotent: a pure `DELETE ... WHERE expires_at < NOW()` removes nothing new
 * on a re-run on the same day. `dry_run` counts without deleting.
 */
const formSubmissionExpiry = async ({ dryRun, }) => {
    const repo = new FormSubmissionsRepo_1.FormSubmissionsRepo((0, client_1.getDb)());
    const now = new Date();
    if (dryRun) {
        const wouldDelete = await repo.countExpiredBefore(now);
        return { processed: wouldDelete, wouldDelete };
    }
    const deleted = await repo.deleteExpiredBefore(now);
    return { processed: deleted, deleted };
};
exports.formSubmissionExpiry = formSubmissionExpiry;
