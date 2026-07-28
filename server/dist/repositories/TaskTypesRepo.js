"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskTypesRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/**
 * The wire-`TaskType` column projection — every method that returns a
 * `TaskTypeRecord` selects exactly these columns (never `workspace_id` or the
 * timestamps, which are not part of Appendix A's `TaskType`).
 */
const TASK_TYPE_COLUMNS = {
    id: schema_1.taskTypes.id,
    name: schema_1.taskTypes.name,
    description: schema_1.taskTypes.description,
    icon: schema_1.taskTypes.icon,
    color: schema_1.taskTypes.color,
    isMilestoneType: schema_1.taskTypes.isMilestoneType,
    isSystem: schema_1.taskTypes.isSystem,
    isDevType: schema_1.taskTypes.isDevType,
    position: schema_1.taskTypes.position,
};
class TaskTypesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * List every task type in a workspace, ordered by `position` with a stable
     * `id` tie-break so the result order is deterministic when positions
     * collide. Backed by `idx_task_types_workspace (workspace_id, position)`.
     *
     * `task_types` has no `archived_at` column — task types are hard-deleted,
     * so there is deliberately no soft-delete filter here.
     */
    async listByWorkspace(workspaceId) {
        const rows = await this.db
            .select(TASK_TYPE_COLUMNS)
            .from(schema_1.taskTypes)
            .where((0, drizzle_orm_1.eq)(schema_1.taskTypes.workspaceId, workspaceId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.taskTypes.position), (0, drizzle_orm_1.asc)(schema_1.taskTypes.id));
        return rows;
    }
    /**
     * The next `position` for a new task type in a workspace: one past the
     * current max, or 0 for the first one. Backed by `idx_task_types_workspace
     * (workspace_id, position)`. Pass `exec` to read inside the create tx so it
     * is consistent with the insert that follows.
     */
    async nextPosition(workspaceId, exec = this.db) {
        const [row] = await exec
            .select({ maxPosition: (0, drizzle_orm_1.max)(schema_1.taskTypes.position) })
            .from(schema_1.taskTypes)
            .where((0, drizzle_orm_1.eq)(schema_1.taskTypes.workspaceId, workspaceId));
        const current = row?.maxPosition;
        return (current == null ? -1 : Number(current)) + 1;
    }
    /**
     * Insert a task type and return it in wire-column form. Omitted optional
     * columns fall through to their schema DEFAULTs, so the re-select reflects
     * what was actually stored. A `(workspace_id, name)` collision surfaces as
     * the driver's `ER_DUP_ENTRY` — the service maps it to 409. Pass `exec` to
     * run inside a transaction.
     */
    async create(row, exec = this.db) {
        await exec.insert(schema_1.taskTypes).values({
            id: row.id,
            workspaceId: row.workspaceId,
            name: row.name,
            position: row.position,
            description: row.description,
            icon: row.icon,
            color: row.color,
            isMilestoneType: row.isMilestoneType,
            isDevType: row.isDevType,
        });
        const [created] = await exec
            .select(TASK_TYPE_COLUMNS)
            .from(schema_1.taskTypes)
            .where((0, drizzle_orm_1.eq)(schema_1.taskTypes.id, row.id))
            .limit(1);
        if (!created) {
            // Unreachable: the row was just inserted on this same executor.
            // Fail loudly rather than return a non-spec shape.
            throw new Error(`task_type ${row.id} missing immediately after insert`);
        }
        return created;
    }
    /**
     * Fetch one task type scoped to its workspace, in wire-column form, or
     * `null` if it does not exist there (so a cross-tenant id is indistinguish-
     * able from a missing one — no existence oracle). Pass `forUpdate` to take a
     * `SELECT … FOR UPDATE` row lock inside the caller's transaction, which
     * serialises a concurrent update/delete of the same row.
     */
    async findByIdInWorkspace(id, workspaceId, exec = this.db, opts = {}) {
        const query = exec
            .select(TASK_TYPE_COLUMNS)
            .from(schema_1.taskTypes)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskTypes.id, id), (0, drizzle_orm_1.eq)(schema_1.taskTypes.workspaceId, workspaceId)))
            .limit(1);
        const [row] = opts.forUpdate ? await query.for("update") : await query;
        return row ?? null;
    }
    /**
     * Apply a partial update by id and return the row in wire-column form. Only
     * the columns present in `patch` are written; `updated_at` is bumped by the
     * schema's `ON UPDATE CURRENT_TIMESTAMP`. A `(workspace_id, name)` collision
     * on rename surfaces as `ER_DUP_ENTRY` — the service maps it to 409. Caller
     * guarantees `patch` is non-empty and the row exists (locked in the same tx).
     */
    async update(id, patch, exec = this.db) {
        await exec.update(schema_1.taskTypes).set(patch).where((0, drizzle_orm_1.eq)(schema_1.taskTypes.id, id));
        const [updated] = await exec
            .select(TASK_TYPE_COLUMNS)
            .from(schema_1.taskTypes)
            .where((0, drizzle_orm_1.eq)(schema_1.taskTypes.id, id))
            .limit(1);
        if (!updated) {
            // Unreachable: the row is locked for the duration of the tx.
            throw new Error(`task_type ${id} missing immediately after update`);
        }
        return updated;
    }
    /**
     * How many tasks reference this task type (`tasks.task_type_id`). Used by
     * `DELETE /task-types/:id` to refuse with `409 task_type.in_use`. Served by
     * the index InnoDB maintains for `fk_tasks_task_type`, so it never scans the
     * `tasks` heap. A task type reaches a workspace only via `tasks.workspace_id`
     * = the same workspace, so an in-workspace `typeId` cannot match a foreign
     * workspace's tasks.
     */
    async countTasksUsingType(typeId, exec = this.db) {
        const [row] = await exec
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.taskTypeId, typeId));
        return row?.value ?? 0;
    }
    /**
     * How many lists name this task type as their default
     * (`lists.default_task_type_id`). The DB FK is `ON DELETE SET NULL`, so a
     * referencing list does NOT block the delete at the database level — but §8
     * requires refusing with `409 task_type.in_use` if a list still references
     * it, so the service counts these explicitly before deleting. Served by
     * `idx_lists_default_task_type (default_task_type_id)`.
     */
    async countListsUsingType(typeId, exec = this.db) {
        const [row] = await exec
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.lists)
            .where((0, drizzle_orm_1.eq)(schema_1.lists.defaultTaskTypeId, typeId));
        return row?.value ?? 0;
    }
    /**
     * Delete a task type by id, returning the affected-row count. Zero means the
     * row was already gone (a concurrent delete won the race) — the caller renders
     * that as `404 task_type.not_found`. The write is keyed on the PK alone, so
     * callers MUST have resolved the id within the workspace first.
     *
     * If a task still references the type, `fk_tasks_task_type`'s `ON DELETE
     * RESTRICT` rejects the delete with `ER_ROW_IS_REFERENCED_2` — the race-safe
     * backstop for the caller's `countTasksUsingType` pre-check, translated by the
     * service into `409 task_type.in_use`.
     */
    async deleteById(id, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.taskTypes)
            .where((0, drizzle_orm_1.eq)(schema_1.taskTypes.id, id));
        return result.affectedRows;
    }
}
exports.TaskTypesRepo = TaskTypesRepo;
