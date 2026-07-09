import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { tasks, taskTypes, bugSeverities, reporterTeams } from "../db/schema";
import { NOW_MS } from "../db/schema/_shared";

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
        // Compare epoch-ms vs epoch-ms (was `< UTC_TIMESTAMP()` on MySQL, dodging
        // the session-timezone skew of NOW()): timestamps are stored as INTEGER
        // epoch milliseconds on SQLite, so `NOW_MS` (unixepoch-based, timezone-
        // free) keeps the comparison UTC-vs-UTC by construction.
        const conds = [
            eq(tasks.workspaceId, workspaceId),
            isNotNull(tasks.slaDueAt),
            sql`${tasks.slaDueAt} < ${NOW_MS}`,
            isNull(tasks.completedAt),
            isNull(tasks.archivedAt),
        ];

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
                // was TIMESTAMPDIFF(MINUTE, sla_due_at, UTC_TIMESTAMP()) —
                // integer division of the ms delta truncates the same way.
                minutesBreached: sql<number>`(${NOW_MS} - ${tasks.slaDueAt}) / 60000`,
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
