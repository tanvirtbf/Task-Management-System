"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignmentRequestExpiry = void 0;
const client_1 = require("../db/client");
const AssignmentRequestsService_1 = require("../services/AssignmentRequestsService");
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
const assignmentRequestExpiry = async ({ dryRun, }) => {
    // The gate singleton carries the full service graph; `getDb()` first so a
    // CLI run (`npm run job assignment-request-expiry`) initialises like boot.
    (0, client_1.getDb)();
    const { scanned, expired } = await (0, AssignmentRequestsService_1.assignmentGate)().expireDue({
        now: new Date(),
        limit: EXPIRY_BATCH_LIMIT,
        dryRun,
    });
    return dryRun
        ? { processed: scanned, wouldExpire: scanned }
        : { processed: scanned, expired };
};
exports.assignmentRequestExpiry = assignmentRequestExpiry;
