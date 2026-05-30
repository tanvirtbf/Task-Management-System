import {
    and,
    asc,
    count,
    desc,
    eq,
    exists,
    gt,
    inArray,
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
                and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)),
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
        return this.db
            .select()
            .from(tasks)
            .where(this.filterWhere(params))
            .orderBy(asc(tasks.internalId))
            .limit(params.limit);
    }

    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countByList(params: TaskListParams): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(tasks)
            .where(this.filterWhere(params));
        return row?.value ?? 0;
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
