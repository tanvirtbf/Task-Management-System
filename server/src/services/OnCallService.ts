import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import { OnCallRepo, type OnCallShiftRecord } from "../repositories/OnCallRepo";
import { UsersRepo } from "../repositories/UsersRepo";

/**
 * §21 On-call domain logic. The read paths delegate to the repository; the
 * upsert owns a transaction (paired upsert + re-read) and validates the
 * engineer. No `workspace_activity` audit row — the audit enum has no on-call
 * entity type (same treatment as forms).
 */

/** Parse a validated `YYYY-MM-DD` to a LOCAL-midnight Date (Drizzle `date()` mode — matches the factory + serializer). */
const toLocalDate = (iso: string): Date => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
};

/** mysql2 transient lock errors worth retrying a transaction on. */
const isRetryableTxError = (err: unknown): boolean => {
    const e = err as { errno?: number } | null;
    return e?.errno === 1213 || e?.errno === 1205; // ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT
};

/** errno 1452 = ER_NO_REFERENCED_ROW_2: the referenced engineer FK row is gone. */
const isMissingReferencedRowError = (err: unknown): boolean => {
    const e = err as { errno?: number } | null;
    return e?.errno === 1452;
};

export interface SetOnCallInput {
    workspaceId: string;
    actorId: string;
    /** A validated Monday in `YYYY-MM-DD` (enforced by the route's `setOnCallValidator`). */
    weekStart: string;
    engineerId: string;
}

export class OnCallService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private repo: OnCallRepo,
        private usersRepo: UsersRepo,
        private logger: Logger,
    ) {}

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
    async getCurrent(workspaceId: string): Promise<OnCallShiftRecord | null> {
        return this.repo.findCurrent(workspaceId);
    }

    /**
     * Every on-call shift in the caller's workspace, chronological, optionally
     * windowed by `from` / `to` (inclusive, on `week_start`, `YYYY-MM-DD`).
     * Workspace isolation via `workspaceId` from the verified access token.
     */
    async listSchedule(
        workspaceId: string,
        range: { from?: string; to?: string },
    ): Promise<OnCallShiftRecord[]> {
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
    async set(input: SetOnCallInput): Promise<OnCallShiftRecord> {
        const { workspaceId, actorId, weekStart, engineerId } = input;

        const activeIds = await this.usersRepo.findActiveIdsInWorkspace(
            [engineerId],
            workspaceId,
        );
        if (!activeIds.has(engineerId)) {
            throw AppError.unprocessable(
                "on_call.invalid_engineer",
                `Engineer ${engineerId} is not an active member of this workspace`,
            );
        }

        const weekStartDate = toLocalDate(weekStart);
        const weekEndDate = new Date(
            weekStartDate.getFullYear(),
            weekStartDate.getMonth(),
            weekStartDate.getDate() + 6,
        );

        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.db.transaction(async (tx) => {
                    await this.repo.upsert(
                        {
                            workspaceId,
                            weekStart: weekStartDate,
                            weekEnd: weekEndDate,
                            engineerId,
                            createdBy: actorId,
                        },
                        tx,
                    );
                    const row = await this.repo.findByWeek(
                        workspaceId,
                        weekStart,
                        tx,
                    );
                    if (!row) {
                        throw AppError.internal(
                            "On-call shift did not persist after upsert",
                        );
                    }
                    return row;
                });
            } catch (err) {
                // A concurrent hard-delete of the engineer between the
                // active-membership check and the INSERT trips the engineer FK
                // (ON DELETE RESTRICT, errno 1452) — surface the same 422 the
                // pre-check would have, never a raw 500.
                if (isMissingReferencedRowError(err)) {
                    throw AppError.unprocessable(
                        "on_call.invalid_engineer",
                        `Engineer ${engineerId} is not an active member of this workspace`,
                    );
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
            : AppError.internal("On-call upsert failed after retries");
    }

    /**
     * Remove the shift for a week. `weekStart` is the validated Monday string; a
     * missing shift (or one in another workspace) deletes nothing → `404
     * on_call.not_found` (cross-tenant indistinguishable from absent — no
     * oracle). A single workspace-scoped statement; no audit row (the audit enum
     * has no on-call entity type).
     */
    async delete(workspaceId: string, weekStart: string): Promise<void> {
        const affected = await this.repo.deleteByWeek(workspaceId, weekStart);
        if (affected === 0) {
            throw AppError.notFound(
                "on_call.not_found",
                `No on-call shift exists for week ${weekStart}`,
            );
        }
    }
}
