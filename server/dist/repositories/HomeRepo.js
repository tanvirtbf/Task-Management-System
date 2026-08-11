"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const context_1 = require("../rbac/context");
const ownEscape_1 = require("../rbac/ownEscape");
const schema_1 = require("../db/schema");
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
const CLOSED_GROUPS = ["done", "closed"];
/** The grouped-by-creation-day select shared by every KPI series query. */
const DAY = (0, drizzle_orm_1.sql) `DATE_FORMAT(${schema_1.tasks.createdAt}, '%Y-%m-%d')`;
class HomeRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** myTasks: my open tasks (assignee = me, status open, not archived). */
    async myOpenSeries(workspaceId, userId) {
        return this.db
            .select({ day: DAY, cnt: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .innerJoin(schema_1.taskAssignees, (0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, CLOSED_GROUPS)))
            .groupBy(DAY);
    }
    /** dueToday: my open tasks due exactly on `today` (a `YYYY-MM-DD`). */
    async dueTodaySeries(workspaceId, userId, today) {
        return this.db
            .select({ day: DAY, cnt: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .innerJoin(schema_1.taskAssignees, (0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, CLOSED_GROUPS), (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} = ${today}`))
            .groupBy(DAY);
    }
    /** overdue: my open tasks whose due date is before `today`. */
    async overdueSeries(workspaceId, userId, today) {
        return this.db
            .select({ day: DAY, cnt: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .innerJoin(schema_1.taskAssignees, (0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, CLOSED_GROUPS), (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} < ${today}`))
            .groupBy(DAY);
    }
    /**
     * awaitingReview: completed tasks waiting on THIS person to review them —
     * as the head of the space they live in, or as their named reviewer.
     */
    async awaitingReviewSeries(workspaceId, userId) {
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
            .select({ day: DAY, cnt: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.tasks.primaryListId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.inArray)(schema_1.statuses.statusGroup, CLOSED_GROUPS), (0, drizzle_orm_1.isNull)(schema_1.tasks.reviewStatus), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.spaces.headUserId, userId), (0, drizzle_orm_1.eq)(schema_1.tasks.reviewerId, userId))))
            .groupBy(DAY);
    }
    /** openTeamTasks: every open task in the workspace (no assignee filter). */
    async openTeamSeries(workspaceId) {
        return this.db
            .select({ day: DAY, cnt: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, CLOSED_GROUPS), 
        // RBAC P19 — the two workspace-wide KPI series counted the
        // whole company for everyone; now they count what the
        // reader may actually see.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId)))
            .groupBy(DAY);
    }
    /** slaBreaches: workspace tasks past `sla_due_at`, not completed, not archived. */
    async slaBreachesSeries(workspaceId, now) {
        return this.db
            .select({ day: DAY, cnt: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.isNull)(schema_1.tasks.completedAt), (0, drizzle_orm_1.lt)(schema_1.tasks.slaDueAt, now), 
        // RBAC P19, tightened in team-access P5 (G7): the SAME
        // predicate as the SLA queue (`SlaRepo.listBreached`) —
        // scope + the own-escape — so the tile's number and the
        // queue's rows can never disagree. Undefined for
        // unrestricted viewers → SQL unchanged today.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .groupBy(DAY);
    }
    /**
     * Agenda: my open tasks due exactly on `date` (a `YYYY-MM-DD`), ordered by
     * due date then a stable internal id. Returns full task rows so the service
     * can hydrate + `toWireTask` them like any other read.
     */
    async agendaTasks(workspaceId, userId, date) {
        const rows = await this.db
            .select({ task: schema_1.tasks })
            .from(schema_1.tasks)
            .innerJoin(schema_1.taskAssignees, (0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, CLOSED_GROUPS), (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} = ${date}`))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.dueDate), (0, drizzle_orm_1.asc)(schema_1.tasks.internalId));
        return rows.map((r) => r.task);
    }
}
exports.HomeRepo = HomeRepo;
