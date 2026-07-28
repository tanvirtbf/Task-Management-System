"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskTypeService = void 0;
const errors_1 = require("../errors");
const utils_1 = require("../utils");
/**
 * Fields a seeded `is_system` task type does NOT allow changing. Per
 * API_DESIGN.md §8 only `icon`/`color`/`description` are mutable on system
 * types; touching any of these is rejected with `403 task_type.system`.
 */
const SYSTEM_LOCKED_FIELDS = [
    "name",
    "isMilestoneType",
    "isDevType",
];
/** True for the mysql2 unique-constraint violation (errno 1062). */
const isDuplicateKeyError = (err) => typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ER_DUP_ENTRY";
/**
 * True for the mysql2 foreign-key RESTRICT violation on the parent row (errno
 * 1451 / `ER_ROW_IS_REFERENCED_2`). Lets `delete` translate an
 * `fk_tasks_task_type` rejection — a task referencing the type raced in after
 * the `countTasksUsingType` pre-check — into `409 task_type.in_use`.
 */
const isReferencedError = (err) => typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ER_ROW_IS_REFERENCED_2";
class TaskTypeService {
    db;
    taskTypes;
    workspaceActivity;
    constructor(db, taskTypes, workspaceActivity) {
        this.db = db;
        this.taskTypes = taskTypes;
        this.workspaceActivity = workspaceActivity;
    }
    /**
     * List every task type in a workspace. The `workspaceId` always comes from
     * the caller's verified JWT (`req.auth.workspaceId`) — never from client
     * input — so there is no cross-tenant read path.
     */
    async list(workspaceId) {
        return this.taskTypes.listByWorkspace(workspaceId);
    }
    /**
     * Create a task type in the caller's workspace.
     *
     * The new type is appended at the end (`position = max + 1`); `id` is
     * server-minted and `is_system` is always false. The insert and the
     * `workspace_activity` row are one transaction, so a duplicate name
     * (`(workspace_id, name)` is UNIQUE — case-insensitive under the
     * `utf8mb4_unicode_ci` collation) rolls everything back and surfaces as
     * `409 task_type.duplicate`.
     */
    async create(input) {
        const id = (0, utils_1.fakeId)("tt");
        try {
            return await this.db.transaction(async (tx) => {
                const position = await this.taskTypes.nextPosition(input.workspaceId, tx);
                const record = await this.taskTypes.create({
                    id,
                    workspaceId: input.workspaceId,
                    name: input.name,
                    position,
                    description: input.description,
                    icon: input.icon,
                    color: input.color,
                    isMilestoneType: input.isMilestoneType,
                    isDevType: input.isDevType,
                }, tx);
                await this.workspaceActivity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "task_type",
                    entityId: id,
                    action: "created",
                    context: { name: input.name },
                }, tx);
                return record;
            });
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("task_type.duplicate", `A task type named "${input.name}" already exists in this workspace`);
            }
            throw err;
        }
    }
    /**
     * Apply a partial update to a task type in the caller's workspace.
     *
     * Rejects an empty patch (422), a missing/cross-tenant id (404
     * `task_type.not_found`), and a locked-field edit on a system type (403
     * `task_type.system`). The row is locked for the transaction so a
     * concurrent update/delete serialises; the update and the
     * `workspace_activity` row commit together, and a rename collision surfaces
     * as `409 task_type.duplicate`.
     */
    async update(input) {
        const { workspaceId, actorId, id, patch } = input;
        const changedFields = Object.keys(patch);
        if (changedFields.length === 0) {
            throw errors_1.AppError.validationFailed([
                { issue: "Provide at least one field to update" },
            ]);
        }
        try {
            return await this.db.transaction(async (tx) => {
                const existing = await this.taskTypes.findByIdInWorkspace(id, workspaceId, tx, { forUpdate: true });
                if (!existing) {
                    throw errors_1.AppError.notFound("task_type.not_found", `Task type ${id} does not exist`);
                }
                if (existing.isSystem &&
                    SYSTEM_LOCKED_FIELDS.some((field) => field in patch)) {
                    throw errors_1.AppError.forbidden("task_type.system", "System task types allow only icon, color, and description changes");
                }
                const record = await this.taskTypes.update(id, patch, tx);
                await this.workspaceActivity.record({
                    workspaceId,
                    actorId,
                    entityType: "task_type",
                    entityId: id,
                    action: "updated",
                    context: { fields: changedFields },
                }, tx);
                return record;
            });
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("task_type.duplicate", `A task type named "${patch.name}" already exists in this workspace`);
            }
            throw err;
        }
    }
    /**
     * Delete a task type in the caller's workspace.
     *
     * Resolved within the workspace first (404 `task_type.not_found` for a
     * missing or cross-tenant id — no existence oracle). Then, in one
     * transaction holding a `FOR UPDATE` lock on the row:
     *
     *   - `403 task_type.system` — seeded `is_system` types can never be deleted
     *     (mirrors the PATCH guard; the curated §8 note overrides API_DESIGN.md's
     *     looser "409 if is_system").
     *   - `409 task_type.in_use` — any task references it (`tasks.task_type_id`,
     *     FK `RESTRICT`) OR any list names it as its default
     *     (`lists.default_task_type_id`, FK `SET NULL` — so the DB would NOT block
     *     it; §8 still requires the refusal, hence the explicit count). The
     *     `RESTRICT` constraint is the race-safe backstop for the task check.
     *
     * On success the row is deleted and a `workspace_activity` "deleted" row is
     * written in the same transaction. Precedence: not_found → system (403) →
     * in_use (409). Returns nothing; the controller renders `204 No Content`.
     */
    async delete(input) {
        const { workspaceId, actorId, id } = input;
        await this.db.transaction(async (tx) => {
            const existing = await this.taskTypes.findByIdInWorkspace(id, workspaceId, tx, { forUpdate: true });
            if (!existing) {
                throw errors_1.AppError.notFound("task_type.not_found", `Task type ${id} does not exist`);
            }
            if (existing.isSystem) {
                throw errors_1.AppError.forbidden("task_type.system", "System task types cannot be deleted");
            }
            // Two sequential awaits, not Promise.all: both counts run on the
            // single connection bound to `tx`, which mysql2 serialises anyway —
            // so parallelising here would only mislead, not speed anything up.
            const taskCount = await this.taskTypes.countTasksUsingType(id, tx);
            const listCount = await this.taskTypes.countListsUsingType(id, tx);
            if (taskCount > 0 || listCount > 0) {
                throw errors_1.AppError.conflict("task_type.in_use", `Task type ${id} is still referenced by ${taskCount} task(s) and ${listCount} list(s); reassign them first`);
            }
            let affected;
            try {
                affected = await this.taskTypes.deleteById(id, tx);
            }
            catch (err) {
                if (isReferencedError(err)) {
                    // A task referencing the type raced in after the pre-check;
                    // the FK RESTRICT rejected the delete.
                    throw errors_1.AppError.conflict("task_type.in_use", `Task type ${id} is still referenced by a task; reassign it first`);
                }
                throw err;
            }
            if (affected === 0) {
                // The row vanished between the lock and the delete (a concurrent
                // delete) — surface a 404, not a silent success.
                throw errors_1.AppError.notFound("task_type.not_found", `Task type ${id} does not exist`);
            }
            await this.workspaceActivity.record({
                workspaceId,
                actorId,
                entityType: "task_type",
                entityId: id,
                action: "deleted",
                context: { name: existing.name },
            }, tx);
        });
    }
}
exports.TaskTypeService = TaskTypeService;
