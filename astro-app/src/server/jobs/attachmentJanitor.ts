import { getDb } from "../db/client";
import logger from "../config/logger";
import { AttachmentsRepo } from "../repositories/AttachmentsRepo";
import { R2Service } from "../services/R2Service";
import type { JobContext, JobOutcome } from "./types";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * §28 #3 attachment-janitor (hourly): hard-delete `attachments` rows whose
 * signed upload was never finalised within 1 hour
 * (`upload_status='pending' AND uploaded_at < NOW() - 1h`). Best-effort: delete
 * any partial object that landed in R2 (idempotent; a missing key is a no-op)
 * BEFORE removing the row, so a crash mid-job just re-sweeps next hour and never
 * orphans bytes. Pending rows were never counted in `tasks.attachments_count`,
 * so no counter adjustment is needed.
 *
 * Idempotent: the `pending` predicate + the row vanishing make a re-run a no-op;
 * `hardDeletePending` is guarded on `pending`, so a row that finalised between
 * the scan and the delete is left intact. `dry_run` counts only — no R2 calls.
 */
export const attachmentJanitor = async ({
    dryRun,
}: JobContext): Promise<JobOutcome> => {
    const repo = new AttachmentsRepo(getDb());
    const cutoff = new Date(Date.now() - ONE_HOUR_MS);
    const stale = await repo.findStalePending(cutoff);

    if (dryRun) {
        return { processed: stale.length, wouldDelete: stale.length };
    }

    const r2 = new R2Service(logger);
    let deleted = 0;
    for (const att of stale) {
        // Best-effort R2 cleanup — a storage hiccup must never block the row delete.
        try {
            await r2.deleteObject(att.storageKey);
        } catch (err) {
            logger.warn("job.attachment-janitor.r2_delete_failed", {
                attachmentId: att.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        deleted += await repo.hardDeletePending(att.id);
    }
    return { processed: deleted, deleted };
};
