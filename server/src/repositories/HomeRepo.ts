import {
    and,
    asc,
    count,
    eq,
    inArray,
    isNull,
    lt,
    notInArray,
    or,
    sql,
} from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { listScopeFilter } from "../rbac/context";
import { taskOwnEscape } from "../rbac/ownEscape";
import { lists, spaces, statuses, taskAssignees, tasks } from "../db/schema";
import type { Task as TaskRow } from "../db/schema";

/**
 * §25 Home data access. Owns the workspace-scoped aggregate queries behind the
 * 6 KPI tiles and the agenda. Self-contained: it does NOT touch the other
 * features' repos (the agenda hydration reuses `TasksRepo` separately, read-only).
 *
 * "Open" = the task's status is not in a done/closed group; "my" = the caller
 * is an assignee (`task_assignees` junction). Each KPI series query buckets the
 * KPI's filtered task set by `DATE(created_at)` — the §25-blessed sparkline
 * technique — returning one `{ day, cnt }` row per creation day; the service
 * folds that into a 7-day sparkline (and sums it for the total value).
 */

/** statusGroups that count as NOT open. */
const CLOSED_GROUPS: Array<"done" | "closed"> = ["done", "closed"];

/** A creation-day count: `cnt` tasks (in the KPI's set) were created on `day`. */
export interface DayCount {
    /** `YYYY-MM-DD` (server-local, via DATE_FORMAT). */
    day: string;
    cnt: number;
}

/** The grouped-by-creation-day select shared by every KPI series query. */
const DAY = sql<string>`DATE_FORMAT(${tasks.createdAt}, '%Y-%m-%d')`;

export class HomeRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** myTasks: my open tasks (assignee = me, status open, not archived). */
    async myOpenSeries(workspaceId: string, userId: string): Promise<DayCount[]> {
        return this.db
            .select({ day: DAY, cnt: count() })
            .from(tasks)
            .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    eq(taskAssignees.userId, userId),
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, CLOSED_GROUPS),
                ),
            )
            .groupBy(DAY);
    }

    /** dueToday: my open tasks due exactly on `today` (a `YYYY-MM-DD`). */
    async dueTodaySeries(
        workspaceId: string,
        userId: string,
        today: string,
    ): Promise<DayCount[]> {
        return this.db
            .select({ day: DAY, cnt: count() })
            .from(tasks)
            .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    eq(taskAssignees.userId, userId),
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, CLOSED_GROUPS),
                    sql`${tasks.dueDate} = ${today}`,
                ),
            )
            .groupBy(DAY);
    }

    /** overdue: my open tasks whose due date is before `today`. */
    async overdueSeries(
        workspaceId: string,
        userId: string,
        today: string,
    ): Promise<DayCount[]> {
        return this.db
            .select({ day: DAY, cnt: count() })
            .from(tasks)
            .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    eq(taskAssignees.userId, userId),
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, CLOSED_GROUPS),
                    sql`${tasks.dueDate} < ${today}`,
                ),
            )
            .groupBy(DAY);
    }

    /**
     * awaitingReview: completed tasks waiting on THIS person to review them —
     * as the head of the space they live in, or as their named reviewer.
     */
    async awaitingReviewSeries(
        workspaceId: string,
        userId: string,
    ): Promise<DayCount[]> {
        // F24 (ISS-059): count the review queue THIS COMPANY uses.
        //
        // It used to count `pr_status = 'open'` — the GitHub pull-request
        // field, NULL on every one of the 51 live tasks, so the tile read 0
        // for everyone forever. Meanwhile the review workflow the product
        // actually shipped (a department head approves or flags a completed
        // task) had 11 tasks genuinely waiting.
        //
        // "Waiting on me" = a COMPLETED task, not yet reviewed
        // (`review_status IS NULL` — the enum has no pending state; a row
        // exists only once the head has acted), in a space THIS USER HEADS.
        // The per-task `reviewer_id` arm is kept: an explicitly named reviewer
        // is also waiting on that person. Either arm counts.
        return this.db
            .select({ day: DAY, cnt: count() })
            .from(tasks)
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .innerJoin(lists, eq(lists.id, tasks.primaryListId))
            .innerJoin(spaces, eq(spaces.id, lists.spaceId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    inArray(statuses.statusGroup, CLOSED_GROUPS),
                    isNull(tasks.reviewStatus),
                    or(
                        eq(spaces.headUserId, userId),
                        eq(tasks.reviewerId, userId),
                    ),
                ),
            )
            .groupBy(DAY);
    }

    /** openTeamTasks: every open task in the workspace (no assignee filter). */
    async openTeamSeries(workspaceId: string): Promise<DayCount[]> {
        return this.db
            .select({ day: DAY, cnt: count() })
            .from(tasks)
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, CLOSED_GROUPS),
                    // RBAC P19 — the two workspace-wide KPI series counted the
                    // whole company for everyone; now they count what the
                    // reader may actually see.
                    await listScopeFilter(tasks.primaryListId),
                ),
            )
            .groupBy(DAY);
    }

    /** slaBreaches: workspace tasks past `sla_due_at`, not completed, not archived. */
    async slaBreachesSeries(
        workspaceId: string,
        now: Date,
    ): Promise<DayCount[]> {
        return this.db
            .select({ day: DAY, cnt: count() })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    isNull(tasks.completedAt),
                    lt(tasks.slaDueAt, now),
                    // RBAC P19, tightened in team-access P5 (G7): the SAME
                    // predicate as the SLA queue (`SlaRepo.listBreached`) —
                    // scope + the own-escape — so the tile's number and the
                    // queue's rows can never disagree. Undefined for
                    // unrestricted viewers → SQL unchanged today.
                    await listScopeFilter(
                        tasks.primaryListId,
                        await taskOwnEscape(),
                    ),
                ),
            )
            .groupBy(DAY);
    }

    /**
     * Agenda: my open tasks due exactly on `date` (a `YYYY-MM-DD`), ordered by
     * due date then a stable internal id. Returns full task rows so the service
     * can hydrate + `toWireTask` them like any other read.
     */
    async agendaTasks(
        workspaceId: string,
        userId: string,
        date: string,
    ): Promise<TaskRow[]> {
        const rows = await this.db
            .select({ task: tasks })
            .from(tasks)
            .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    eq(taskAssignees.userId, userId),
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, CLOSED_GROUPS),
                    sql`${tasks.dueDate} = ${date}`,
                ),
            )
            .orderBy(asc(tasks.dueDate), asc(tasks.internalId));
        return rows.map((r) => r.task);
    }
}
