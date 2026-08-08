"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnCallService = void 0;
const errors_1 = require("../errors");
/**
 * §21 On-call domain logic. The read paths delegate to the repository; the
 * upsert owns a transaction (paired upsert + re-read) and validates the
 * engineer. No `workspace_activity` audit row — the audit enum has no on-call
 * entity type (same treatment as forms).
 */
/**
 * Parse a validated `YYYY-MM-DD` to a **UTC-midnight** Date for a Drizzle
 * `date()` column — matches `onCallSerializer.toWireDate`, which reads it back
 * with `getUTC*`. Changed from local midnight in F3; see `TaskWriteService`.
 */
const toDateOnly = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
};
/** Whole days in ms — safe to add to a UTC-midnight date (UTC has no DST). */
const DAY_MS = 24 * 60 * 60 * 1000;
/** mysql2 transient lock errors worth retrying a transaction on. */
const isRetryableTxError = (err) => {
    const e = err;
    return e?.errno === 1213 || e?.errno === 1205; // ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT
};
/** errno 1452 = ER_NO_REFERENCED_ROW_2: the referenced engineer FK row is gone. */
const isMissingReferencedRowError = (err) => {
    const e = err;
    return e?.errno === 1452;
};
class OnCallService {
    db;
    repo;
    usersRepo;
    logger;
    constructor(db, repo, usersRepo, logger) {
        this.db = db;
        this.repo = repo;
        this.usersRepo = usersRepo;
        this.logger = logger;
    }
    /**
     * The shift covering today in the caller's workspace, or `null`. Workspace
     * isolation is the caller's responsibility: `workspaceId` MUST come from the
     * verified access token (`req.auth.workspaceId`), never client input.
     *
     * This is §21's "who is on call now" read; it returns the assigned shift
     * even if that engineer was later deactivated (the rotation still names
     * them). NOTE: §22 report-bug currently keeps its OWN active-engineer-filtered
     * lookup rather than calling this, so the two are intentionally separate
     * today (auto-assign skips a deactivated on-call engineer; this read does
     * not). They could be consolidated onto this method later.
     */
    async getCurrent(workspaceId) {
        return this.repo.findCurrent(workspaceId);
    }
    /**
     * Every on-call shift in the caller's workspace, chronological, optionally
     * windowed by `from` / `to` (inclusive, on `week_start`, `YYYY-MM-DD`).
     * Workspace isolation via `workspaceId` from the verified access token.
     */
    async listSchedule(workspaceId, range) {
        return this.repo.listSchedule(workspaceId, range.from, range.to);
    }
    /**
     * Assign (or overwrite) the on-call engineer for `weekStart` — the §21
     * idempotent upsert keyed on `(workspace_id, week_start)`. `engineer_id` must
     * be an ACTIVE user in the caller's workspace; a missing / deactivated /
     * cross-tenant id all collapse to `422 on_call.invalid_engineer` (no
     * existence oracle). `week_end` is derived (`week_start + 6` = Sunday). The
     * upsert + the re-read run in one transaction so the returned shift reflects
     * the committed row; the transaction is retried on a transient deadlock,
     * which concurrent upserts of the SAME week can briefly hit on the unique key.
     */
    async set(input) {
        const { workspaceId, actorId, weekStart, engineerId } = input;
        const activeIds = await this.usersRepo.findActiveIdsInWorkspace([engineerId], workspaceId);
        if (!activeIds.has(engineerId)) {
            throw errors_1.AppError.unprocessable("on_call.invalid_engineer", `Engineer ${engineerId} is not an active member of this workspace`);
        }
        const weekStartDate = toDateOnly(weekStart);
        // +6 days in UTC. This must NOT use local getters: `weekStartDate` is UTC
        // midnight, and rebuilding a date from LOCAL components off it lands on the
        // wrong instant under any non-zero offset — in Dhaka it produced a week_end
        // one day short, so Sunday had nobody on call. (Caught in F3, after the
        // local→UTC switch above; the two halves have to move together.)
        const weekEndDate = new Date(weekStartDate.getTime() + 6 * DAY_MS);
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.db.transaction(async (tx) => {
                    await this.repo.upsert({
                        workspaceId,
                        weekStart: weekStartDate,
                        weekEnd: weekEndDate,
                        engineerId,
                        createdBy: actorId,
                    }, tx);
                    const row = await this.repo.findByWeek(workspaceId, weekStart, tx);
                    if (!row) {
                        throw errors_1.AppError.internal("On-call shift did not persist after upsert");
                    }
                    return row;
                });
            }
            catch (err) {
                // A concurrent hard-delete of the engineer between the
                // active-membership check and the INSERT trips the engineer FK
                // (ON DELETE RESTRICT, errno 1452) — surface the same 422 the
                // pre-check would have, never a raw 500.
                if (isMissingReferencedRowError(err)) {
                    throw errors_1.AppError.unprocessable("on_call.invalid_engineer", `Engineer ${engineerId} is not an active member of this workspace`);
                }
                if (isRetryableTxError(err)) {
                    lastErr = err;
                    continue;
                }
                throw err;
            }
        }
        throw lastErr instanceof Error
            ? lastErr
            : errors_1.AppError.internal("On-call upsert failed after retries");
    }
    /**
     * Remove the shift for a week. `weekStart` is the validated Monday string; a
     * missing shift (or one in another workspace) deletes nothing → `404
     * on_call.not_found` (cross-tenant indistinguishable from absent — no
     * oracle). A single workspace-scoped statement; no audit row (the audit enum
     * has no on-call entity type).
     */
    async delete(workspaceId, weekStart) {
        const affected = await this.repo.deleteByWeek(workspaceId, weekStart);
        if (affected === 0) {
            throw errors_1.AppError.notFound("on_call.not_found", `No on-call shift exists for week ${weekStart}`);
        }
    }
}
exports.OnCallService = OnCallService;
