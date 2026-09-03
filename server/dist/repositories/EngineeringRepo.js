"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineeringRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const dhakaTime_1 = require("../utils/dhakaTime");
const context_1 = require("../rbac/context");
const ownEscape_1 = require("../rbac/ownEscape");
/** Status groups that count as "closed work" — excluded from the open rollups. */
const DONE_GROUPS = ["done", "closed"];
/** A ticket untouched for this many days counts as stale on the Eng Home. */
const STALE_DAYS = 14;
/**
 * §22 Engineering specials — data access.
 *
 * §22 deliberately resolves the "Bug" / "Incident" task types and the "Bug
 * Triage" list BY NAME, scoped to the workspace — NOT by the literal ids
 * (`tt-bug`, `tt-incident`, `l-bug-triage`) the `_post.sql` views hardcode.
 * Those literal-id views never match `fakeId()`-generated rows and are not
 * workspace-scoped, so this repo queries the base tables directly instead.
 */
class EngineeringRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    // ─── #1 report-bug + shared resolvers ────────────────────────────────────
    /**
     * The workspace's "Bug" task type id (case-insensitive name match), or null.
     * Matching by name keeps SLA firing consistent: `TaskWriteService.create`
     * computes the §29 SLA from `task_types.name === "bug"`.
     */
    async findBugTaskTypeId(workspaceId) {
        return this.findTaskTypeIdByName(workspaceId, "bug");
    }
    /** The workspace's "Incident" task type id (case-insensitive), or null. */
    async findIncidentTaskTypeId(workspaceId) {
        return this.findTaskTypeIdByName(workspaceId, "incident");
    }
    async findTaskTypeIdByName(workspaceId, lowerName) {
        const rows = await this.db
            .select({ id: schema_1.taskTypes.id })
            .from(schema_1.taskTypes)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskTypes.workspaceId, workspaceId), (0, drizzle_orm_1.sql) `lower(${schema_1.taskTypes.name}) = ${lowerName}`))
            .limit(1);
        return rows[0]?.id ?? null;
    }
    /**
     * The workspace's non-archived "Bug Triage" list (case-insensitive name
     * match), or null. `lists` has no `workspace_id`, so isolation rides the
     * `lists → spaces.workspace_id` join.
     *
     * Returns the list's `spaceId` too (F28): the report-bug intake principal
     * is narrowed to the space that owns this list, and the join already has it.
     */
    async findBugTriageList(workspaceId) {
        const rows = await this.db
            .select({ id: schema_1.lists.id, spaceId: schema_1.lists.spaceId })
            .from(schema_1.lists)
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, schema_1.spaces.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt), (0, drizzle_orm_1.sql) `lower(${schema_1.lists.name}) = 'bug triage'`))
            .orderBy(schema_1.lists.createdAt)
            .limit(1);
        return rows[0] ?? null;
    }
    /**
     * The id of the ACTIVE engineer on call this week in the workspace, or null.
     * "This week" = today within `[week_start, week_end]`; the most recent
     * matching shift wins. Filtering to `status = 'active'` avoids handing an
     * assignment to a deactivated user (which `create()` would reject as 422).
     *
     * "Today" is `dhakaToday()`, bound as a parameter, not SQL `CURDATE()` —
     * see the matching note on `OnCallRepo.findCurrent` for why (F3 pinned the
     * MySQL session to UTC; these are Dhaka business-day DATE columns). Both
     * paths must agree or a bug's auto-assignee and the on-call board diverge.
     */
    async findCurrentOnCallEngineerId(workspaceId) {
        const rows = await this.db
            .select({ engineerId: schema_1.onCallShifts.engineerId })
            .from(schema_1.onCallShifts)
            .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.onCallShifts.engineerId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.onCallShifts.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.users.status, "active"), (0, drizzle_orm_1.sql) `${(0, dhakaTime_1.dhakaToday)()} BETWEEN ${schema_1.onCallShifts.weekStart} AND ${schema_1.onCallShifts.weekEnd}`))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.onCallShifts.weekStart))
            .limit(1);
        return rows[0]?.engineerId ?? null;
    }
    /**
     * The head of a space — the person a report belongs to when nobody is on
     * call.
     *
     * Added because the on-call rota is a rota: it runs out. When it had, a
     * bug report landed in Bug Triage assigned to nobody and notified nobody,
     * including an S0 'site down'. The Engineering space head is the standing
     * owner who routes what the pager did not catch.
     *
     * `status = 'active'` for the same reason `findCurrentOnCallEngineerId`
     * filters on it: `create()` rejects an inactive assignee with a 422, which
     * would turn 'nobody was told' into 'the report could not be filed at all'.
     */
    async findSpaceHeadId(spaceId) {
        const rows = await this.db
            .select({ headUserId: schema_1.spaces.headUserId })
            .from(schema_1.spaces)
            .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.spaces.headUserId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.id, spaceId), (0, drizzle_orm_1.eq)(schema_1.users.status, "active")))
            .limit(1);
        return rows[0]?.headUserId ?? null;
    }
    // ─── #2 eng-home rollups ─────────────────────────────────────────────────
    /** The workspace's active sprint (most recent start), or null. */
    async activeSprint(workspaceId) {
        const rows = await this.db
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.sprints.status, "active")))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.sprints.startDate))
            .limit(1);
        return rows[0] ?? null;
    }
    /**
     * Total + the newest `topLimit` ids of OPEN tasks of one type the CALLER
     * CAN SEE (open = status_group ∉ done/closed, not archived). Reused for the
     * open-bugs and open-incidents tiles.
     *
     * KI-14: this used to filter on workspace and type alone, while the preview
     * ids beside the count were hydrated through a scoped read. A user clamped
     * to one team therefore got the whole workspace's number next to a list
     * that excluded most of it — the count was a leak of Engineering's open-bug
     * volume to every team, and the count/preview disagreement was how it
     * showed. The visibility predicate is now the same one the hydrator applies,
     * so the tile is a single consistent claim.
     */
    async openCountAndTopByType(workspaceId, taskTypeId, topLimit) {
        const where = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.tasks.taskTypeId, taskTypeId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, [...DONE_GROUPS]), await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)()));
        const [c] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where(where);
        const rows = await this.db
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where(where)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.tasks.createdAt))
            .limit(topLimit);
        return { count: c?.value ?? 0, topIds: rows.map((r) => r.id) };
    }
    /**
     * Ids of the caller's active-sprint tasks (assigned to them, not archived),
     * newest first. The `task_assignees` PK is `(task_id, user_id)`, so the join
     * is 1:1 for one user — no fan-out, no DISTINCT needed.
     */
    async mySprintTaskIds(workspaceId, sprintId, userId, limit) {
        const rows = await this.db
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .innerJoin(schema_1.taskAssignees, (0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.tasks.sprintId, sprintId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, userId)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.tasks.createdAt))
            .limit(limit);
        return rows.map((r) => r.id);
    }
    /**
     * Ids of tasks where the caller is the reviewer and a PR is awaiting review
     * (`pr_status ∈ {open, draft}`), not archived, most-recently-updated first.
     * Backed by the `idx_tasks_reviewer (reviewer_id, pr_status)` index.
     */
    async prsAwaitingMeIds(workspaceId, userId, limit) {
        const rows = await this.db
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.tasks.reviewerId, userId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.inArray)(schema_1.tasks.prStatus, ["open", "draft"])))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.tasks.updatedAt))
            .limit(limit);
        return rows.map((r) => r.id);
    }
    /**
     * Ids of OPEN workspace tasks untouched for > STALE_DAYS, most-stale first.
     * The staleness window is doc-silent; STALE_DAYS (14) is the documented
     * default. Evaluated DB-side (`NOW()`) to avoid app/DB clock skew.
     */
    async staleTicketIds(workspaceId, limit) {
        const rows = await this.db
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, [...DONE_GROUPS]), (0, drizzle_orm_1.sql) `${schema_1.tasks.updatedAt} < (NOW() - INTERVAL ${drizzle_orm_1.sql.raw(String(STALE_DAYS))} DAY)`, 
        // Same predicate as the hydrator (KI-14's family). Invisible
        // rows were already dropped downstream, but the LIMIT was
        // spent on them first — oldest-first, so another team's
        // ancient tickets could push the caller's own out of a
        // bucket that then looked empty.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.updatedAt))
            .limit(limit);
        return rows.map((r) => r.id);
    }
    // ─── #3 postmortem ───────────────────────────────────────────────────────
    /**
     * Resolve a task by internal id within the workspace, returning just the
     * signals the postmortem rules need: the task-type name and the status group.
     * Null when the id is absent or in another workspace (no cross-tenant oracle).
     */
    async findIncidentTaskState(taskId, workspaceId) {
        const rows = await this.db
            .select({
            id: schema_1.tasks.id,
            typeName: schema_1.taskTypes.name,
            statusGroup: schema_1.statuses.statusGroup,
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.taskTypes, (0, drizzle_orm_1.eq)(schema_1.taskTypes.id, schema_1.tasks.taskTypeId))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)))
            .limit(1);
        return rows[0] ?? null;
    }
    /**
     * Insert-or-update the postmortem for a task (PK = `task_id`), so a re-submit
     * replaces the prior checklist state and bumps `updated_at`/`updated_by`.
     */
    async upsertPostmortem(taskId, items, updatedBy, exec = this.db) {
        await exec
            .insert(schema_1.taskPostmortems)
            .values({ taskId, items, updatedBy })
            .onDuplicateKeyUpdate({ set: { items, updatedBy } });
    }
    /** Read the stored postmortem for a task, or null if none exists yet. */
    async findPostmortem(taskId) {
        const rows = await this.db
            .select()
            .from(schema_1.taskPostmortems)
            .where((0, drizzle_orm_1.eq)(schema_1.taskPostmortems.taskId, taskId))
            .limit(1);
        return rows[0] ?? null;
    }
}
exports.EngineeringRepo = EngineeringRepo;
