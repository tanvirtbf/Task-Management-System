"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlaRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const context_1 = require("../rbac/context");
const ownEscape_1 = require("../rbac/ownEscape");
/**
 * §29 SLA — reads breached-SLA tasks.
 *
 * The `v_breached_sla` view is NOT workspace-scoped and lacks the
 * severity/reporter_team columns the §29 filters need, so this queries `tasks`
 * directly, replicating the view's four breach predicates (sla_due_at set + in
 * the past + not completed + not archived) and adding the optional filters. The
 * scan is supported by `idx_tasks_sla (sla_due_at, completed_at, archived_at)`.
 */
class SlaRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    async listBreached(workspaceId, filters) {
        // Compare against UTC_TIMESTAMP() (not NOW()): mysql2 stores JS Dates as
        // their UTC wall-clock, so a session time_zone other than UTC (e.g.
        // Asia/Dhaka) makes NOW() run ~6h ahead of the stored values and reports
        // not-yet-due tasks as breached. UTC_TIMESTAMP() keeps the comparison
        // UTC-vs-UTC regardless of the session timezone. (The `_post.sql`
        // v_breached_sla view uses NOW() and has this latent skew; we bypass it.)
        const conds = [
            (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId),
            (0, drizzle_orm_1.isNotNull)(schema_1.tasks.slaDueAt),
            (0, drizzle_orm_1.sql) `${schema_1.tasks.slaDueAt} < UTC_TIMESTAMP()`,
            (0, drizzle_orm_1.isNull)(schema_1.tasks.completedAt),
            (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt),
        ];
        // Team-access P5 (G7): the SAME visibility filter every task read
        // applies (undefined for unrestricted viewers → SQL unchanged today).
        // Without it, the SLA queue would keep showing the whole company to a
        // team-scoped member while the Home tile counts only their reach —
        // two screens openly disagreeing.
        const visible = await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)());
        if (visible)
            conds.push(visible);
        if (filters.severities && filters.severities.length > 0) {
            conds.push((0, drizzle_orm_1.inArray)(schema_1.tasks.bugSeverity, filters.severities));
        }
        if (filters.team) {
            if (filters.team === "engineering") {
                // "engineering" is not a reporter_team — resolve it to the
                // workspace's dev-type tasks (task_types.is_dev_type = true).
                const devTypes = await this.db
                    .select({ id: schema_1.taskTypes.id })
                    .from(schema_1.taskTypes)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskTypes.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskTypes.isDevType, true)));
                const ids = devTypes.map((r) => r.id);
                // No dev types → no engineering breaches (force an empty result).
                conds.push(ids.length > 0
                    ? (0, drizzle_orm_1.inArray)(schema_1.tasks.taskTypeId, ids)
                    : (0, drizzle_orm_1.sql) `1 = 0`);
            }
            else {
                conds.push((0, drizzle_orm_1.eq)(schema_1.tasks.reporterTeam, filters.team));
            }
        }
        const rows = await this.db
            .select({
            taskId: schema_1.tasks.id,
            customId: schema_1.tasks.customId,
            name: schema_1.tasks.name,
            taskTypeId: schema_1.tasks.taskTypeId,
            slaDueAt: schema_1.tasks.slaDueAt,
            minutesBreached: (0, drizzle_orm_1.sql) `TIMESTAMPDIFF(MINUTE, ${schema_1.tasks.slaDueAt}, UTC_TIMESTAMP())`,
        })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)(...conds))
            // Most-overdue first (oldest sla_due_at = largest minutes_breached).
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.slaDueAt));
        return rows.map((r) => ({
            taskId: r.taskId,
            customId: r.customId,
            name: r.name,
            taskTypeId: r.taskTypeId,
            slaDueAt: r.slaDueAt,
            minutesBreached: Number(r.minutesBreached),
        }));
    }
}
exports.SlaRepo = SlaRepo;
