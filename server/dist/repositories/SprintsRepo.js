"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SprintsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
/** Status groups that count a task as finished (for completed-points + rollover). */
const DONE_GROUPS = ["done", "closed"];
class SprintsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    // ─── sprints ──────────────────────────────────────────────────────────────
    /**
     * All sprints in a workspace, newest first (`start_date` DESC, `id` DESC for a
     * stable tie-break). The optional `status` filter is served by
     * `idx_sprints_workspace_status (workspace_id, status, start_date)`.
     */
    /**
     * F22 (ISS-011): the first sprint whose [start, end] overlaps the given
     * range (two closed ranges overlap unless one ends before the other
     * starts). `excludeId` lets an UPDATE ignore itself.
     */
    async findOverlapping(workspaceId, startDate, endDate, excludeId, exec = this.db) {
        const rows = await exec
            .select({ id: schema_1.sprints.id, name: schema_1.sprints.name })
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId), (0, drizzle_orm_1.lte)(schema_1.sprints.startDate, endDate), (0, drizzle_orm_1.gte)(schema_1.sprints.endDate, startDate), excludeId ? (0, drizzle_orm_1.ne)(schema_1.sprints.id, excludeId) : undefined))
            .limit(1);
        return rows[0] ?? null;
    }
    async listByWorkspace(workspaceId, status, exec = this.db) {
        return exec
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId), status ? (0, drizzle_orm_1.eq)(schema_1.sprints.status, status) : undefined))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.sprints.startDate), (0, drizzle_orm_1.desc)(schema_1.sprints.id));
    }
    /** Resolve one sprint within a workspace (the isolation gate). */
    async findByIdInWorkspace(id, workspaceId, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.id, id), (0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }
    /** The single active sprint of a workspace, if any (mirrors `v_active_sprint`). */
    async findActive(workspaceId, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.sprints.status, "active")))
            .limit(1);
        return row ?? null;
    }
    /** Any OTHER active sprint in the workspace — the single-active guard for start. */
    async findOtherActive(workspaceId, exceptId, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.sprints.status, "active"), (0, drizzle_orm_1.ne)(schema_1.sprints.id, exceptId)))
            .limit(1);
        return row ?? null;
    }
    /**
     * The next planned sprint to roll unfinished tasks into on close — the earliest
     * by `start_date` (then `id`), excluding the sprint being closed.
     */
    async findNextPlanned(workspaceId, exceptId, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.sprints.status, "planned"), (0, drizzle_orm_1.ne)(schema_1.sprints.id, exceptId)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.sprints.startDate), (0, drizzle_orm_1.asc)(schema_1.sprints.id))
            .limit(1);
        return row ?? null;
    }
    /** Lock a sprint row `FOR UPDATE` (in the caller's workspace) — null if absent. */
    async lockByIdInWorkspace(id, workspaceId, exec) {
        const [row] = await exec
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.id, id), (0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId)))
            .limit(1)
            .for("update");
        return row ?? null;
    }
    /**
     * Lock the workspace row `FOR UPDATE` to serialise sprint state transitions
     * (start / close) per workspace, making the "exactly one active sprint"
     * invariant race-free without a dedicated unique constraint.
     */
    async lockWorkspace(workspaceId, exec) {
        await exec
            .select({ id: schema_1.workspaces.id })
            .from(schema_1.workspaces)
            .where((0, drizzle_orm_1.eq)(schema_1.workspaces.id, workspaceId))
            .limit(1)
            .for("update");
    }
    /** Insert a sprint and re-read it for the authoritative DB row. */
    async insert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("spr");
        await exec.insert(schema_1.sprints).values({
            id,
            workspaceId: input.workspaceId,
            name: input.name,
            goal: input.goal,
            startDate: input.startDate,
            endDate: input.endDate,
            status: input.status ?? "planned",
            committedPoints: input.committedPoints,
        });
        const [row] = await exec
            .select()
            .from(schema_1.sprints)
            .where((0, drizzle_orm_1.eq)(schema_1.sprints.id, id))
            .limit(1);
        if (!row) {
            // Unreachable: the row was just inserted under this id.
            throw new Error(`sprint ${id} missing after insert`);
        }
        return row;
    }
    /** Apply a partial field update (workspace-scoped); returns affected rows. */
    async updateFields(id, workspaceId, fields, exec = this.db) {
        const [res] = await exec
            .update(schema_1.sprints)
            .set(fields)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.id, id), (0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId)));
        return res.affectedRows;
    }
    /** Transition a sprint's status (workspace-scoped). */
    async setStatus(id, workspaceId, status, exec = this.db) {
        await exec
            .update(schema_1.sprints)
            .set({ status })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.id, id), (0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId)));
    }
    /**
     * Hard-delete a sprint (F28 / ISS-013, decision D12.6). There is no archive
     * concept for a sprint, so this is a real DELETE.
     *
     * Its tasks are NOT deleted: `tasks.sprint_id` is declared
     * `ON DELETE SET NULL`, so the database detaches them as part of this
     * statement. The schema was built for this — which is why the fix is a
     * route, not a migration.
     */
    async deleteById(id, workspaceId, exec = this.db) {
        await exec
            .delete(schema_1.sprints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sprints.id, id), (0, drizzle_orm_1.eq)(schema_1.sprints.workspaceId, workspaceId)));
    }
    /** How many live+archived tasks the FK will detach — reported to the caller. */
    async countTasksInSprint(id, workspaceId, exec = this.db) {
        const rows = await exec
            .select({ n: (0, drizzle_orm_1.sql) `COUNT(*)` })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.sprintId, id), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)));
        return Number(rows[0]?.n ?? 0);
    }
    // ─── tasks (sprint link) ────────────────────────────────────────────────────
    /**
     * Resolve a set of LIVE task ids within the workspace (id + current sprint
     * link). Soft-deleted tasks (`archived_at` set) are excluded, so an archived
     * task cannot be attached to a sprint (addTasks treats it as not found).
     */
    async findTasksByIdsInWorkspace(ids, workspaceId, exec = this.db) {
        if (ids.length === 0)
            return [];
        return exec
            .select({ id: schema_1.tasks.id, sprintId: schema_1.tasks.sprintId })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, ids), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt)));
    }
    /**
     * Resolve one task within the workspace (id + current sprint link). Includes
     * archived tasks on purpose: removeTask must be able to detach a task that was
     * soft-deleted AFTER it was added to the sprint (cleanup).
     */
    async findTaskByIdInWorkspace(taskId, workspaceId, exec = this.db) {
        const [row] = await exec
            .select({ id: schema_1.tasks.id, sprintId: schema_1.tasks.sprintId })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }
    /** Point a set of tasks at a sprint (or detach with `null`); returns affected rows. */
    async setSprintForTasks(taskIds, sprintId, workspaceId, exec = this.db) {
        if (taskIds.length === 0)
            return 0;
        const [res] = await exec
            .update(schema_1.tasks)
            .set({ sprintId })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, taskIds), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)));
        return res.affectedRows;
    }
    /**
     * Ids of a sprint's UNFINISHED tasks — those whose status's `status_group` is
     * NOT in (`done`, `closed`). These are the candidates rolled into the next
     * planned sprint on close.
     */
    async findUnfinishedTaskIdsInSprint(sprintId, workspaceId, exec = this.db) {
        const rows = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.sprintId, sprintId), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, [...DONE_GROUPS])));
        return rows.map((r) => r.id);
    }
    /**
     * Sum of story points of a sprint's COMPLETED tasks (status_group in done /
     * closed) — the snapshot recorded into the audit feed on close. Summed in JS
     * (the per-sprint task set is small) so a NULL `story_points` counts as 0.
     */
    async sumCompletedPoints(sprintId, workspaceId, exec = this.db) {
        const rows = await exec
            .select({ storyPoints: schema_1.tasks.storyPoints })
            .from(schema_1.tasks)
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.tasks.statusId, schema_1.statuses.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.sprintId, sprintId), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.inArray)(schema_1.statuses.statusGroup, [...DONE_GROUPS])));
        return rows.reduce((sum, r) => sum + (r.storyPoints ?? 0), 0);
    }
}
exports.SprintsRepo = SprintsRepo;
