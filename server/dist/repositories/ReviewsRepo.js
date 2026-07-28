"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
/** The done-side status groups as an array for `inArray` (D-4 authority). */
const DONE_ARR = [...schema_1.DONE_STATUS_GROUPS];
class ReviewsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * A list's space id + archived flag — the LIVE space derivation for a
     * task (`primary_list_id → lists.space_id`). Pass `exec` to read inside a
     * transaction.
     */
    async getListSpace(listId, exec = this.db) {
        const [row] = await exec
            .select({ spaceId: schema_1.lists.spaceId, archivedAt: schema_1.lists.archivedAt })
            .from(schema_1.lists)
            .where((0, drizzle_orm_1.eq)(schema_1.lists.id, listId))
            .limit(1);
        return row ?? null;
    }
    /**
     * Task state + LIVE status group in ONE query — used for the done-check
     * both as the fast pre-check and RE-CHECKED under `TasksRepo.lockById`
     * (any concurrent status write either committed before the lock — we see
     * it — or blocks on the task row until this tx ends).
     */
    async taskStateForReview(taskId, exec = this.db) {
        const [row] = await exec
            .select({
            archivedAt: schema_1.tasks.archivedAt,
            completedAt: schema_1.tasks.completedAt,
            statusGroup: schema_1.statuses.statusGroup,
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId))
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
    async listByTask(taskId, exec = this.db) {
        return exec
            .select({
            id: schema_1.taskReviews.id,
            workspaceId: schema_1.taskReviews.workspaceId,
            spaceId: schema_1.taskReviews.spaceId,
            taskId: schema_1.taskReviews.taskId,
            reviewerId: schema_1.taskReviews.reviewerId,
            status: schema_1.taskReviews.status,
            note: schema_1.taskReviews.note,
            createdAt: schema_1.taskReviews.createdAt,
        })
            .from(schema_1.taskReviews)
            .where((0, drizzle_orm_1.eq)(schema_1.taskReviews.taskId, taskId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.taskReviews.internalId))
            .limit(100);
    }
    async insert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("rev");
        await exec.insert(schema_1.taskReviews).values({
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
    bucketPredicate(bucket, today) {
        switch (bucket) {
            case "needs_review":
                return (0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.statuses.statusGroup, DONE_ARR), (0, drizzle_orm_1.isNull)(schema_1.tasks.reviewStatus));
            case "flagged":
                return (0, drizzle_orm_1.eq)(schema_1.tasks.reviewStatus, "flagged");
            case "overdue":
                // NULL due_date compares NULL → excluded by SQL semantics.
                return (0, drizzle_orm_1.and)((0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, DONE_ARR), (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} < ${today}`);
            case "due_today":
                return (0, drizzle_orm_1.and)((0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, DONE_ARR), (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} = ${today}`);
        }
    }
    /** Member filter as EXISTS (a join would duplicate multi-assignee rows). */
    memberExists(memberId) {
        return (0, drizzle_orm_1.sql) `EXISTS (SELECT 1 FROM ${schema_1.taskAssignees} WHERE ${schema_1.taskAssignees.taskId} = ${schema_1.tasks.id} AND ${schema_1.taskAssignees.userId} = ${memberId})`;
    }
    /**
     * One keyset page of a review-queue bucket, ordered `internal_id` ASC
     * (stable oldest-first — the head works the backlog top-down). The caller
     * passes `limit + 1` and derives `has_more` from the overflow row.
     */
    async queuePage(params) {
        const conds = [
            (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt),
            this.bucketPredicate(params.bucket, params.today),
        ];
        if (params.memberId)
            conds.push(this.memberExists(params.memberId));
        if (params.afterInternalId !== undefined) {
            conds.push((0, drizzle_orm_1.gt)(schema_1.tasks.internalId, params.afterInternalId));
        }
        const rows = await this.db
            .select({ task: schema_1.tasks })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, params.spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .where((0, drizzle_orm_1.and)(...conds))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.internalId))
            .limit(params.limit);
        return rows.map((r) => r.task);
    }
    /** Exact bucket size (the envelope's `total_estimate`). */
    async queueCount(params) {
        const conds = [
            (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt),
            this.bucketPredicate(params.bucket, params.today),
        ];
        if (params.memberId)
            conds.push(this.memberExists(params.memberId));
        const [row] = await this.db
            .select({ n: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, params.spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .where((0, drizzle_orm_1.and)(...conds));
        return row?.n ?? 0;
    }
    /**
     * Per-member summary counters in ONE set-based query (§5 rule 12).
     * PER-ASSIGNEE semantics (H-3): a 2-assignee task counts in both rows;
     * the LEFT JOIN's NULL group is the synthetic "Unassigned" row (H-4).
     * Cross-check `summaryTotals` for the task-level deduped numbers.
     */
    async memberSummary(spaceId, today) {
        const done = (0, drizzle_orm_1.inArray)(schema_1.statuses.statusGroup, DONE_ARR);
        const notDone = (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, DONE_ARR);
        const rows = await this.db
            .select({
            userId: schema_1.taskAssignees.userId,
            open: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${notDone} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            dueToday: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${notDone} AND ${schema_1.tasks.dueDate} = ${today} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            overdue: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${notDone} AND ${schema_1.tasks.dueDate} < ${today} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            doneUnreviewed: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${done} AND ${schema_1.tasks.reviewStatus} IS NULL THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            flagged: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.tasks.reviewStatus} = 'flagged' THEN 1 ELSE 0 END), 0)`.mapWith(Number),
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .leftJoin(schema_1.taskAssignees, (0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id))
            .where((0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt))
            .groupBy(schema_1.taskAssignees.userId);
        return rows.map((r) => ({ ...r, userId: r.userId ?? null }));
    }
    /** Task-level (deduped) totals — independent of the per-assignee rows. */
    async summaryTotals(spaceId, today) {
        const done = (0, drizzle_orm_1.inArray)(schema_1.statuses.statusGroup, DONE_ARR);
        const notDone = (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, DONE_ARR);
        const [row] = await this.db
            .select({
            open: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${notDone} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            dueToday: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${notDone} AND ${schema_1.tasks.dueDate} = ${today} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            overdue: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${notDone} AND ${schema_1.tasks.dueDate} < ${today} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            doneUnreviewed: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${done} AND ${schema_1.tasks.reviewStatus} IS NULL THEN 1 ELSE 0 END), 0)`.mapWith(Number),
            flagged: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.tasks.reviewStatus} = 'flagged' THEN 1 ELSE 0 END), 0)`.mapWith(Number),
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .where((0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt));
        return (row ?? {
            open: 0,
            dueToday: 0,
            overdue: 0,
            doneUnreviewed: 0,
            flagged: 0,
        });
    }
    /**
     * Last activity instant BY each actor on the space's live tasks — the
     * A-2 "when did this member last act here" column. DB-clock domain
     * (`task_activity.created_at` has a DB default): DISPLAY-ONLY, never
     * compared against app-UTC bounds (v1.1 amendment H-7e).
     */
    async lastActivityByActors(spaceId, actorIds) {
        if (actorIds.length === 0)
            return new Map();
        const rows = await this.db
            .select({
            actorId: schema_1.taskActivity.actorId,
            last: (0, drizzle_orm_1.sql) `MAX(${schema_1.taskActivity.createdAt})`,
        })
            .from(schema_1.taskActivity)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.taskActivity.taskId, schema_1.tasks.id))
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.inArray)(schema_1.taskActivity.actorId, actorIds)))
            .groupBy(schema_1.taskActivity.actorId);
        const out = new Map();
        for (const r of rows) {
            if (!r.actorId)
                continue;
            out.set(r.actorId, r.last instanceof Date ? r.last : new Date(r.last));
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
    async completionsByAssignee(spaceId, fromUtc, toUtcExclusive) {
        const rows = await this.db
            .select({
            userId: schema_1.taskAssignees.userId,
            completed: (0, drizzle_orm_1.sql) `COUNT(*)`.mapWith(Number),
            completedLate: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.tasks.dueDate} IS NOT NULL AND DATE(DATE_ADD(${schema_1.tasks.completedAt}, INTERVAL 6 HOUR)) > ${schema_1.tasks.dueDate} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .leftJoin(schema_1.taskAssignees, (0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.tasks.completedAt, fromUtc), (0, drizzle_orm_1.lt)(schema_1.tasks.completedAt, toUtcExclusive)))
            .groupBy(schema_1.taskAssignees.userId);
        return rows.map((r) => ({ ...r, userId: r.userId ?? null }));
    }
    /** Task-level (deduped) completions in the window. */
    async completionsTotals(spaceId, fromUtc, toUtcExclusive) {
        const [row] = await this.db
            .select({
            completed: (0, drizzle_orm_1.sql) `COUNT(*)`.mapWith(Number),
            completedLate: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.tasks.dueDate} IS NOT NULL AND DATE(DATE_ADD(${schema_1.tasks.completedAt}, INTERVAL 6 HOUR)) > ${schema_1.tasks.dueDate} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.tasks.completedAt, fromUtc), (0, drizzle_orm_1.lt)(schema_1.tasks.completedAt, toUtcExclusive)));
        return row ?? { completed: 0, completedLate: 0 };
    }
    /**
     * Every review ACTION in the window on the space's tasks (live-list
     * join), oldest-first, with the task context the report's `flags[]`
     * entries need. Bounded by construction (a week of reviews).
     */
    async reviewActionsInWindow(spaceId, fromUtc, toUtcExclusive) {
        return this.db
            .select({
            reviewId: schema_1.taskReviews.id,
            taskId: schema_1.taskReviews.taskId,
            status: schema_1.taskReviews.status,
            note: schema_1.taskReviews.note,
            createdAt: schema_1.taskReviews.createdAt,
            reviewerId: schema_1.taskReviews.reviewerId,
            taskName: schema_1.tasks.name,
            customId: schema_1.tasks.customId,
            parentTaskId: schema_1.tasks.parentTaskId,
        })
            .from(schema_1.taskReviews)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.taskReviews.taskId, schema_1.tasks.id))
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.taskReviews.createdAt, fromUtc), (0, drizzle_orm_1.lt)(schema_1.taskReviews.createdAt, toUtcExclusive)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.taskReviews.internalId));
    }
    /**
     * H-2 gate for the weekly job: does the space show ANY sign of life —
     * a completion in the window, a review action in the window, or an open
     * task right now? Three cheap LIMIT-1 probes with short-circuiting, so
     * dormant departments never accumulate empty reports.
     */
    async spaceHasWindowActivity(spaceId, fromUtc, toUtcExclusive) {
        const liveListJoin = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, schema_1.lists.id), (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt));
        const completed = await this.db
            .select({ one: (0, drizzle_orm_1.sql) `1` })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, liveListJoin)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.tasks.completedAt, fromUtc), (0, drizzle_orm_1.lt)(schema_1.tasks.completedAt, toUtcExclusive)))
            .limit(1);
        if (completed.length > 0)
            return true;
        const reviewed = await this.db
            .select({ one: (0, drizzle_orm_1.sql) `1` })
            .from(schema_1.taskReviews)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.taskReviews.taskId, schema_1.tasks.id))
            .innerJoin(schema_1.lists, liveListJoin)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.taskReviews.createdAt, fromUtc), (0, drizzle_orm_1.lt)(schema_1.taskReviews.createdAt, toUtcExclusive)))
            .limit(1);
        if (reviewed.length > 0)
            return true;
        const open = await this.db
            .select({ one: (0, drizzle_orm_1.sql) `1` })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, liveListJoin)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, DONE_ARR)))
            .limit(1);
        return open.length > 0;
    }
}
exports.ReviewsRepo = ReviewsRepo;
