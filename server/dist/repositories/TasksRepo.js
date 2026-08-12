"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const context_1 = require("../rbac/context");
const ownEscape_1 = require("../rbac/ownEscape");
class TasksRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Fetch the task header scoped to the caller's workspace. Returns `null`
     * when the task does not exist OR belongs to another workspace — the
     * caller renders both as `task.not_found` so a cross-tenant id is not an
     * existence oracle.
     */
    async findByIdInWorkspace(taskId, workspaceId) {
        const [row] = await this.db
            .select({
            id: schema_1.tasks.id,
            workspaceId: schema_1.tasks.workspaceId,
            name: schema_1.tasks.name,
            createdBy: schema_1.tasks.createdBy,
            archivedAt: schema_1.tasks.archivedAt,
        })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), 
        // RBAC P17 — THE hole the scan called out: any member could
        // read any task by id. Filtered on the LIST column, which
        // leads `idx_tasks_list_active`.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
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
    async findByIdOrCustomIdInWorkspace(idOrKey, workspaceId) {
        const [row] = await this.db
            .select()
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.tasks.id, idOrKey), (0, drizzle_orm_1.eq)(schema_1.tasks.customId, idOrKey)), 
        // RBAC P17 — the same hole via the custom-id route.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.eq)(schema_1.tasks.id, idOrKey)))
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
    async listChildren(params) {
        return this.db
            .select()
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, params.workspaceId), (0, drizzle_orm_1.eq)(schema_1.tasks.parentTaskId, params.parentId), params.includeArchived
            ? undefined
            : (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), 
        // RBAC P17 — subtasks follow their own list's visibility.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.internalId));
    }
    /**
     * Bump `updated_at` (the wire ETag) — call when a side-table change
     * (assignees, tags, …) mutates the task's effective state so freshness
     * ordering and optimistic-concurrency reflect it.
     */
    async touchUpdatedAt(taskId, exec = this.db) {
        await exec
            .update(schema_1.tasks)
            .set({ updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId));
    }
    /**
     * Acquire a row lock on the task (`SELECT … FOR UPDATE`) inside a
     * transaction so concurrent membership writes to the SAME task serialize.
     * Every writer takes this lock first, in the same order, which removes the
     * InnoDB deadlock between their child-row inserts and the `updated_at` bump,
     * and lets the caller recompute the assignee diff race-free.
     */
    async lockById(taskId, exec = this.db) {
        await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId))
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
    async nextTaskNumber(listId, exec = this.db) {
        const [row] = await exec
            .select({
            max: (0, drizzle_orm_1.sql) `COALESCE(MAX(${schema_1.tasks.taskNumber}), 0)`,
        })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, listId));
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
    async insert(values, exec = this.db) {
        await exec.insert(schema_1.tasks).values(values);
    }
    /**
     * Set `parent_task_id` (+ `nesting_depth`) on an already-inserted row. Split
     * from `insert` to dodge the error-1442 trigger trap: an AFTER UPDATE that
     * does not change `status_id` leaves the subtask-counter trigger's inner
     * UPDATE un-fired, so this UPDATE is safe (the parent's `subtasks_count` is
     * not auto-incremented — a known pre-existing schema-trigger limitation).
     */
    async setParent(taskId, parentTaskId, nestingDepth, exec = this.db) {
        await exec
            .update(schema_1.tasks)
            .set({ parentTaskId, nestingDepth })
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId));
    }
    /**
     * Apply a partial column update by primary key (#5 PATCH / #10 bulk). Only
     * the supplied (whitelisted) columns are written; `updated_at` auto-bumps via
     * `onUpdateNow` (the ETag). NEVER pass a counter column or `parent_task_id`
     * here (the latter would fire the error-1442 trigger if status also changed —
     * use `setParent` with status untouched). Takes an optional `exec`.
     */
    async update(taskId, patch, exec = this.db) {
        await exec.update(schema_1.tasks).set(patch).where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId));
    }
    /**
     * Set / clear `archived_at` with an `archived_at IS NULL` (archive) or
     * `IS NOT NULL` (unarchive) guard so the conditional UPDATE is race-safe and
     * idempotent: it returns `true` only when the row actually transitioned
     * (affectedRows === 1), gating the audit write so a no-op or a concurrent
     * double-archive writes exactly one activity row. Mirrors `ListsRepo.archive`.
     */
    async archive(taskId, exec = this.db) {
        const [res] = await exec
            .update(schema_1.tasks)
            .set({ archivedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt)));
        return res.affectedRows === 1;
    }
    async unarchive(taskId, exec = this.db) {
        const [res] = await exec
            .update(schema_1.tasks)
            .set({ archivedAt: null })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId), (0, drizzle_orm_1.isNotNull)(schema_1.tasks.archivedAt)));
        return res.affectedRows === 1;
    }
    /**
     * Hard-delete a task by primary key. The inbound FKs from
     * `task_assignees`/`task_watchers`/`task_tags`/`task_dependencies`/
     * `task_activity` and child tasks (`fk_tasks_parent`) are all `ON DELETE
     * CASCADE`, so the DB tears those down; a single row delete suffices. Returns
     * the affected-row count (0 if a concurrent delete already won).
     */
    async hardDelete(taskId, exec = this.db) {
        const [res] = await exec.delete(schema_1.tasks).where((0, drizzle_orm_1.eq)(schema_1.tasks.id, taskId));
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
    async archiveDescendants(rootId, exec = this.db) {
        const kids = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.parentTaskId, rootId));
        const kidIds = kids.map((k) => k.id);
        if (kidIds.length === 0)
            return;
        await exec
            .update(schema_1.tasks)
            .set({ archivedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, kidIds), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt)));
        const grands = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.inArray)(schema_1.tasks.parentTaskId, kidIds));
        const grandIds = grands.map((g) => g.id);
        if (grandIds.length === 0)
            return;
        await exec
            .update(schema_1.tasks)
            .set({ archivedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, grandIds), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt)));
    }
    /** Reverse of `archiveDescendants` — clears `archived_at` on the subtree. */
    async unarchiveDescendants(rootId, exec = this.db) {
        const kids = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.parentTaskId, rootId));
        const kidIds = kids.map((k) => k.id);
        if (kidIds.length === 0)
            return;
        await exec
            .update(schema_1.tasks)
            .set({ archivedAt: null })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, kidIds), (0, drizzle_orm_1.isNotNull)(schema_1.tasks.archivedAt)));
        const grands = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.inArray)(schema_1.tasks.parentTaskId, kidIds));
        const grandIds = grands.map((g) => g.id);
        if (grandIds.length === 0)
            return;
        await exec
            .update(schema_1.tasks)
            .set({ archivedAt: null })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, grandIds), (0, drizzle_orm_1.isNotNull)(schema_1.tasks.archivedAt)));
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
    async listByList(params) {
        // RBAC P17 — the page and the count below share this predicate, which
        // is what keeps `total_estimate` honest under scoping (landmine L2).
        const visible = await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)());
        return this.db
            .select()
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)(this.filterWhere(params), visible))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.internalId))
            .limit(params.limit);
    }
    /**
     * Full task rows for a set of ids within a workspace (#10 bulk validate +
     * re-read). Ordered by the stable `internal_id`. Ids not in the workspace
     * are simply absent from the result — the caller compares the returned set
     * against the requested ids to fail-atomic on any cross-tenant / missing id.
     */
    async findManyByIdsInWorkspace(ids, workspaceId, exec = this.db) {
        if (ids.length === 0)
            return [];
        return exec
            .select()
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.inArray)(schema_1.tasks.id, ids), 
        // RBAC P17 — a bulk operation fails atomically on any id the
        // caller cannot see, because it is simply not returned.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.internalId));
    }
    /**
     * Every non-archived task in `workspaceId` attached to `sprintId`, across
     * lists (a sprint's tasks span lists). Powers `GET /sprints/:id/tasks`.
     */
    async findBySprintInWorkspace(sprintId, workspaceId) {
        return this.db
            .select()
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.eq)(schema_1.tasks.sprintId, sprintId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), 
        // RBAC P17 — a sprint spans lists; each one is filtered.
        await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.internalId));
    }
    /**
     * Apply one scalar column patch to many tasks in a single UPDATE (#10 bulk).
     * `updated_at` is included by the caller so the ETag bumps even when only
     * side tables change. NEVER pass a counter column or `parent_task_id`.
     */
    async updateMany(ids, patch, exec = this.db) {
        if (ids.length === 0)
            return;
        await exec.update(schema_1.tasks).set(patch).where((0, drizzle_orm_1.inArray)(schema_1.tasks.id, ids));
    }
    /** Exact count for the same filter set — feeds `pagination.total_estimate`. */
    async countByList(params) {
        const visible = await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)());
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)(this.filterWhere(params), visible));
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
    async countByPrimaryList(listId, exec = this.db) {
        const [row] = await exec
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, listId));
        return row?.value ?? 0;
    }
    /**
     * The caller's "my work": every non-archived task in `workspaceId` that the
     * user is assigned to, joined with its status's `status_group` so the
     * service can bucket by done-ness + due date. Ordered by due date then the
     * stable `internal_id`. Powers `GET /api/v1/tasks/my-work` (#11).
     */
    async myWorkRows(userId, workspaceId) {
        return this.db
            .select({ task: schema_1.tasks, statusGroup: schema_1.statuses.statusGroup })
            .from(schema_1.tasks)
            .innerJoin(schema_1.taskAssignees, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id), (0, drizzle_orm_1.eq)(schema_1.taskAssignees.userId, userId)))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.dueDate), (0, drizzle_orm_1.asc)(schema_1.tasks.internalId));
    }
    /**
     * F22 (ISS-011): the OPEN blockers of a task — edges whose blocked end is
     * this task and whose blocker sits on a not-done, not-closed status and is
     * not archived. `task.cannot_complete_blocked` fires while this is > 0.
     */
    async openBlockerCount(taskId, exec = this.db) {
        const [row] = await exec
            .select({ n: (0, drizzle_orm_1.count)() })
            .from(schema_1.taskDependencies)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.tasks.id, schema_1.taskDependencies.taskId))
            .innerJoin(schema_1.statuses, (0, drizzle_orm_1.eq)(schema_1.statuses.id, schema_1.tasks.statusId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskDependencies.relatedTaskId, taskId), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.notInArray)(schema_1.statuses.statusGroup, ["done", "closed"])));
        return row?.n ?? 0;
    }
    /**
     * F25 (ISS-066): resolve the `T-<n>` key the UI actually displays.
     *
     * `task_number` is unique PER LIST (`uq_tasks_list_number`), not per
     * workspace — in the demo data alone, thirteen tasks are "T-1". So a
     * `#T-<n>` reference is resolved inside the HOST TASK'S LIST, where the
     * number is unique by construction and where the reference almost always
     * means a sibling on the same board. A `T-<n>` from another list stays
     * unresolved rather than guessing between thirteen candidates.
     */
    async findByTaskNumberInList(listId, taskNumber, exec = this.db) {
        const [row] = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, listId), (0, drizzle_orm_1.eq)(schema_1.tasks.taskNumber, taskNumber), await (0, context_1.listScopeFilter)(schema_1.tasks.primaryListId, await (0, ownEscape_1.taskOwnEscape)())))
            .limit(1);
        return row ?? null;
    }
    /**
     * F16: every descendant id of a task — children, then grandchildren. Same
     * two-level walk as `archiveDescendants` (nesting depth is capped at 2).
     * The hard-delete path needs the whole subtree BEFORE the root row goes,
     * because the FK cascade will take the descendants with it — and their
     * notifications (ISS-073) and R2 keys (ISS-022) have no FK to follow.
     */
    async descendantIds(rootId, exec = this.db) {
        const kids = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.parentTaskId, rootId));
        const kidIds = kids.map((k) => k.id);
        if (kidIds.length === 0)
            return [];
        const grands = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.inArray)(schema_1.tasks.parentTaskId, kidIds));
        return [...kidIds, ...grands.map((g) => g.id)];
    }
    /**
     * Descendants (children + grandchildren) filtered by archival state
     * (team-access P3): the archive/unarchive cascade writes one audit row
     * per descendant it ACTUALLY flips, so the caller reads "who is about to
     * transition" before the cascade runs — same 2-level shape as
     * `descendantIds` / the cascade writers.
     */
    async descendantIdsByArchivedState(rootId, archived, exec = this.db) {
        const stateFilter = archived
            ? (0, drizzle_orm_1.isNotNull)(schema_1.tasks.archivedAt)
            : (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt);
        const kids = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.eq)(schema_1.tasks.parentTaskId, rootId));
        const kidIds = kids.map((k) => k.id);
        if (kidIds.length === 0)
            return [];
        const matchingKids = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.id, kidIds), stateFilter));
        const grands = await exec
            .select({ id: schema_1.tasks.id })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.tasks.parentTaskId, kidIds), stateFilter));
        return [...matchingKids.map((k) => k.id), ...grands.map((g) => g.id)];
    }
    /**
     * F15 (ISS-046): recompute a parent's `subtasks_count` /
     * `subtasks_completed` from the rows themselves.
     *
     * These two columns were maintained by NOTHING — every task reported 0/0 —
     * and they cannot be triggers: MySQL forbids a trigger on `tasks` from
     * modifying `tasks`, which is why the original `trg_subtasks_after_*`
     * triggers were removed (they crashed every subtask status change with
     * ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG). `schema.sql:1482-1488` records
     * that decision and says the maintenance must be app-side. This is it.
     *
     * RECOMPUTE, not increment. The other two counter bugs in this phase
     * (comments, submissions) were both increment-only rules that drifted the
     * moment a write happened by a path their author had not pictured. An
     * absolute recompute cannot drift: whatever the callers miss, the next call
     * repairs. It is one indexed UPDATE against `idx_tasks_parent`, on a write
     * path that is already inside a transaction.
     *
     * "Counts" = a live (non-archived) child, matching what
     * `GET /tasks/:id/subtasks` returns, so the badge and the list agree.
     * "Completed" = that child sits on a done/closed-group status.
     */
    async recomputeSubtaskCounters(parentId, exec = this.db) {
        // JOIN against a DERIVED table, not a correlated subquery: MySQL
        // refuses `UPDATE tasks … (SELECT … FROM tasks …)` with error 1093,
        // "You can't specify target table for update in FROM clause". A
        // derived table is materialised first, so it is allowed — the same
        // family of restriction that made the original subtask TRIGGERS
        // impossible (schema.sql:1482-1488).
        await exec.execute((0, drizzle_orm_1.sql) `
            UPDATE ${schema_1.tasks} p
              LEFT JOIN (
                    SELECT c.parent_task_id AS pid,
                           COUNT(*) AS cnt,
                           SUM(s.status_group IN ('done', 'closed')) AS done_cnt
                      FROM ${schema_1.tasks} c
                      JOIN ${schema_1.statuses} s ON s.id = c.status_id
                     WHERE c.parent_task_id = ${parentId}
                       AND c.archived_at IS NULL
                     GROUP BY c.parent_task_id
                ) agg ON agg.pid = p.id
               SET p.subtasks_count = COALESCE(agg.cnt, 0),
                   p.subtasks_completed = COALESCE(agg.done_cnt, 0)
             WHERE p.id = ${parentId}
        `);
    }
    /**
     * Checklist rollup for one task (upgrades/022): items across ALL of its
     * checklists → `checklist_items_total` / `checklist_items_done`. Same
     * ABSOLUTE-recompute design as `recomputeSubtaskCounters` above (whatever
     * a caller misses, the next call repairs; derived-table JOIN for the same
     * error-1093 reason). Called by every ChecklistsService write that can
     * change either number, inside that write's transaction.
     */
    async recomputeChecklistCounters(taskId, exec = this.db) {
        await exec.execute((0, drizzle_orm_1.sql) `
            UPDATE ${schema_1.tasks} t
              LEFT JOIN (
                    SELECT cl.task_id AS tid,
                           COUNT(*) AS cnt,
                           SUM(ci.is_completed) AS done_cnt
                      FROM ${schema_1.checklistItems} ci
                      JOIN ${schema_1.checklists} cl ON cl.id = ci.checklist_id
                     WHERE cl.task_id = ${taskId}
                     GROUP BY cl.task_id
                ) agg ON agg.tid = t.id
               SET t.checklist_items_total = COALESCE(agg.cnt, 0),
                   t.checklist_items_done = COALESCE(agg.done_cnt, 0)
             WHERE t.id = ${taskId}
        `);
    }
    /**
     * The space each task lives in (via its primary list), keyed by task id.
     * F8's scope guard builds its `PermissionContext` from this — tasks carry
     * no space column of their own, so the one-hop join lives here rather than
     * being re-derived by every write service.
     */
    async spaceIdsByTask(taskIds) {
        if (taskIds.length === 0)
            return new Map();
        const rows = await this.db
            .select({ taskId: schema_1.tasks.id, spaceId: schema_1.lists.spaceId })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.tasks.primaryListId))
            .where((0, drizzle_orm_1.inArray)(schema_1.tasks.id, taskIds));
        return new Map(rows.map((r) => [r.taskId, r.spaceId]));
    }
    /**
     * Team-access P7 (G4): the task → space → HEAD composition, unified — two
     * services used to hand-roll it in two different ways. One indexed join
     * feeding the scope guard's `spaceHeadUserId` (the head-of-owning-space
     * edit allow-path).
     */
    async spaceInfoByTask(taskIds) {
        if (taskIds.length === 0)
            return new Map();
        const rows = await this.db
            .select({
            taskId: schema_1.tasks.id,
            spaceId: schema_1.lists.spaceId,
            headUserId: schema_1.spaces.headUserId,
        })
            .from(schema_1.tasks)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.tasks.primaryListId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.inArray)(schema_1.tasks.id, taskIds));
        return new Map(rows.map((r) => [
            r.taskId,
            { spaceId: r.spaceId, headUserId: r.headUserId },
        ]));
    }
    /** Assignee user-ids for a page of tasks, grouped by task id. */
    /**
     * The overdue-alert job's scan (upgrades/014): open tasks in `workspaceId`
     * whose `due_date` is strictly BEFORE `todayYmd` (the workspace's own
     * calendar day — the caller computes it via `todayInZone`), not yet
     * claimed, and having at least one assignee. Tasks with NO assignees are
     * deliberately excluded rather than claimed, so someone assigned while
     * the task is already overdue still gets alerted on the next tick.
     * Served by `idx_tasks_overdue_scan`; `limit` bounds one tick's burst.
     */
    async findOverdueUnnotified(workspaceId, todayYmd, limit) {
        return this.db
            .select({
            id: schema_1.tasks.id,
            name: schema_1.tasks.name,
            dueDate: schema_1.tasks.dueDate,
        })
            .from(schema_1.tasks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNotNull)(schema_1.tasks.dueDate), (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} < ${todayYmd}`, (0, drizzle_orm_1.isNull)(schema_1.tasks.completedAt), (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), (0, drizzle_orm_1.isNull)(schema_1.tasks.overdueNotifiedAt), (0, drizzle_orm_1.exists)(this.db
            .select({ one: (0, drizzle_orm_1.sql) `1` })
            .from(schema_1.taskAssignees)
            .where((0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id)))))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tasks.dueDate))
            .limit(limit);
    }
    /**
     * The once-only claim: stamp `overdue_notified_at` on the alerted tasks.
     * Called in the SAME transaction as the `overdue` notification inserts.
     */
    async markOverdueNotified(taskIds, exec = this.db) {
        if (taskIds.length === 0)
            return;
        await exec
            .update(schema_1.tasks)
            .set({ overdueNotifiedAt: new Date() })
            .where((0, drizzle_orm_1.inArray)(schema_1.tasks.id, taskIds));
    }
    async assigneesByTask(taskIds) {
        if (taskIds.length === 0)
            return new Map();
        const rows = await this.db
            .select({
            taskId: schema_1.taskAssignees.taskId,
            userId: schema_1.taskAssignees.userId,
        })
            .from(schema_1.taskAssignees)
            .where((0, drizzle_orm_1.inArray)(schema_1.taskAssignees.taskId, taskIds))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.taskAssignees.taskId), (0, drizzle_orm_1.asc)(schema_1.taskAssignees.assignedAt));
        return groupValues(rows, (r) => r.taskId, (r) => r.userId);
    }
    /** Watcher user-ids for a page of tasks, grouped by task id. */
    async watchersByTask(taskIds) {
        if (taskIds.length === 0)
            return new Map();
        const rows = await this.db
            .select({
            taskId: schema_1.taskWatchers.taskId,
            userId: schema_1.taskWatchers.userId,
        })
            .from(schema_1.taskWatchers)
            .where((0, drizzle_orm_1.inArray)(schema_1.taskWatchers.taskId, taskIds))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.taskWatchers.taskId), (0, drizzle_orm_1.asc)(schema_1.taskWatchers.startedAt));
        return groupValues(rows, (r) => r.taskId, (r) => r.userId);
    }
    /** Tag ids for a page of tasks, grouped by task id. */
    async tagsByTask(taskIds) {
        if (taskIds.length === 0)
            return new Map();
        const rows = await this.db
            .select({ taskId: schema_1.taskTags.taskId, tagId: schema_1.taskTags.tagId })
            .from(schema_1.taskTags)
            .where((0, drizzle_orm_1.inArray)(schema_1.taskTags.taskId, taskIds))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.taskTags.taskId), (0, drizzle_orm_1.asc)(schema_1.taskTags.addedAt));
        return groupValues(rows, (r) => r.taskId, (r) => r.tagId);
    }
    /**
     * Custom-field values for a page of tasks, grouped by task id into the wire
     * `{ [fieldId]: value }` map. When `redactGuest` is set, fields marked
     * `hidden_from_guests` are omitted.
     */
    async customFieldValuesByTask(taskIds, redactGuest) {
        const map = new Map();
        if (taskIds.length === 0)
            return map;
        const rows = await this.db
            .select({
            taskId: schema_1.taskCustomFieldValues.taskId,
            fieldId: schema_1.taskCustomFieldValues.customFieldId,
            value: schema_1.taskCustomFieldValues.value,
        })
            .from(schema_1.taskCustomFieldValues)
            .innerJoin(schema_1.customFields, (0, drizzle_orm_1.eq)(schema_1.customFields.id, schema_1.taskCustomFieldValues.customFieldId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.taskCustomFieldValues.taskId, taskIds), redactGuest
            ? (0, drizzle_orm_1.eq)(schema_1.customFields.hiddenFromGuests, false)
            : undefined));
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
    filterWhere(params) {
        const pattern = params.q && params.q.length > 0
            ? `%${escapeLike(params.q)}%`
            : undefined;
        return (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, params.workspaceId), (0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, params.listId), params.includeArchived ? undefined : (0, drizzle_orm_1.isNull)(schema_1.tasks.archivedAt), params.includeSubtasks ? undefined : (0, drizzle_orm_1.isNull)(schema_1.tasks.parentTaskId), params.statusIds?.length
            ? (0, drizzle_orm_1.inArray)(schema_1.tasks.statusId, params.statusIds)
            : undefined, params.statusGroups?.length
            ? (0, drizzle_orm_1.inArray)(schema_1.tasks.statusId, this.db
                .select({ id: schema_1.statuses.id })
                .from(schema_1.statuses)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.statuses.scopeType, "list"), (0, drizzle_orm_1.eq)(schema_1.statuses.scopeId, params.listId), (0, drizzle_orm_1.inArray)(schema_1.statuses.statusGroup, params.statusGroups))))
            : undefined, params.priorities?.length
            ? (0, drizzle_orm_1.inArray)(schema_1.tasks.priority, params.priorities)
            : undefined, params.taskTypeIds?.length
            ? (0, drizzle_orm_1.inArray)(schema_1.tasks.taskTypeId, params.taskTypeIds)
            : undefined, params.reviewerId
            ? (0, drizzle_orm_1.eq)(schema_1.tasks.reviewerId, params.reviewerId)
            : undefined, params.sprintId ? (0, drizzle_orm_1.eq)(schema_1.tasks.sprintId, params.sprintId) : undefined, params.bugSeverities?.length
            ? (0, drizzle_orm_1.inArray)(schema_1.tasks.bugSeverity, params.bugSeverities)
            : undefined, params.assigneeIds?.length
            ? (0, drizzle_orm_1.exists)(this.db
                .select({ n: (0, drizzle_orm_1.sql) `1` })
                .from(schema_1.taskAssignees)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskAssignees.taskId, schema_1.tasks.id), (0, drizzle_orm_1.inArray)(schema_1.taskAssignees.userId, params.assigneeIds))))
            : undefined, params.tagIds?.length
            ? (0, drizzle_orm_1.exists)(this.db
                .select({ n: (0, drizzle_orm_1.sql) `1` })
                .from(schema_1.taskTags)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskTags.taskId, schema_1.tasks.id), (0, drizzle_orm_1.inArray)(schema_1.taskTags.tagId, params.tagIds))))
            : undefined, pattern
            ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.tasks.name, pattern), (0, drizzle_orm_1.like)(schema_1.tasks.customId, pattern))
            : undefined, params.dueAfter
            ? (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} >= ${params.dueAfter}`
            : undefined, params.dueBefore
            ? (0, drizzle_orm_1.sql) `${schema_1.tasks.dueDate} <= ${params.dueBefore}`
            : undefined, params.afterId
            ? (0, drizzle_orm_1.gt)(schema_1.tasks.internalId, BigInt(params.afterId))
            : undefined);
    }
}
exports.TasksRepo = TasksRepo;
/**
 * Escape LIKE wildcards (`%`, `_`) and the escape char so a user's `q` matches
 * literally — the value is still parameter-bound, this only neutralises
 * wildcard semantics. Mirrors the helper in `UsersRepo`.
 */
const escapeLike = (input) => input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
/** Group rows into `Map<key, value[]>`, preserving row order within each key. */
const groupValues = (rows, keyOf, valueOf) => {
    const map = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        const arr = map.get(key) ?? [];
        arr.push(valueOf(row));
        map.set(key, arr);
    }
    return map;
};
