import { getDb } from "../db/client";
import { FormSubmissionsRepo } from "../repositories/FormSubmissionsRepo";
import type { JobContext, JobOutcome } from "./types";

/**
 * §18 form-submission-expiry (daily): hard-delete `form_submissions` rows
 * whose retention period expired (`expires_at < NOW()`). PII retention
 * policy — all submissions auto-delete after 90 days.
 *
 * Idempotent: a pure `DELETE ... WHERE expires_at < NOW()` removes nothing new
 * on a re-run on the same day. `dry_run` counts without deleting.
 */
export const formSubmissionExpiry = async ({
    dryRun,
}: JobContext): Promise<JobOutcome> => {
    const repo = new FormSubmissionsRepo(getDb());
    const now = new Date();

    if (dryRun) {
        const wouldDelete = await repo.countExpiredBefore(now);
        return { processed: wouldDelete, wouldDelete };
    }

    const deleted = await repo.deleteExpiredBefore(now);
    return { processed: deleted, deleted };
};
