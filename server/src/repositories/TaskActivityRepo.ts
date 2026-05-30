import { and, count, desc, eq, lt, type SQL } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { taskActivity } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Per-task audit feed (`task_activity`). Append-only writer (`recordMany`, used
 * by every mutating task endpoint, in the same transaction as the change it
 * describes) plus the §13 read side (`listByTask` / `countByTask`).
 */

export interface NewActivity {
    taskId: string;
    /** `null` for system events (cron, webhook). */
    actorId: string | null;
    /** Stable code the UI switches on, e.g. `assignee_added`. */
    action: string;
    /** Optional structured payload (from/to, user_id, …). */
    context?: Record<string, unknown> | null;
}

/**
 * One `task_activity` row in the §13 read projection. `internalId` is the
 * monotonic keyset / cursor value (BIGINT AUTO_INCREMENT); `actorId` is `null`
 * for system events or when the actor's user row was deleted (`fk_task_activity_
 * actor` is `ON DELETE SET NULL`).
 */
export interface ActivityRow {
    id: string;
    internalId: bigint;
    taskId: string;
    actorId: string | null;
    action: string;
    context: Record<string, unknown> | null;
    createdAt: Date;
}

export interface ActivityFeedParams {
    taskId: string;
    /** Exact-match filter on `action` (`?action=`); absent = no filter. */
    action?: string;
    /** Keyset: only rows with `internal_id` strictly less than this. */
    afterInternalId?: string;
}

export class TaskActivityRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Append one or more activity rows. */
    async recordMany(
        rows: NewActivity[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (rows.length === 0) return;
        await exec.insert(taskActivity).values(
            rows.map((r) => ({
                id: fakeId("act"),
                taskId: r.taskId,
                actorId: r.actorId,
                action: r.action,
                context: r.context ?? null,
            })),
        );
    }

    /**
     * One newest-first page of a task's activity, ordered by `internal_id`
     * DESC — the stable, monotonic keyset (`created_at` is only second-granular,
     * so it cannot tie-break a burst of same-second writes). The caller passes
     * `limit + 1` and uses the extra row to derive `has_more`. The `task_id`
     * filter is served by `idx_task_activity_task_time (task_id, created_at)`;
     * a single task's feed is small, so the DESC sort on `internal_id` is cheap.
     */
    async listByTask(
        params: ActivityFeedParams & { limit: number },
    ): Promise<ActivityRow[]> {
        return this.db
            .select({
                id: taskActivity.id,
                internalId: taskActivity.internalId,
                taskId: taskActivity.taskId,
                actorId: taskActivity.actorId,
                action: taskActivity.action,
                context: taskActivity.context,
                createdAt: taskActivity.createdAt,
            })
            .from(taskActivity)
            .where(this.feedWhere(params))
            .orderBy(desc(taskActivity.internalId))
            .limit(params.limit);
    }

    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countByTask(params: ActivityFeedParams): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(taskActivity)
            .where(this.feedWhere(params));
        return row?.value ?? 0;
    }

    /**
     * Shared WHERE for the feed page + count. `task_id` is always present; the
     * optional `action` filter and the keyset cursor are appended only when
     * supplied (Drizzle's `and()` drops `undefined` entries).
     */
    private feedWhere(params: ActivityFeedParams): SQL | undefined {
        return and(
            eq(taskActivity.taskId, params.taskId),
            params.action ? eq(taskActivity.action, params.action) : undefined,
            params.afterInternalId
                ? lt(taskActivity.internalId, BigInt(params.afterInternalId))
                : undefined,
        );
    }
}
