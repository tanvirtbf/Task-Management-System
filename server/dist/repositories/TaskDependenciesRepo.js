"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskDependenciesRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const EDGE_COLUMNS = {
    id: schema_1.taskDependencies.id,
    taskId: schema_1.taskDependencies.taskId,
    relatedTaskId: schema_1.taskDependencies.relatedTaskId,
    createdAt: schema_1.taskDependencies.createdAt,
};
class TaskDependenciesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Outgoing edges — rows where this task is the blocker (`task_id = taskId`),
     * so the other end (`related_task_id`) is a task THIS task blocks. Ordered by
     * `created_at` then `id` for a stable, deterministic sequence. Backed by the
     * PK / `uq_task_dependencies (task_id, …)` prefix.
     */
    async findBlocks(taskId) {
        return this.db
            .select(EDGE_COLUMNS)
            .from(schema_1.taskDependencies)
            .where((0, drizzle_orm_1.eq)(schema_1.taskDependencies.taskId, taskId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.taskDependencies.createdAt), (0, drizzle_orm_1.asc)(schema_1.taskDependencies.id));
    }
    /**
     * Incoming edges — rows where this task is blocked (`related_task_id =
     * taskId`), so the other end (`task_id`) is a task that blocks THIS one
     * (surfaced as `type: "blocked_by"`). Backed by `idx_task_dependencies_related
     * (related_task_id)`.
     */
    async findBlockedBy(taskId) {
        return this.db
            .select(EDGE_COLUMNS)
            .from(schema_1.taskDependencies)
            .where((0, drizzle_orm_1.eq)(schema_1.taskDependencies.relatedTaskId, taskId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.taskDependencies.createdAt), (0, drizzle_orm_1.asc)(schema_1.taskDependencies.id));
    }
    /**
     * Full task rows for a set of ids, scoped to the caller's workspace — the
     * "other end" rows the GET response hydrates into wire `Task`s. Lives here
     * (rather than on `TasksRepo`) so §12 needs no edit to that shared file;
     * returns `select()` (all columns) so the rows feed `toWireTask` directly.
     * A cross-workspace id simply does not match (defense-in-depth — created
     * edges are intra-workspace).
     */
    async findTaskRowsByIds(ids, workspaceId) {
        if (ids.length === 0)
            return [];
        return this.db
            .select()
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, ids), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)));
    }
    /**
     * Out-neighbours of a frontier for cycle detection: the `related_task_id`s of
     * every "blocks" edge whose `task_id` is in `taskIds`, grouped by source.
     * One batched query per BFS level (no per-node round-trips). Backed by the
     * `uq_task_dependencies (task_id, …)` prefix.
     */
    async outNeighbors(taskIds, exec = this.db) {
        const map = new Map();
        if (taskIds.length === 0)
            return map;
        const rows = await exec
            .select({
            taskId: schema_1.taskDependencies.taskId,
            relatedTaskId: schema_1.taskDependencies.relatedTaskId,
        })
            .from(schema_1.taskDependencies)
            .where((0, drizzle_orm_1.inArray)(schema_1.taskDependencies.taskId, taskIds));
        for (const r of rows) {
            const bag = map.get(r.taskId) ?? [];
            bag.push(r.relatedTaskId);
            map.set(r.taskId, bag);
        }
        return map;
    }
    /**
     * Insert a "blocks" edge and return it in the projected shape (re-read for the
     * authoritative DB `created_at`). A duplicate `(task_id, related_task_id,
     * 'blocks')` trips `uq_task_dependencies` → mysql2 `ER_DUP_ENTRY`, which the
     * service maps to `409 dep.duplicate`; a self-loop (`task_id =
     * related_task_id`) trips `trg_task_dependencies_no_self_insert` (SQLSTATE
     * 45000) — but the service rejects that earlier with `422 dep.self`, so the
     * trigger is only a backstop. Pass `exec` to run inside the create tx.
     */
    async insert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("dep");
        await exec.insert(schema_1.taskDependencies).values({
            id,
            taskId: input.taskId,
            relatedTaskId: input.relatedTaskId,
            depType: "blocks",
            createdBy: input.createdBy,
        });
        const [row] = await exec
            .select(EDGE_COLUMNS)
            .from(schema_1.taskDependencies)
            .where((0, drizzle_orm_1.eq)(schema_1.taskDependencies.id, id))
            .limit(1);
        if (!row) {
            // Unreachable: the row was just inserted under this id.
            throw new Error(`task_dependency ${id} missing after insert`);
        }
        return row;
    }
    /**
     * Resolve an edge by id *within a workspace* — the isolation gate for DELETE.
     * An edge reaches a workspace through its `task_id` task (both endpoints are
     * intra-workspace by construction), so this joins `task_dependencies → tasks`
     * on `task_id` and filters `tasks.workspace_id`. Returns `null` when the id is
     * missing OR belongs to another workspace, so the caller renders both as `404
     * dep.not_found` (no cross-workspace existence oracle).
     */
    async findByIdInWorkspace(depId, workspaceId, exec = this.db) {
        const [row] = await exec
            .select(EDGE_COLUMNS)
            .from(schema_1.taskDependencies)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.taskDependencies.taskId, schema_1.tasks.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskDependencies.id, depId), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }
    /** Delete an edge by primary key; returns the affected-row count. */
    async deleteById(depId, exec = this.db) {
        const [res] = await exec
            .delete(schema_1.taskDependencies)
            .where((0, drizzle_orm_1.eq)(schema_1.taskDependencies.id, depId));
        return res.affectedRows;
    }
}
exports.TaskDependenciesRepo = TaskDependenciesRepo;
