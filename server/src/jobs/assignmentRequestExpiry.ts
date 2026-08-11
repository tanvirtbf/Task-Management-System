import { getDb } from "../db/client";
import { assignmentGate } from "../services/AssignmentRequestsService";
import type { JobContext, JobOutcome } from "./types";

/**
 * Team-access P8, Q6 — expire cross-team assignment requests nobody answered.
 *
 * A pending request carries `expires_at` = created + 7 days. Once that lapses:
 * flip it to `expired` (an ATOMIC per-row claim — a racing accept always
 * wins), append the `expired` ledger row (actor NULL = the system), and tell
 * the requester. The task itself is untouched: unassigned is the honest
 * outcome of an unanswered ask, and the requester is free to ask again.
 *
 * Even between janitor runs a lapsed request is already DEAD — every mutation
 * (accept/decline/query/answer/cancel) refuses past `expires_at` — so cadence
 * only affects how promptly the requester is told, not correctness. Cron:
 * hourly (deploy/cron/bbtasks-jobs). Idempotent: a re-run finds nothing
 * pending to claim.
 */

/** Per-run cap — bounds one tick's notification burst (overdue-alert shape). */
const EXPIRY_BATCH_LIMIT = 500;

export const assignmentRequestExpiry = async ({
    dryRun,
}: JobContext): Promise<JobOutcome> => {
    // The gate singleton carries the full service graph; `getDb()` first so a
    // CLI run (`npm run job assignment-request-expiry`) initialises like boot.
    getDb();
    const { scanned, expired } = await assignmentGate().expireDue({
        now: new Date(),
        limit: EXPIRY_BATCH_LIMIT,
        dryRun,
    });
    return dryRun
        ? { processed: scanned, wouldExpire: scanned }
        : { processed: scanned, expired };
};
