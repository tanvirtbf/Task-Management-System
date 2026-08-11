import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { tasks, taskTypes, bugSeverities, reporterTeams } from "../db/schema";
import { listScopeFilter } from "../rbac/context";
import { taskOwnEscape } from "../rbac/ownEscape";

type BugSeverity = (typeof bugSeverities)[number];
type ReporterTeam = (typeof reporterTeams)[number];

export interface BreachFilters {
    /** A subset of bug_severity values (S0..S3). */
    severities?: string[];
    /** A reporter_team value, or "engineering" (→ dev-type tasks). */
    team?: string;
}

export interface BreachRow {
    taskId: string;
    customId: string | null;
    name: string;
    taskTypeId: string;
    slaDueAt: Date;
    minutesBreached: number;
}

/**
 * §29 SLA — reads breached-SLA tasks.
 *
 * The `v_breached_sla` view is NOT workspace-scoped and lacks the
 * severity/reporter_team columns the §29 filters need, so this queries `tasks`
 * directly, replicating the view's four breach predicates (sla_due_at set + in
 * the past + not completed + not archived) and adding the optional filters. The
 * scan is supported by `idx_tasks_sla (sla_due_at, completed_at, archived_at)`.
 */
export class SlaRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    async listBreached(
        workspaceId: string,
        filters: BreachFilters,
    ): Promise<BreachRow[]> {
        // Compare against UTC_TIMESTAMP() (not NOW()): mysql2 stores JS Dates as
        // their UTC wall-clock, so a session time_zone other than UTC (e.g.
        // Asia/Dhaka) makes NOW() run ~6h ahead of the stored values and reports
        // not-yet-due tasks as breached. UTC_TIMESTAMP() keeps the comparison
        // UTC-vs-UTC regardless of the session timezone. (The `_post.sql`
        // v_breached_sla view uses NOW() and has this latent skew; we bypass it.)
        const conds = [
            eq(tasks.workspaceId, workspaceId),
            isNotNull(tasks.slaDueAt),
            sql`${tasks.slaDueAt} < UTC_TIMESTAMP()`,
            isNull(tasks.completedAt),
            isNull(tasks.archivedAt),
        ];

        // Team-access P5 (G7): the SAME visibility filter every task read
        // applies (undefined for unrestricted viewers → SQL unchanged today).
        // Without it, the SLA queue would keep showing the whole company to a
        // team-scoped member while the Home tile counts only their reach —
        // two screens openly disagreeing.
        const visible = await listScopeFilter(
            tasks.primaryListId,
            await taskOwnEscape(),
        );
        if (visible) conds.push(visible);

        if (filters.severities && filters.severities.length > 0) {
            conds.push(
                inArray(tasks.bugSeverity, filters.severities as BugSeverity[]),
            );
        }

        if (filters.team) {
            if (filters.team === "engineering") {
                // "engineering" is not a reporter_team — resolve it to the
                // workspace's dev-type tasks (task_types.is_dev_type = true).
                const devTypes = await this.db
                    .select({ id: taskTypes.id })
                    .from(taskTypes)
                    .where(
                        and(
                            eq(taskTypes.workspaceId, workspaceId),
                            eq(taskTypes.isDevType, true),
                        ),
                    );
                const ids = devTypes.map((r) => r.id);
                // No dev types → no engineering breaches (force an empty result).
                conds.push(
                    ids.length > 0
                        ? inArray(tasks.taskTypeId, ids)
                        : sql`1 = 0`,
                );
            } else {
                conds.push(
                    eq(tasks.reporterTeam, filters.team as ReporterTeam),
                );
            }
        }

        const rows = await this.db
            .select({
                taskId: tasks.id,
                customId: tasks.customId,
                name: tasks.name,
                taskTypeId: tasks.taskTypeId,
                slaDueAt: tasks.slaDueAt,
                minutesBreached: sql<number>`TIMESTAMPDIFF(MINUTE, ${tasks.slaDueAt}, UTC_TIMESTAMP())`,
            })
            .from(tasks)
            .where(and(...conds))
            // Most-overdue first (oldest sla_due_at = largest minutes_breached).
            .orderBy(asc(tasks.slaDueAt));

        return rows.map((r) => ({
            taskId: r.taskId,
            customId: r.customId,
            name: r.name,
            taskTypeId: r.taskTypeId,
            slaDueAt: r.slaDueAt as Date,
            minutesBreached: Number(r.minutesBreached),
        }));
    }
}
