"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachmentJanitor = void 0;
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const AttachmentsRepo_1 = require("../repositories/AttachmentsRepo");
const R2Service_1 = require("../services/R2Service");
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
const attachmentJanitor = async ({ dryRun, }) => {
    const repo = new AttachmentsRepo_1.AttachmentsRepo((0, client_1.getDb)());
    const cutoff = new Date(Date.now() - ONE_HOUR_MS);
    const stale = await repo.findStalePending(cutoff);
    if (dryRun) {
        return { processed: stale.length, wouldDelete: stale.length };
    }
    const r2 = new R2Service_1.R2Service(logger_1.default);
    let deleted = 0;
    for (const att of stale) {
        // Best-effort R2 cleanup — a storage hiccup must never block the row delete.
        try {
            await r2.deleteObject(att.storageKey);
        }
        catch (err) {
            logger_1.default.warn("job.attachment-janitor.r2_delete_failed", {
                attachmentId: att.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        deleted += await repo.hardDeletePending(att.id);
    }
    return { processed: deleted, deleted };
};
exports.attachmentJanitor = attachmentJanitor;
