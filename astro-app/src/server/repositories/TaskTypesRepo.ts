import { and, asc, count, eq, max } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { lists, taskTypes, tasks } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for the `task_types` table. Owns the Drizzle queries; the service
 * composes business logic over the rows this repo returns.
 *
 * Each method selects only the columns its caller needs — never `workspace_id`
 * or the timestamps, which are not part of the wire `TaskType` defined in
 * `API_DESIGN.md` Appendix A.
 */

export interface TaskTypeRecord {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    isMilestoneType: boolean;
    isSystem: boolean;
    isDevType: boolean;
    position: number;
}

/**
 * Row to insert for a new task type. `id`, `workspaceId`, `name`, and
 * `position` are always supplied by the service; the rest are optional so an
 * omitted column falls through to its schema DEFAULT (`icon`/`color`/the `is_*`
 * flags) or to NULL (`description`). `is_system` is never accepted — created
 * types are always `is_system = false`.
 */
export interface NewTaskTypeRow {
    id: string;
    workspaceId: string;
    name: string;
    position: number;
    description?: string;
    icon?: string;
    color?: string;
    isMilestoneType?: boolean;
    isDevType?: boolean;
}

/**
 * Columns settable by `PATCH`. Only the keys the client actually sent are
 * present, so untouched columns are never overwritten. `description: null`
 * clears the field. `is_system`, `position`, and `workspace_id` are absent by
 * design — they are not patchable through the API.
 */
export interface TaskTypeUpdateRow {
    name?: string;
    icon?: string;
    color?: string;
    description?: string | null;
    isMilestoneType?: boolean;
    isDevType?: boolean;
}

/**
 * The wire-`TaskType` column projection — every method that returns a
 * `TaskTypeRecord` selects exactly these columns (never `workspace_id` or the
 * timestamps, which are not part of Appendix A's `TaskType`).
 */
const TASK_TYPE_COLUMNS = {
    id: taskTypes.id,
    name: taskTypes.name,
    description: taskTypes.description,
    icon: taskTypes.icon,
    color: taskTypes.color,
    isMilestoneType: taskTypes.isMilestoneType,
    isSystem: taskTypes.isSystem,
    isDevType: taskTypes.isDevType,
    position: taskTypes.position,
} as const;

export class TaskTypesRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * List every task type in a workspace, ordered by `position` with a stable
     * `id` tie-break so the result order is deterministic when positions
     * collide. Backed by `idx_task_types_workspace (workspace_id, position)`.
     *
     * `task_types` has no `archived_at` column — task types are hard-deleted,
     * so there is deliberately no soft-delete filter here.
     */
    async listByWorkspace(workspaceId: string): Promise<TaskTypeRecord[]> {
        const rows = await this.db
            .select(TASK_TYPE_COLUMNS)
            .from(taskTypes)
            .where(eq(taskTypes.workspaceId, workspaceId))
            .orderBy(asc(taskTypes.position), asc(taskTypes.id));
        return rows;
    }

    /**
     * The next `position` for a new task type in a workspace: one past the
     * current max, or 0 for the first one. Backed by `idx_task_types_workspace
     * (workspace_id, position)`. Pass `exec` to read inside the create tx so it
     * is consistent with the insert that follows.
     */
    async nextPosition(
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ maxPosition: max(taskTypes.position) })
            .from(taskTypes)
            .where(eq(taskTypes.workspaceId, workspaceId));
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
    async create(
        row: NewTaskTypeRow,
        exec: DbExecutor = this.db,
    ): Promise<TaskTypeRecord> {
        await exec.insert(taskTypes).values({
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
            .from(taskTypes)
            .where(eq(taskTypes.id, row.id))
            .limit(1);
        if (!created) {
            // Unreachable: the row was just inserted on this same executor.
            // Fail loudly rather than return a non-spec shape.
            throw new Error(
                `task_type ${row.id} missing immediately after insert`,
            );
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
    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
        opts: { forUpdate?: boolean } = {},
    ): Promise<TaskTypeRecord | null> {
        const query = exec
            .select(TASK_TYPE_COLUMNS)
            .from(taskTypes)
            .where(
                and(
                    eq(taskTypes.id, id),
                    eq(taskTypes.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        // conv: `opts.forUpdate` is a no-op now — FOR UPDATE removed because
        // SQLite serializes writes, so the read inside the caller's
        // transaction is already race-safe. The flag stays for call-site
        // compatibility (it still documents locking intent).
        void opts;
        const [row] = await query;
        return row ?? null;
    }

    /**
     * Apply a partial update by id and return the row in wire-column form. Only
     * the columns present in `patch` are written; `updated_at` is bumped by the
     * schema's `ON UPDATE CURRENT_TIMESTAMP`. A `(workspace_id, name)` collision
     * on rename surfaces as `ER_DUP_ENTRY` — the service maps it to 409. Caller
     * guarantees `patch` is non-empty and the row exists (locked in the same tx).
     */
    async update(
        id: string,
        patch: TaskTypeUpdateRow,
        exec: DbExecutor = this.db,
    ): Promise<TaskTypeRecord> {
        await exec.update(taskTypes).set(patch).where(eq(taskTypes.id, id));

        const [updated] = await exec
            .select(TASK_TYPE_COLUMNS)
            .from(taskTypes)
            .where(eq(taskTypes.id, id))
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
    async countTasksUsingType(
        typeId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ value: count() })
            .from(tasks)
            .where(eq(tasks.taskTypeId, typeId));
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
    async countListsUsingType(
        typeId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ value: count() })
            .from(lists)
            .where(eq(lists.defaultTaskTypeId, typeId));
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
    async deleteById(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const result = await exec
            .delete(taskTypes)
            .where(eq(taskTypes.id, id));
        return result.rowsAffected;
    }
}
