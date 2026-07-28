"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskActivityRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
class TaskActivityRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Append one or more activity rows. */
    async recordMany(rows, exec = this.db) {
        if (rows.length === 0)
            return;
        await exec.insert(schema_1.taskActivity).values(rows.map((r) => ({
            id: (0, utils_1.fakeId)("act"),
            taskId: r.taskId,
            actorId: r.actorId,
            action: r.action,
            context: r.context ?? null,
        })));
    }
    /**
     * One newest-first page of a task's activity, ordered by `internal_id`
     * DESC — the stable, monotonic keyset (`created_at` is only second-granular,
     * so it cannot tie-break a burst of same-second writes). The caller passes
     * `limit + 1` and uses the extra row to derive `has_more`. The `task_id`
     * filter is served by `idx_task_activity_task_time (task_id, created_at)`;
     * a single task's feed is small, so the DESC sort on `internal_id` is cheap.
     */
    async listByTask(params) {
        return this.db
            .select({
            id: schema_1.taskActivity.id,
            internalId: schema_1.taskActivity.internalId,
            taskId: schema_1.taskActivity.taskId,
            actorId: schema_1.taskActivity.actorId,
            action: schema_1.taskActivity.action,
            context: schema_1.taskActivity.context,
            createdAt: schema_1.taskActivity.createdAt,
        })
            .from(schema_1.taskActivity)
            .where(this.feedWhere(params))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskActivity.internalId))
            .limit(params.limit);
    }
    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countByTask(params) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.taskActivity)
            .where(this.feedWhere(params));
        return row?.value ?? 0;
    }
    /**
     * Shared WHERE for the feed page + count. `task_id` is always present; the
     * optional `action` filter and the keyset cursor are appended only when
     * supplied (Drizzle's `and()` drops `undefined` entries).
     */
    feedWhere(params) {
        return (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskActivity.taskId, params.taskId), params.action ? (0, drizzle_orm_1.eq)(schema_1.taskActivity.action, params.action) : undefined, params.afterInternalId
            ? (0, drizzle_orm_1.lt)(schema_1.taskActivity.internalId, BigInt(params.afterInternalId))
            : undefined);
    }
}
exports.TaskActivityRepo = TaskActivityRepo;
