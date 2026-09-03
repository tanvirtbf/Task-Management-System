import {
    and,
    asc,
    count,
    desc,
    eq,
    inArray,
    isNull,
    notInArray,
    sql,
} from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import {
    taskTypes,
    lists,
    spaces,
    onCallShifts,
    users,
    tasks,
    statuses,
    taskAssignees,
    sprints,
    taskPostmortems,
    type Sprint,
    type TaskPostmortem,
} from "../db/schema";
import { dhakaToday } from "../utils/dhakaTime";
import { listScopeFilter } from "../rbac/context";
import { taskOwnEscape } from "../rbac/ownEscape";
import type { DbExecutor } from "./types";

/** Status groups that count as "closed work" — excluded from the open rollups. */
const DONE_GROUPS = ["done", "closed"] as const;
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
export class EngineeringRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    // ─── #1 report-bug + shared resolvers ────────────────────────────────────

    /**
     * The workspace's "Bug" task type id (case-insensitive name match), or null.
     * Matching by name keeps SLA firing consistent: `TaskWriteService.create`
     * computes the §29 SLA from `task_types.name === "bug"`.
     */
    async findBugTaskTypeId(workspaceId: string): Promise<string | null> {
        return this.findTaskTypeIdByName(workspaceId, "bug");
    }

    /** The workspace's "Incident" task type id (case-insensitive), or null. */
    async findIncidentTaskTypeId(workspaceId: string): Promise<string | null> {
        return this.findTaskTypeIdByName(workspaceId, "incident");
    }

    private async findTaskTypeIdByName(
        workspaceId: string,
        lowerName: string,
    ): Promise<string | null> {
        const rows = await this.db
            .select({ id: taskTypes.id })
            .from(taskTypes)
            .where(
                and(
                    eq(taskTypes.workspaceId, workspaceId),
                    sql`lower(${taskTypes.name}) = ${lowerName}`,
                ),
            )
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
    async findBugTriageList(
        workspaceId: string,
    ): Promise<{ id: string; spaceId: string } | null> {
        const rows = await this.db
            .select({ id: lists.id, spaceId: lists.spaceId })
            .from(lists)
            .innerJoin(spaces, eq(lists.spaceId, spaces.id))
            .where(
                and(
                    eq(spaces.workspaceId, workspaceId),
                    isNull(lists.archivedAt),
                    sql`lower(${lists.name}) = 'bug triage'`,
                ),
            )
            .orderBy(lists.createdAt)
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
    async findCurrentOnCallEngineerId(
        workspaceId: string,
    ): Promise<string | null> {
        const rows = await this.db
            .select({ engineerId: onCallShifts.engineerId })
            .from(onCallShifts)
            .innerJoin(users, eq(users.id, onCallShifts.engineerId))
            .where(
                and(
                    eq(onCallShifts.workspaceId, workspaceId),
                    eq(users.status, "active"),
                    sql`${dhakaToday()} BETWEEN ${onCallShifts.weekStart} AND ${onCallShifts.weekEnd}`,
                ),
            )
            .orderBy(desc(onCallShifts.weekStart))
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
    async findSpaceHeadId(spaceId: string): Promise<string | null> {
        const rows = await this.db
            .select({ headUserId: spaces.headUserId })
            .from(spaces)
            .innerJoin(users, eq(users.id, spaces.headUserId))
            .where(and(eq(spaces.id, spaceId), eq(users.status, "active")))
            .limit(1);
        return rows[0]?.headUserId ?? null;
    }

    // ─── #2 eng-home rollups ─────────────────────────────────────────────────

    /** The workspace's active sprint (most recent start), or null. */
    async activeSprint(workspaceId: string): Promise<Sprint | null> {
        const rows = await this.db
            .select()
            .from(sprints)
            .where(
                and(
                    eq(sprints.workspaceId, workspaceId),
                    eq(sprints.status, "active"),
                ),
            )
            .orderBy(desc(sprints.startDate))
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
    async openCountAndTopByType(
        workspaceId: string,
        taskTypeId: string,
        topLimit: number,
    ): Promise<{ count: number; topIds: string[] }> {
        const where = and(
            eq(tasks.workspaceId, workspaceId),
            eq(tasks.taskTypeId, taskTypeId),
            isNull(tasks.archivedAt),
            notInArray(statuses.statusGroup, [...DONE_GROUPS]),
            await listScopeFilter(tasks.primaryListId, await taskOwnEscape()),
        );
        const [c] = await this.db
            .select({ value: count() })
            .from(tasks)
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(where);
        const rows = await this.db
            .select({ id: tasks.id })
            .from(tasks)
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(where)
            .orderBy(desc(tasks.createdAt))
            .limit(topLimit);
        return { count: c?.value ?? 0, topIds: rows.map((r) => r.id) };
    }

    /**
     * Ids of the caller's active-sprint tasks (assigned to them, not archived),
     * newest first. The `task_assignees` PK is `(task_id, user_id)`, so the join
     * is 1:1 for one user — no fan-out, no DISTINCT needed.
     */
    async mySprintTaskIds(
        workspaceId: string,
        sprintId: string,
        userId: string,
        limit: number,
    ): Promise<string[]> {
        const rows = await this.db
            .select({ id: tasks.id })
            .from(tasks)
            .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    eq(tasks.sprintId, sprintId),
                    isNull(tasks.archivedAt),
                    eq(taskAssignees.userId, userId),
                ),
            )
            .orderBy(desc(tasks.createdAt))
            .limit(limit);
        return rows.map((r) => r.id);
    }

    /**
     * Ids of tasks where the caller is the reviewer and a PR is awaiting review
     * (`pr_status ∈ {open, draft}`), not archived, most-recently-updated first.
     * Backed by the `idx_tasks_reviewer (reviewer_id, pr_status)` index.
     */
    async prsAwaitingMeIds(
        workspaceId: string,
        userId: string,
        limit: number,
    ): Promise<string[]> {
        const rows = await this.db
            .select({ id: tasks.id })
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    eq(tasks.reviewerId, userId),
                    isNull(tasks.archivedAt),
                    inArray(tasks.prStatus, ["open", "draft"]),
                ),
            )
            .orderBy(desc(tasks.updatedAt))
            .limit(limit);
        return rows.map((r) => r.id);
    }

    /**
     * Ids of OPEN workspace tasks untouched for > STALE_DAYS, most-stale first.
     * The staleness window is doc-silent; STALE_DAYS (14) is the documented
     * default. Evaluated DB-side (`NOW()`) to avoid app/DB clock skew.
     */
    async staleTicketIds(
        workspaceId: string,
        limit: number,
    ): Promise<string[]> {
        const rows = await this.db
            .select({ id: tasks.id })
            .from(tasks)
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                    notInArray(statuses.statusGroup, [...DONE_GROUPS]),
                    sql`${tasks.updatedAt} < (NOW() - INTERVAL ${sql.raw(String(STALE_DAYS))} DAY)`,
                    // Same predicate as the hydrator (KI-14's family). Invisible
                    // rows were already dropped downstream, but the LIMIT was
                    // spent on them first — oldest-first, so another team's
                    // ancient tickets could push the caller's own out of a
                    // bucket that then looked empty.
                    await listScopeFilter(tasks.primaryListId, await taskOwnEscape()),
                ),
            )
            .orderBy(asc(tasks.updatedAt))
            .limit(limit);
        return rows.map((r) => r.id);
    }

    // ─── #3 postmortem ───────────────────────────────────────────────────────

    /**
     * Resolve a task by internal id within the workspace, returning just the
     * signals the postmortem rules need: the task-type name and the status group.
     * Null when the id is absent or in another workspace (no cross-tenant oracle).
     */
    async findIncidentTaskState(
        taskId: string,
        workspaceId: string,
    ): Promise<{ id: string; typeName: string; statusGroup: string } | null> {
        const rows = await this.db
            .select({
                id: tasks.id,
                typeName: taskTypes.name,
                statusGroup: statuses.statusGroup,
            })
            .from(tasks)
            .innerJoin(taskTypes, eq(taskTypes.id, tasks.taskTypeId))
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)),
            )
            .limit(1);
        return rows[0] ?? null;
    }

    /**
     * Insert-or-update the postmortem for a task (PK = `task_id`), so a re-submit
     * replaces the prior checklist state and bumps `updated_at`/`updated_by`.
     */
    async upsertPostmortem(
        taskId: string,
        items: Record<string, boolean>,
        updatedBy: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .insert(taskPostmortems)
            .values({ taskId, items, updatedBy })
            .onDuplicateKeyUpdate({ set: { items, updatedBy } });
    }

    /** Read the stored postmortem for a task, or null if none exists yet. */
    async findPostmortem(taskId: string): Promise<TaskPostmortem | null> {
        const rows = await this.db
            .select()
            .from(taskPostmortems)
            .where(eq(taskPostmortems.taskId, taskId))
            .limit(1);
        return rows[0] ?? null;
    }
}
