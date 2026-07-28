import {
    and,
    asc,
    count,
    desc,
    eq,
    exists,
    gt,
    inArray,
    isNotNull,
    isNull,
    like,
    or,
    sql,
} from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import {
    customFields,
    statuses,
    taskAssignees,
    taskCustomFieldValues,
    taskTags,
    taskWatchers,
    tasks,
} from "../db/schema";
import type { Task as TaskRow } from "../db/schema";
import type { ListTasksFilters } from "../types/tasks";
import { listScopeFilter } from "../rbac/context";
import { taskOwnEscape } from "../rbac/ownEscape";
import type { DbExecutor } from "./types";

/**
 * Data access for the `tasks` table. Services compose business logic over the
 * rows this repo returns; it never owns HTTP concerns.
 *
 * Methods are intentionally tight — each returns only the columns its caller
 * needs.
 */

/** Minimal task header needed to authorise a membership write. */
export interface TaskHeader {
    id: string;
    workspaceId: string;
    name: string;
    archivedAt: Date | null;
}

/**
 * Workspace + list scope for the task page/count queries, plus the validated
 * filters. `workspaceId` is always applied (tenant isolation) alongside the
 * `primary_list_id` match.
 */
export type TaskListParams = ListTasksFilters & {
    workspaceId: string;
    listId: string;
};

export class TasksRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * Fetch the task header scoped to the caller's workspace. Returns `null`
     * when the task does not exist OR belongs to another workspace — the
     * caller renders both as `task.not_found` so a cross-tenant id is not an
     * existence oracle.
     */
    async findByIdInWorkspace(
        taskId: string,
        workspaceId: string,
    ): Promise<TaskHeader | null> {
        const [row] = await this.db
            .select({
                id: tasks.id,
                workspaceId: tasks.workspaceId,
                name: tasks.name,
                archivedAt: tasks.archivedAt,
            })
            .from(tasks)
            .where(
                and(
                    eq(tasks.id, taskId),
                    eq(tasks.workspaceId, workspaceId),
                    // RBAC P17 — THE hole the scan called out: any member could
                    // read any task by id. Filtered on the LIST column, which
                    // leads `idx_tasks_list_active`.
                    await listScopeFilter(tasks.primaryListId, await taskOwnEscape()),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Fetch a full task row by either its internal `id` (`t-…`) or its
     * `custom_id` (`ORD-…`), scoped to the caller's workspace. Returns `null`
     * when nothing matches in that workspace — the caller renders both a missing
     * id and a cross-tenant id as `task.not_found`, so an id is not an existence
     * oracle across workspaces.
     *
     * Should a value collide (one task's `id` equals another's `custom_id`), the
     * exact `id` match wins via `ORDER BY (id = ?) DESC`. Both arms are
     * index-backed: `id` is the PK; `custom_id` is covered by
     * `uq_tasks_custom_id (workspace_id, custom_id)`.
     */
    async findByIdOrCustomIdInWorkspace(
        idOrKey: string,
        workspaceId: string,
    ): Promise<TaskRow | null> {
        const [row] = await this.db
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    or(eq(tasks.id, idOrKey), eq(tasks.customId, idOrKey)),
                    // RBAC P17 — the same hole via the custom-id route.
                    await listScopeFilter(tasks.primaryListId, await taskOwnEscape()),
                ),
            )
            .orderBy(desc(eq(tasks.id, idOrKey)))
            .limit(1);
        return row ?? null;
    }

    /**
     * Direct children of a parent task (`parent_task_id = parentId`), ordered by
     * the stable `internal_id` ASC — tasks carry no `position` column, so this
     * matches the `listByList` ordering. Always filtered by `workspace_id` for
     * defence-in-depth, even though a child shares its parent's workspace.
     * Archived children are excluded unless `includeArchived` (the soft-delete
     * default for list reads — API_DESIGN.md §1).
     *
     * The `parent_task_id` lookup is covered by `idx_tasks_parent`.
     */
    async listChildren(params: {
        parentId: string;
        workspaceId: string;
        includeArchived: boolean;
    }): Promise<TaskRow[]> {
        return this.db
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, params.workspaceId),
                    eq(tasks.parentTaskId, params.parentId),
                    params.includeArchived
                        ? undefined
                        : isNull(tasks.archivedAt),
                    // RBAC P17 — subtasks follow their own list's visibility.
                    await listScopeFilter(tasks.primaryListId, await taskOwnEscape()),
                ),
            )
            .orderBy(asc(tasks.internalId));
    }

    /**
     * Bump `updated_at` (the wire ETag) — call when a side-table change
     * (assignees, tags, …) mutates the task's effective state so freshness
     * ordering and optimistic-concurrency reflect it.
     */
    async touchUpdatedAt(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(tasks)
            .set({ updatedAt: new Date() })
            .where(eq(tasks.id, taskId));
    }

    /**
     * Acquire a row lock on the task (`SELECT … FOR UPDATE`) inside a
     * transaction so concurrent membership writes to the SAME task serialize.
     * Every writer takes this lock first, in the same order, which removes the
     * InnoDB deadlock between their child-row inserts and the `updated_at` bump,
     * and lets the caller recompute the assignee diff race-free.
     */
    async lockById(taskId: string, exec: DbExecutor = this.db): Promise<void> {
        await exec
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .for("update");
    }

    /**
     * Next per-list `task_number` (MAX+1 over `primary_list_id`). `task_number`
     * has no DB default / no trigger — it is app-allocated, scoped per list by
     * `uq_tasks_list_number (primary_list_id, task_number)`. That unique index is
     * the race-safe backstop: two concurrent creates in the same list can read
     * the same MAX, the loser trips ER_DUP_ENTRY, and the service recomputes +
     * retries. Pass `exec` to read inside the create transaction.
     */
    async nextTaskNumber(
        listId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({
                max: sql<number>`COALESCE(MAX(${tasks.taskNumber}), 0)`,
            })
            .from(tasks)
            .where(eq(tasks.primaryListId, listId));
        return Number(row?.max ?? 0) + 1;
    }

    /**
     * Insert a `tasks` row. The service supplies the explicit, whitelisted
     * column set (`id`, `workspaceId`, `primaryListId`, `taskNumber`, `statusId`,
     * `taskTypeId`, `name`, …); `internal_id` auto-increments and the counter
     * columns (`subtasks_count`, `comments_count`, …) keep their `0` default —
     * their triggers own them, the app never writes them. NOTE: never insert with
     * `parentTaskId` set — the AFTER INSERT counter trigger UPDATEs `tasks` and
     * MySQL rejects that (error 1442); set the parent via a follow-up UPDATE.
     * Takes an optional `exec` so the insert composes in the create transaction.
     */
    async insert(
        values: typeof tasks.$inferInsert,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(tasks).values(values);
    }

    /**
     * Set `parent_task_id` (+ `nesting_depth`) on an already-inserted row. Split
     * from `insert` to dodge the error-1442 trigger trap: an AFTER UPDATE that
     * does not change `status_id` leaves the subtask-counter trigger's inner
     * UPDATE un-fired, so this UPDATE is safe (the parent's `subtasks_count` is
     * not auto-incremented — a known pre-existing schema-trigger limitation).
     */
    async setParent(
        taskId: string,
        parentTaskId: string,
        nestingDepth: number,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(tasks)
            .set({ parentTaskId, nestingDepth })
            .where(eq(tasks.id, taskId));
    }

    /**
     * Apply a partial column update by primary key (#5 PATCH / #10 bulk). Only
     * the supplied (whitelisted) columns are written; `updated_at` auto-bumps via
     * `onUpdateNow` (the ETag). NEVER pass a counter column or `parent_task_id`
     * here (the latter would fire the error-1442 trigger if status also changed —
     * use `setParent` with status untouched). Takes an optional `exec`.
     */
    async update(
        taskId: string,
        patch: Partial<typeof tasks.$inferInsert>,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.update(tasks).set(patch).where(eq(tasks.id, taskId));
    }

    /**
     * Set / clear `archived_at` with an `archived_at IS NULL` (archive) or
     * `IS NOT NULL` (unarchive) guard so the conditional UPDATE is race-safe and
     * idempotent: it returns `true` only when the row actually transitioned
     * (affectedRows === 1), gating the audit write so a no-op or a concurrent
     * double-archive writes exactly one activity row. Mirrors `ListsRepo.archive`.
     */
    async archive(taskId: string, exec: DbExecutor = this.db): Promise<boolean> {
        const [res] = await exec
            .update(tasks)
            .set({ archivedAt: new Date() })
            .where(and(eq(tasks.id, taskId), isNull(tasks.archivedAt)));
        return res.affectedRows === 1;
    }

    async unarchive(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [res] = await exec
            .update(tasks)
            .set({ archivedAt: null })
            .where(and(eq(tasks.id, taskId), isNotNull(tasks.archivedAt)));
        return res.affectedRows === 1;
    }

    /**
     * Hard-delete a task by primary key. The inbound FKs from
     * `task_assignees`/`task_watchers`/`task_tags`/`task_dependencies`/
     * `task_activity` and child tasks (`fk_tasks_parent`) are all `ON DELETE
     * CASCADE`, so the DB tears those down; a single row delete suffices. Returns
     * the affected-row count (0 if a concurrent delete already won).
     */
    async hardDelete(
        taskId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [res] = await exec.delete(tasks).where(eq(tasks.id, taskId));
        return res.affectedRows;
    }

    /**
     * Cascade `archived_at = NOW()` to a task's descendants (children +
     * grandchildren — nesting is ≤ 2). Only currently-live rows are touched
     * (`archived_at IS NULL`). The two-step query avoids the MySQL 1093
     * "can't UPDATE a table referenced in a subquery" trap, and setting only
     * `archived_at` (no status change) never fires the error-1442 counter
     * trigger. The ROOT is archived by the caller via `archive`.
     */
    async archiveDescendants(
        rootId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        const kids = await exec
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.parentTaskId, rootId));
        const kidIds = kids.map((k) => k.id);
        if (kidIds.length === 0) return;
        await exec
            .update(tasks)
            .set({ archivedAt: new Date() })
            .where(and(inArray(tasks.id, kidIds), isNull(tasks.archivedAt)));
        const grands = await exec
            .select({ id: tasks.id })
            .from(tasks)
            .where(inArray(tasks.parentTaskId, kidIds));
        const grandIds = grands.map((g) => g.id);
        if (grandIds.length === 0) return;
        await exec
            .update(tasks)
            .set({ archivedAt: new Date() })
            .where(and(inArray(tasks.id, grandIds), isNull(tasks.archivedAt)));
    }

    /** Reverse of `archiveDescendants` — clears `archived_at` on the subtree. */
    async unarchiveDescendants(
        rootId: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        const kids = await exec
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.parentTaskId, rootId));
        const kidIds = kids.map((k) => k.id);
        if (kidIds.length === 0) return;
        await exec
            .update(tasks)
            .set({ archivedAt: null })
            .where(and(inArray(tasks.id, kidIds), isNotNull(tasks.archivedAt)));
        const grands = await exec
            .select({ id: tasks.id })
            .from(tasks)
            .where(inArray(tasks.parentTaskId, kidIds));
        const grandIds = grands.map((g) => g.id);
        if (grandIds.length === 0) return;
        await exec
            .update(tasks)
            .set({ archivedAt: null })
            .where(
                and(inArray(tasks.id, grandIds), isNotNull(tasks.archivedAt)),
            );
    }

    /**
     * One filtered page of a list's tasks, keyset-paginated on `internal_id`
     * ASC (the documented stable order — API_DESIGN.md §1). Callers pass
     * `limit + 1` and use the extra row to derive `has_more`. Every clause is
     * ANDed; `workspace_id` + `primary_list_id` are always present.
     *
     * The base predicate (`primary_list_id`, `archived_at`) is covered by
     * `idx_tasks_list_active`; the `internal_id` keyset uses the
     * `uq_tasks_internal_id` unique index.
     */
    async listByList(
        params: TaskListParams & { afterId?: string; limit: number },
    ): Promise<TaskRow[]> {
        // RBAC P17 — the page and the count below share this predicate, which
        // is what keeps `total_estimate` honest under scoping (landmine L2).
        const visible = await listScopeFilter(
            tasks.primaryListId,
            await taskOwnEscape(),
        );
        return this.db
            .select()
            .from(tasks)
            .where(and(this.filterWhere(params), visible))
            .orderBy(asc(tasks.internalId))
            .limit(params.limit);
    }

    /**
     * Full task rows for a set of ids within a workspace (#10 bulk validate +
     * re-read). Ordered by the stable `internal_id`. Ids not in the workspace
     * are simply absent from the result — the caller compares the returned set
     * against the requested ids to fail-atomic on any cross-tenant / missing id.
     */
    async findManyByIdsInWorkspace(
        ids: string[],
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<TaskRow[]> {
        if (ids.length === 0) return [];
        return exec
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    inArray(tasks.id, ids),
                    // RBAC P17 — a bulk operation fails atomically on any id the
                    // caller cannot see, because it is simply not returned.
                    await listScopeFilter(tasks.primaryListId, await taskOwnEscape()),
                ),
            )
            .orderBy(asc(tasks.internalId));
    }

    /**
     * Every non-archived task in `workspaceId` attached to `sprintId`, across
     * lists (a sprint's tasks span lists). Powers `GET /sprints/:id/tasks`.
     */
    async findBySprintInWorkspace(
        sprintId: string,
        workspaceId: string,
    ): Promise<TaskRow[]> {
        return this.db
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    eq(tasks.sprintId, sprintId),
                    isNull(tasks.archivedAt),
                    // RBAC P17 — a sprint spans lists; each one is filtered.
                    await listScopeFilter(tasks.primaryListId, await taskOwnEscape()),
                ),
            )
            .orderBy(asc(tasks.internalId));
    }

    /**
     * Apply one scalar column patch to many tasks in a single UPDATE (#10 bulk).
     * `updated_at` is included by the caller so the ETag bumps even when only
     * side tables change. NEVER pass a counter column or `parent_task_id`.
     */
    async updateMany(
        ids: string[],
        patch: Partial<typeof tasks.$inferInsert>,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (ids.length === 0) return;
        await exec.update(tasks).set(patch).where(inArray(tasks.id, ids));
    }

    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countByList(params: TaskListParams): Promise<number> {
        const visible = await listScopeFilter(
            tasks.primaryListId,
            await taskOwnEscape(),
        );
        const [row] = await this.db
            .select({ value: count() })
            .from(tasks)
            .where(and(this.filterWhere(params), visible));
        return row?.value ?? 0;
    }

    /**
     * Count EVERY task whose `primary_list_id` is this list, regardless of
     * archived state. Used by `DELETE /lists/:id` to refuse a hard-delete with
     * `409 list.not_empty` before attempting it: `fk_tasks_list` is `ON DELETE
     * RESTRICT`, so an archived task blocks the delete at the DB just as a live
     * one does — hence the count is intentionally unfiltered by `archived_at`
     * (stricter than the §6 prose's "non-archived", but it matches what the FK
     * actually enforces and avoids a 500). Served by `idx_tasks_list_active
     * (primary_list_id, …)`. Pass `exec` to read inside the delete tx.
     */
    async countByPrimaryList(
        listId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ value: count() })
            .from(tasks)
            .where(eq(tasks.primaryListId, listId));
        return row?.value ?? 0;
    }

    /**
     * The caller's "my work": every non-archived task in `workspaceId` that the
     * user is assigned to, joined with its status's `status_group` so the
     * service can bucket by done-ness + due date. Ordered by due date then the
     * stable `internal_id`. Powers `GET /api/v1/tasks/my-work` (#11).
     */
    async myWorkRows(
        userId: string,
        workspaceId: string,
    ): Promise<Array<{ task: TaskRow; statusGroup: string }>> {
        return this.db
            .select({ task: tasks, statusGroup: statuses.statusGroup })
            .from(tasks)
            .innerJoin(
                taskAssignees,
                and(
                    eq(taskAssignees.taskId, tasks.id),
                    eq(taskAssignees.userId, userId),
                ),
            )
            .innerJoin(statuses, eq(statuses.id, tasks.statusId))
            .where(
                and(
                    eq(tasks.workspaceId, workspaceId),
                    isNull(tasks.archivedAt),
                ),
            )
            .orderBy(asc(tasks.dueDate), asc(tasks.internalId));
    }

    /** Assignee user-ids for a page of tasks, grouped by task id. */
    async assigneesByTask(taskIds: string[]): Promise<Map<string, string[]>> {
        if (taskIds.length === 0) return new Map();
        const rows = await this.db
            .select({
                taskId: taskAssignees.taskId,
                userId: taskAssignees.userId,
            })
            .from(taskAssignees)
            .where(inArray(taskAssignees.taskId, taskIds))
            .orderBy(asc(taskAssignees.taskId), asc(taskAssignees.assignedAt));
        return groupValues(
            rows,
            (r) => r.taskId,
            (r) => r.userId,
        );
    }

    /** Watcher user-ids for a page of tasks, grouped by task id. */
    async watchersByTask(taskIds: string[]): Promise<Map<string, string[]>> {
        if (taskIds.length === 0) return new Map();
        const rows = await this.db
            .select({
                taskId: taskWatchers.taskId,
                userId: taskWatchers.userId,
            })
            .from(taskWatchers)
            .where(inArray(taskWatchers.taskId, taskIds))
            .orderBy(asc(taskWatchers.taskId), asc(taskWatchers.startedAt));
        return groupValues(
            rows,
            (r) => r.taskId,
            (r) => r.userId,
        );
    }

    /** Tag ids for a page of tasks, grouped by task id. */
    async tagsByTask(taskIds: string[]): Promise<Map<string, string[]>> {
        if (taskIds.length === 0) return new Map();
        const rows = await this.db
            .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
            .from(taskTags)
            .where(inArray(taskTags.taskId, taskIds))
            .orderBy(asc(taskTags.taskId), asc(taskTags.addedAt));
        return groupValues(
            rows,
            (r) => r.taskId,
            (r) => r.tagId,
        );
    }

    /**
     * Custom-field values for a page of tasks, grouped by task id into the wire
     * `{ [fieldId]: value }` map. When `redactGuest` is set, fields marked
     * `hidden_from_guests` are omitted.
     */
    async customFieldValuesByTask(
        taskIds: string[],
        redactGuest: boolean,
    ): Promise<Map<string, Record<string, unknown>>> {
        const map = new Map<string, Record<string, unknown>>();
        if (taskIds.length === 0) return map;
        const rows = await this.db
            .select({
                taskId: taskCustomFieldValues.taskId,
                fieldId: taskCustomFieldValues.customFieldId,
                value: taskCustomFieldValues.value,
            })
            .from(taskCustomFieldValues)
            .innerJoin(
                customFields,
                eq(customFields.id, taskCustomFieldValues.customFieldId),
            )
            .where(
                and(
                    inArray(taskCustomFieldValues.taskId, taskIds),
                    redactGuest
                        ? eq(customFields.hiddenFromGuests, false)
                        : undefined,
                ),
            );
        for (const row of rows) {
            const bag = map.get(row.taskId) ?? {};
            bag[row.fieldId] = row.value;
            map.set(row.taskId, bag);
        }
        return map;
    }

    /**
     * Shared WHERE for the page + count queries. Optional filters and the
     * keyset cursor are appended only when supplied — Drizzle's `and()` ignores
     * `undefined` entries. `q` searches `name` + `custom_id` with LIKE
     * wildcards escaped; multi-value filters use `IN (…)`; `status_group` maps
     * through the list's `statuses`.
     */
    private filterWhere(params: TaskListParams & { afterId?: string }) {
        const pattern =
            params.q && params.q.length > 0
                ? `%${escapeLike(params.q)}%`
                : undefined;
        return and(
            eq(tasks.workspaceId, params.workspaceId),
            eq(tasks.primaryListId, params.listId),
            params.includeArchived ? undefined : isNull(tasks.archivedAt),
            params.includeSubtasks ? undefined : isNull(tasks.parentTaskId),
            params.statusIds?.length
                ? inArray(tasks.statusId, params.statusIds)
                : undefined,
            params.statusGroups?.length
                ? inArray(
                      tasks.statusId,
                      this.db
                          .select({ id: statuses.id })
                          .from(statuses)
                          .where(
                              and(
                                  eq(statuses.scopeType, "list"),
                                  eq(statuses.scopeId, params.listId),
                                  inArray(
                                      statuses.statusGroup,
                                      params.statusGroups,
                                  ),
                              ),
                          ),
                  )
                : undefined,
            params.priorities?.length
                ? inArray(tasks.priority, params.priorities)
                : undefined,
            params.taskTypeIds?.length
                ? inArray(tasks.taskTypeId, params.taskTypeIds)
                : undefined,
            params.reviewerId
                ? eq(tasks.reviewerId, params.reviewerId)
                : undefined,
            params.sprintId ? eq(tasks.sprintId, params.sprintId) : undefined,
            params.bugSeverities?.length
                ? inArray(tasks.bugSeverity, params.bugSeverities)
                : undefined,
            params.assigneeIds?.length
                ? exists(
                      this.db
                          .select({ n: sql`1` })
                          .from(taskAssignees)
                          .where(
                              and(
                                  eq(taskAssignees.taskId, tasks.id),
                                  inArray(
                                      taskAssignees.userId,
                                      params.assigneeIds,
                                  ),
                              ),
                          ),
                  )
                : undefined,
            params.tagIds?.length
                ? exists(
                      this.db
                          .select({ n: sql`1` })
                          .from(taskTags)
                          .where(
                              and(
                                  eq(taskTags.taskId, tasks.id),
                                  inArray(taskTags.tagId, params.tagIds),
                              ),
                          ),
                  )
                : undefined,
            pattern
                ? or(like(tasks.name, pattern), like(tasks.customId, pattern))
                : undefined,
            params.dueAfter
                ? sql`${tasks.dueDate} >= ${params.dueAfter}`
                : undefined,
            params.dueBefore
                ? sql`${tasks.dueDate} <= ${params.dueBefore}`
                : undefined,
            params.afterId
                ? gt(tasks.internalId, BigInt(params.afterId))
                : undefined,
        );
    }
}

/**
 * Escape LIKE wildcards (`%`, `_`) and the escape char so a user's `q` matches
 * literally — the value is still parameter-bound, this only neutralises
 * wildcard semantics. Mirrors the helper in `UsersRepo`.
 */
const escapeLike = (input: string): string =>
    input.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Group rows into `Map<key, value[]>`, preserving row order within each key. */
const groupValues = <T>(
    rows: T[],
    keyOf: (row: T) => string,
    valueOf: (row: T) => string,
): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
        const key = keyOf(row);
        const arr = map.get(key) ?? [];
        arr.push(valueOf(row));
        map.set(key, arr);
    }
    return map;
};
