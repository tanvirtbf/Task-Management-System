import {
    and,
    asc,
    count,
    desc,
    eq,
    gt,
    gte,
    inArray,
    isNull,
    lt,
    notInArray,
    sql,
    type SQL,
} from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import {
    DONE_STATUS_GROUPS,
    lists,
    statuses,
    taskActivity,
    taskAssignees,
    taskReviews,
    tasks,
    type Task as TaskRow,
} from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/** The done-side status groups as an array for `inArray` (D-4 authority). */
const DONE_ARR = [...DONE_STATUS_GROUPS] as Array<
    "not_started" | "active" | "done" | "closed"
>;

export type QueueBucket =
    | "needs_review"
    | "flagged"
    | "overdue"
    | "due_today";

/** Per-member (or Unassigned, `userId: null`) summary counters. */
export interface MemberSummaryRow {
    userId: string | null;
    open: number;
    dueToday: number;
    overdue: number;
    doneUnreviewed: number;
    flagged: number;
}

export interface SummaryTotals {
    open: number;
    dueToday: number;
    overdue: number;
    doneUnreviewed: number;
    flagged: number;
}

/**
 * Data access for `task_reviews` (Dept Review V1) plus the two tiny lookups the
 * review write-path needs: the LIVE space of a task's list (invariant §2.3 —
 * bucketing never trusts the snapshot columns) and the under-lock task state
 * with its LIVE status group (the D-4 done-authority).
 */

export interface TaskReviewRecord {
    id: string;
    workspaceId: string;
    spaceId: string;
    taskId: string;
    reviewerId: string;
    status: "approved" | "flagged";
    note: string | null;
    createdAt: Date;
}

export type NewReviewInput = Omit<TaskReviewRecord, "id">;

export class ReviewsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * A list's space id + archived flag — the LIVE space derivation for a
     * task (`primary_list_id → lists.space_id`). Pass `exec` to read inside a
     * transaction.
     */
    async getListSpace(
        listId: string,
        exec: DbExecutor = this.db,
    ): Promise<{ spaceId: string; archivedAt: Date | null } | null> {
        const [row] = await exec
            .select({ spaceId: lists.spaceId, archivedAt: lists.archivedAt })
            .from(lists)
            .where(eq(lists.id, listId))
            .limit(1);
        return row ?? null;
    }

    /**
     * Task state + LIVE status group in ONE query — used for the done-check
     * both as the fast pre-check and RE-CHECKED under `TasksRepo.lockById`
     * (any concurrent status write either committed before the lock — we see
     * it — or blocks on the task row until this tx ends).
     */
    async taskStateForReview(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<{
        archivedAt: Date | null;
        completedAt: Date | null;
        statusGroup: string;
    } | null> {
        const [row] = await exec
            .select({
                archivedAt: tasks.archivedAt,
                completedAt: tasks.completedAt,
                statusGroup: statuses.statusGroup,
            })
            .from(tasks)
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .where(eq(tasks.id, taskId))
            .limit(1);
        return row ?? null;
    }

    /**
     * Append one review ACTION to the ledger. `createdAt` is the caller's
     * app-UTC instant (the column has no DB default by design — M8 rule).
     */
    /**
     * Full review history for one task, NEWEST-FIRST by `internal_id` DESC
     * (deterministic — `created_at` is only second-granular). Defensive
     * LIMIT 100: undo chains are short; a runaway history cannot flood the
     * drawer. `internal_id` is stripped before returning (never on the wire).
     */
    async listByTask(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<TaskReviewRecord[]> {
        return exec
            .select({
                id: taskReviews.id,
                workspaceId: taskReviews.workspaceId,
                spaceId: taskReviews.spaceId,
                taskId: taskReviews.taskId,
                reviewerId: taskReviews.reviewerId,
                status: taskReviews.status,
                note: taskReviews.note,
                createdAt: taskReviews.createdAt,
            })
            .from(taskReviews)
            .where(eq(taskReviews.taskId, taskId))
            .orderBy(desc(taskReviews.internalId))
            .limit(100);
    }

    async insert(
        input: NewReviewInput,
        exec: DbExecutor = this.db,
    ): Promise<TaskReviewRecord> {
        const id = fakeId("rev");
        await exec.insert(taskReviews).values({
            id,
            workspaceId: input.workspaceId,
            spaceId: input.spaceId,
            taskId: input.taskId,
            reviewerId: input.reviewerId,
            status: input.status,
            note: input.note,
            createdAt: input.createdAt,
        });
        return { id, ...input };
    }

    // ─── A-2/A-3 space-scoped traversal (Dept Review V1) ─────────────────────
    // The §5 rule-4 predicate on EVERY query below: the space's LIVE lists
    // only (`lists.archived_at IS NULL`) and live tasks (`tasks.archived_at
    // IS NULL`); done-ness = LIVE `statuses.status_group` (D-4). "Today"
    // arrives as a Dhaka-calendar `YYYY-MM-DD` bound param — never SQL
    // NOW()/CURDATE() (§5 rule 3). Tasks have no space column, so every
    // traversal joins `lists` (this is the codebase's first space-scoped task
    // query — by design, see plan §2.3 invariant).

    private bucketPredicate(bucket: QueueBucket, today: string): SQL {
        switch (bucket) {
            case "needs_review":
                return and(
                    inArray(statuses.statusGroup, DONE_ARR),
                    isNull(tasks.reviewStatus),
                ) as SQL;
            case "flagged":
                return eq(tasks.reviewStatus, "flagged");
            case "overdue":
                // NULL due_date compares NULL → excluded by SQL semantics.
                return and(
                    notInArray(statuses.statusGroup, DONE_ARR),
                    sql`${tasks.dueDate} < ${today}`,
                ) as SQL;
            case "due_today":
                return and(
                    notInArray(statuses.statusGroup, DONE_ARR),
                    sql`${tasks.dueDate} = ${today}`,
                ) as SQL;
        }
    }

    /** Member filter as EXISTS (a join would duplicate multi-assignee rows). */
    private memberExists(memberId: string): SQL {
        return sql`EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id} AND ${taskAssignees.userId} = ${memberId})`;
    }

    /**
     * One keyset page of a review-queue bucket, ordered `internal_id` ASC
     * (stable oldest-first — the head works the backlog top-down). The caller
     * passes `limit + 1` and derives `has_more` from the overflow row.
     */
    async queuePage(params: {
        spaceId: string;
        bucket: QueueBucket;
        today: string;
        memberId?: string;
        afterInternalId?: bigint;
        limit: number;
    }): Promise<TaskRow[]> {
        const conds: SQL[] = [
            isNull(tasks.archivedAt),
            this.bucketPredicate(params.bucket, params.today),
        ];
        if (params.memberId) conds.push(this.memberExists(params.memberId));
        if (params.afterInternalId !== undefined) {
            conds.push(gt(tasks.internalId, params.afterInternalId));
        }
        const rows = await this.db
            .select({ task: tasks })
            .from(tasks)
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, params.spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .where(and(...conds))
            .orderBy(asc(tasks.internalId))
            .limit(params.limit);
        return rows.map((r) => r.task);
    }

    /** Exact bucket size (the envelope's `total_estimate`). */
    async queueCount(params: {
        spaceId: string;
        bucket: QueueBucket;
        today: string;
        memberId?: string;
    }): Promise<number> {
        const conds: SQL[] = [
            isNull(tasks.archivedAt),
            this.bucketPredicate(params.bucket, params.today),
        ];
        if (params.memberId) conds.push(this.memberExists(params.memberId));
        const [row] = await this.db
            .select({ n: count() })
            .from(tasks)
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, params.spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .where(and(...conds));
        return row?.n ?? 0;
    }

    /**
     * Per-member summary counters in ONE set-based query (§5 rule 12).
     * PER-ASSIGNEE semantics (H-3): a 2-assignee task counts in both rows;
     * the LEFT JOIN's NULL group is the synthetic "Unassigned" row (H-4).
     * Cross-check `summaryTotals` for the task-level deduped numbers.
     */
    async memberSummary(
        spaceId: string,
        today: string,
    ): Promise<MemberSummaryRow[]> {
        const done = inArray(statuses.statusGroup, DONE_ARR);
        const notDone = notInArray(statuses.statusGroup, DONE_ARR);
        const rows = await this.db
            .select({
                userId: taskAssignees.userId,
                open: sql<number>`COALESCE(SUM(CASE WHEN ${notDone} THEN 1 ELSE 0 END), 0)`.mapWith(
                    Number,
                ),
                dueToday:
                    sql<number>`COALESCE(SUM(CASE WHEN ${notDone} AND ${tasks.dueDate} = ${today} THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
                overdue:
                    sql<number>`COALESCE(SUM(CASE WHEN ${notDone} AND ${tasks.dueDate} < ${today} THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
                doneUnreviewed:
                    sql<number>`COALESCE(SUM(CASE WHEN ${done} AND ${tasks.reviewStatus} IS NULL THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
                flagged:
                    sql<number>`COALESCE(SUM(CASE WHEN ${tasks.reviewStatus} = 'flagged' THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
            })
            .from(tasks)
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .leftJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
            .where(isNull(tasks.archivedAt))
            .groupBy(taskAssignees.userId);
        return rows.map((r) => ({ ...r, userId: r.userId ?? null }));
    }

    /** Task-level (deduped) totals — independent of the per-assignee rows. */
    async summaryTotals(
        spaceId: string,
        today: string,
    ): Promise<SummaryTotals> {
        const done = inArray(statuses.statusGroup, DONE_ARR);
        const notDone = notInArray(statuses.statusGroup, DONE_ARR);
        const [row] = await this.db
            .select({
                open: sql<number>`COALESCE(SUM(CASE WHEN ${notDone} THEN 1 ELSE 0 END), 0)`.mapWith(
                    Number,
                ),
                dueToday:
                    sql<number>`COALESCE(SUM(CASE WHEN ${notDone} AND ${tasks.dueDate} = ${today} THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
                overdue:
                    sql<number>`COALESCE(SUM(CASE WHEN ${notDone} AND ${tasks.dueDate} < ${today} THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
                doneUnreviewed:
                    sql<number>`COALESCE(SUM(CASE WHEN ${done} AND ${tasks.reviewStatus} IS NULL THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
                flagged:
                    sql<number>`COALESCE(SUM(CASE WHEN ${tasks.reviewStatus} = 'flagged' THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
            })
            .from(tasks)
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .where(isNull(tasks.archivedAt));
        return (
            row ?? {
                open: 0,
                dueToday: 0,
                overdue: 0,
                doneUnreviewed: 0,
                flagged: 0,
            }
        );
    }

    /**
     * Last activity instant BY each actor on the space's live tasks — the
     * A-2 "when did this member last act here" column. DB-clock domain
     * (`task_activity.created_at` has a DB default): DISPLAY-ONLY, never
     * compared against app-UTC bounds (v1.1 amendment H-7e).
     */
    async lastActivityByActors(
        spaceId: string,
        actorIds: string[],
    ): Promise<Map<string, Date>> {
        if (actorIds.length === 0) return new Map();
        const rows = await this.db
            .select({
                actorId: taskActivity.actorId,
                last: sql<Date | string>`MAX(${taskActivity.createdAt})`,
            })
            .from(taskActivity)
            .innerJoin(tasks, eq(taskActivity.taskId, tasks.id))
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .where(
                and(
                    isNull(tasks.archivedAt),
                    inArray(taskActivity.actorId, actorIds),
                ),
            )
            .groupBy(taskActivity.actorId);
        const out = new Map<string, Date>();
        for (const r of rows) {
            if (!r.actorId) continue;
            out.set(
                r.actorId,
                r.last instanceof Date ? r.last : new Date(r.last),
            );
        }
        return out;
    }

    // ─── P18 weekly-report window queries ────────────────────────────────────
    // WEEK-WINDOW rule (§3 locked semantics): filter app-UTC instants against
    // the Dhaka-week UTC bounds; keep the LIVE-list join but IGNORE
    // `tasks.archived_at` — work completed then archived in cleanup still
    // counts. "Late" = the completion's Dhaka calendar day is after due_date;
    // computed as pure +6h arithmetic (`DATE(completed_at + 6h) > due_date`)
    // — deterministic, no tz tables (BD has no DST).

    /** Per-assignee completions in the window (NULL group = Unassigned). */
    async completionsByAssignee(
        spaceId: string,
        fromUtc: Date,
        toUtcExclusive: Date,
    ): Promise<
        Array<{ userId: string | null; completed: number; completedLate: number }>
    > {
        const rows = await this.db
            .select({
                userId: taskAssignees.userId,
                completed: sql<number>`COUNT(*)`.mapWith(Number),
                completedLate:
                    sql<number>`COALESCE(SUM(CASE WHEN ${tasks.dueDate} IS NOT NULL AND DATE(DATE_ADD(${tasks.completedAt}, INTERVAL 6 HOUR)) > ${tasks.dueDate} THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
            })
            .from(tasks)
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .leftJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
            .where(
                and(
                    gte(tasks.completedAt, fromUtc),
                    lt(tasks.completedAt, toUtcExclusive),
                ),
            )
            .groupBy(taskAssignees.userId);
        return rows.map((r) => ({ ...r, userId: r.userId ?? null }));
    }

    /** Task-level (deduped) completions in the window. */
    async completionsTotals(
        spaceId: string,
        fromUtc: Date,
        toUtcExclusive: Date,
    ): Promise<{ completed: number; completedLate: number }> {
        const [row] = await this.db
            .select({
                completed: sql<number>`COUNT(*)`.mapWith(Number),
                completedLate:
                    sql<number>`COALESCE(SUM(CASE WHEN ${tasks.dueDate} IS NOT NULL AND DATE(DATE_ADD(${tasks.completedAt}, INTERVAL 6 HOUR)) > ${tasks.dueDate} THEN 1 ELSE 0 END), 0)`.mapWith(
                        Number,
                    ),
            })
            .from(tasks)
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .where(
                and(
                    gte(tasks.completedAt, fromUtc),
                    lt(tasks.completedAt, toUtcExclusive),
                ),
            );
        return row ?? { completed: 0, completedLate: 0 };
    }

    /**
     * Every review ACTION in the window on the space's tasks (live-list
     * join), oldest-first, with the task context the report's `flags[]`
     * entries need. Bounded by construction (a week of reviews).
     */
    async reviewActionsInWindow(
        spaceId: string,
        fromUtc: Date,
        toUtcExclusive: Date,
    ): Promise<
        Array<{
            reviewId: string;
            taskId: string;
            status: "approved" | "flagged";
            note: string | null;
            createdAt: Date;
            reviewerId: string;
            taskName: string;
            customId: string | null;
            parentTaskId: string | null;
        }>
    > {
        return this.db
            .select({
                reviewId: taskReviews.id,
                taskId: taskReviews.taskId,
                status: taskReviews.status,
                note: taskReviews.note,
                createdAt: taskReviews.createdAt,
                reviewerId: taskReviews.reviewerId,
                taskName: tasks.name,
                customId: tasks.customId,
                parentTaskId: tasks.parentTaskId,
            })
            .from(taskReviews)
            .innerJoin(tasks, eq(taskReviews.taskId, tasks.id))
            .innerJoin(
                lists,
                and(
                    eq(tasks.primaryListId, lists.id),
                    eq(lists.spaceId, spaceId),
                    isNull(lists.archivedAt),
                ),
            )
            .where(
                and(
                    gte(taskReviews.createdAt, fromUtc),
                    lt(taskReviews.createdAt, toUtcExclusive),
                ),
            )
            .orderBy(asc(taskReviews.internalId));
    }

    /**
     * H-2 gate for the weekly job: does the space show ANY sign of life —
     * a completion in the window, a review action in the window, or an open
     * task right now? Three cheap LIMIT-1 probes with short-circuiting, so
     * dormant departments never accumulate empty reports.
     */
    async spaceHasWindowActivity(
        spaceId: string,
        fromUtc: Date,
        toUtcExclusive: Date,
    ): Promise<boolean> {
        const liveListJoin = and(
            eq(tasks.primaryListId, lists.id),
            eq(lists.spaceId, spaceId),
            isNull(lists.archivedAt),
        );

        const completed = await this.db
            .select({ one: sql<number>`1` })
            .from(tasks)
            .innerJoin(lists, liveListJoin)
            .where(
                and(
                    gte(tasks.completedAt, fromUtc),
                    lt(tasks.completedAt, toUtcExclusive),
                ),
            )
            .limit(1);
        if (completed.length > 0) return true;

        const reviewed = await this.db
            .select({ one: sql<number>`1` })
            .from(taskReviews)
            .innerJoin(tasks, eq(taskReviews.taskId, tasks.id))
            .innerJoin(lists, liveListJoin)
            .where(
                and(
                    gte(taskReviews.createdAt, fromUtc),
                    lt(taskReviews.createdAt, toUtcExclusive),
                ),
            )
            .limit(1);
        if (reviewed.length > 0) return true;

        const open = await this.db
            .select({ one: sql<number>`1` })
            .from(tasks)
            .innerJoin(lists, liveListJoin)
            .innerJoin(statuses, eq(tasks.statusId, statuses.id))
            .where(
                and(
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, DONE_ARR),
                ),
            )
            .limit(1);
        return open.length > 0;
    }
}
