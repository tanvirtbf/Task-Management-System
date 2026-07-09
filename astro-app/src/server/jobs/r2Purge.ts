import { getDb } from "../db/client";
import logger from "../config/logger";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { R2Service } from "../services/R2Service";
import type { JobContext, JobOutcome } from "./types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * §28 #4 r2-purge (daily): permanently delete the R2 objects + rows of
 * attachments soft-deleted more than 7 days ago (`deleted_at < NOW() - 7d`).
 * The R2 objects (the main key + any thumbnail) are deleted BEFORE the DB row,
 * so a crash mid-job leaves the row still purgeable and the next run retries —
 * never orphaning bytes. R2 DELETE is idempotent (a missing key is a no-op). If
 * an R2 delete fails, the row is left for the next run (counted as `r2Errors`).
 *
 * Idempotent: the `deleted_at < cutoff` predicate + the row vanishing make a
 * re-run a no-op. `dry_run` counts only — no R2 calls, no row deletes.
 */
export const r2Purge = async ({ dryRun }: JobContext): Promise<JobOutcome> => {
    const repo = new AttachmentsRepo(getDb());
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
    const purgeable = await repo.findPurgeable(cutoff);

    if (dryRun) {
        return { processed: purgeable.length, wouldPurge: purgeable.length };
    }

    const r2 = new R2Service(logger);
    let purged = 0;
    let r2Errors = 0;
    for (const att of purgeable) {
        try {
            await r2.deleteObject(att.storageKey);
            if (att.thumbnailKey) await r2.deleteObject(att.thumbnailKey);
        } catch (err) {
            // Don't delete the row without its bytes gone — leave it for the
            // next run and surface the failure count.
            r2Errors += 1;
            logger.warn("job.r2-purge.r2_delete_failed", {
                attachmentId: att.id,
                error: err instanceof Error ? err.message : String(err),
            });
            continue;
        }
        purged += await repo.hardDeletePurged(att.id);
    }
    return { processed: purged, purged, r2Errors };
};
