"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const context_1 = require("../rbac/context");
class ListsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * All lists in a space, ordered by `position` then `id` so the sequence is
     * deterministic even when two lists share a position. By default archived
     * lists are excluded (`archived_at IS NULL`); pass `includeArchived` to
     * surface them.
     *
     * The filter + primary sort are covered by `idx_lists_space_archived`
     * `(space_id, archived_at, position)`.
     */
    async findBySpace(spaceId, includeArchived) {
        // RBAC P16 — a list inherits its space's visibility.
        const visible = await (0, context_1.spaceScopeFilter)(schema_1.lists.spaceId);
        const where = includeArchived
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), visible)
            : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt), visible);
        return this.db
            .select({
            id: schema_1.lists.id,
            spaceId: schema_1.lists.spaceId,
            name: schema_1.lists.name,
            description: schema_1.lists.description,
            icon: schema_1.lists.icon,
            color: schema_1.lists.color,
            position: schema_1.lists.position,
            defaultTaskTypeId: schema_1.lists.defaultTaskTypeId,
            isPrivate: schema_1.lists.isPrivate,
            archivedAt: schema_1.lists.archivedAt,
            createdBy: schema_1.lists.createdBy,
            createdAt: schema_1.lists.createdAt,
        })
            .from(schema_1.lists)
            .where(where)
            .orderBy((0, drizzle_orm_1.asc)(schema_1.lists.position), (0, drizzle_orm_1.asc)(schema_1.lists.id));
    }
    /**
     * Every list in a workspace, across all its spaces. A `lists` row has no
     * `workspace_id` column — it reaches a workspace only through its parent
     * `spaces` row — so this joins `lists → spaces` and filters on
     * `spaces.workspace_id`. That join IS the tenant-isolation guard: a list
     * from another workspace can never surface, and a cross-workspace
     * `spaceId` filter simply matches nothing.
     *
     * `spaceId` (optional) narrows to a single space; archived lists
     * (`archived_at IS NOT NULL`) are excluded unless `includeArchived`. Rows are
     * grouped by space then ordered by `position`, with a stable `id` tie-break,
     * so the sequence is deterministic across calls. The per-space filter + sort
     * is covered by `idx_lists_space_archived (space_id, archived_at, position)`;
     * the workspace fan-out is driven by `idx_spaces_workspace_archived`.
     */
    async listByWorkspace(workspaceId, opts) {
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId)];
        if (opts.spaceId !== undefined) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, opts.spaceId));
        }
        if (!opts.includeArchived) {
            conditions.push((0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt));
        }
        // RBAC P16 — a list inherits its space's visibility.
        const visible = await (0, context_1.spaceScopeFilter)(schema_1.lists.spaceId);
        if (visible)
            conditions.push(visible);
        return this.db
            .select({
            id: schema_1.lists.id,
            spaceId: schema_1.lists.spaceId,
            name: schema_1.lists.name,
            description: schema_1.lists.description,
            icon: schema_1.lists.icon,
            color: schema_1.lists.color,
            position: schema_1.lists.position,
            defaultTaskTypeId: schema_1.lists.defaultTaskTypeId,
            isPrivate: schema_1.lists.isPrivate,
            archivedAt: schema_1.lists.archivedAt,
            createdBy: schema_1.lists.createdBy,
            createdAt: schema_1.lists.createdAt,
        })
            .from(schema_1.lists)
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, schema_1.spaces.id))
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.lists.spaceId), (0, drizzle_orm_1.asc)(schema_1.lists.position), (0, drizzle_orm_1.asc)(schema_1.lists.id));
    }
    /**
     * Resolve a list id *within a workspace*. A `lists` row reaches a workspace
     * only through its parent `spaces` row (there is no `workspace_id` column on
     * `lists`), so this joins `lists → spaces` and filters on
     * `spaces.workspace_id`. Returns the bare id when the list exists in that
     * workspace, else `null`.
     *
     * This is the workspace-isolation guard for list-scoped sub-resources such
     * as statuses: callers translate a `null` into `404 list.not_found`, so a
     * cross-workspace id is indistinguishable from a non-existent one — no
     * existence oracle across workspaces.
     */
    async findByIdInWorkspace(listId, workspaceId) {
        const [row] = await this.db
            .select({ id: schema_1.lists.id })
            .from(schema_1.lists)
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, schema_1.spaces.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.id, listId), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), 
        // RBAC P16 — invisible resolves to null → the caller's 404.
        await (0, context_1.spaceScopeFilter)(schema_1.lists.spaceId)))
            .limit(1);
        return row ?? null;
    }
    /**
     * Fetch one list's full wire record within a workspace. The full-record
     * sibling of `findByIdInWorkspace` (which returns only `{ id }` as a
     * lightweight isolation guard for sub-resources): same `lists → spaces` join
     * and `spaces.workspace_id` filter, but selecting every column the wire
     * `List` needs. Returns `null` when the id does not exist OR belongs to
     * another workspace, so the caller maps both to `404 list.not_found` (no
     * cross-workspace existence oracle).
     *
     * `archived_at` is intentionally NOT filtered — an archived list still
     * exists, and the detail / unarchive flows need to read it, so it resolves
     * here rather than 404 (mirrors `SpacesRepo.findByIdInWorkspace` and
     * `TasksService.getById`).
     */
    async findRecordByIdInWorkspace(listId, workspaceId, exec = this.db) {
        const [row] = await exec
            .select({
            id: schema_1.lists.id,
            spaceId: schema_1.lists.spaceId,
            name: schema_1.lists.name,
            description: schema_1.lists.description,
            icon: schema_1.lists.icon,
            color: schema_1.lists.color,
            position: schema_1.lists.position,
            defaultTaskTypeId: schema_1.lists.defaultTaskTypeId,
            isPrivate: schema_1.lists.isPrivate,
            archivedAt: schema_1.lists.archivedAt,
            createdBy: schema_1.lists.createdBy,
            createdAt: schema_1.lists.createdAt,
        })
            .from(schema_1.lists)
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.lists.spaceId, schema_1.spaces.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.id, listId), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), 
        // RBAC P16 — invisible resolves to null → the caller's 404.
        await (0, context_1.spaceScopeFilter)(schema_1.lists.spaceId)))
            .limit(1);
        return row ?? null;
    }
    /**
     * The next free `position` for a new list in a space: one past the current
     * maximum, or `0` when the space has none yet. New lists append to the end
     * of the space's order. The maximum is taken across ALL lists in the space
     * (archived included) so positions stay monotonic and an archived list never
     * lets a new one reuse its slot. Backed by `idx_lists_space_archived
     * (space_id, archived_at, position)`.
     *
     * Pass `exec` to read inside the create tx so the value is consistent with
     * the insert that follows.
     */
    async nextPosition(spaceId, exec = this.db) {
        const [row] = await exec
            .select({ maxPosition: (0, drizzle_orm_1.max)(schema_1.lists.position) })
            .from(schema_1.lists)
            .where((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId));
        const current = row?.maxPosition;
        return (current == null ? -1 : Number(current)) + 1;
    }
    /**
     * Insert a list and return its generated id. `created_at` / `updated_at`
     * default in the DB (and `archived_at` stays NULL) so the row's timestamps
     * are authoritative; the service re-reads via `findRecordByIdInWorkspace`
     * (inside the same tx) to return the canonical wire shape. Omitted optional
     * columns (`icon` / `color`) are written explicitly by the caller from the
     * schema defaults, so the row reflects exactly what was requested.
     *
     * Pass `exec` to run inside the caller's transaction so the paired status
     * seeding + `workspace_activity` write are atomic with this insert.
     */
    async insert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("l");
        await exec.insert(schema_1.lists).values({
            id,
            spaceId: input.spaceId,
            name: input.name,
            description: input.description,
            icon: input.icon,
            color: input.color,
            isPrivate: input.isPrivate,
            position: input.position,
            defaultTaskTypeId: input.defaultTaskTypeId,
            createdBy: input.createdBy,
        });
        return id;
    }
    /**
     * Apply a partial update by id. Only the keys present in `patch` are written
     * (`undefined` keys are skipped), so untouched columns are never overwritten;
     * `description` / `defaultTaskTypeId` accept an explicit `null` to clear the
     * field. `updated_at` auto-bumps via the column's `ON UPDATE`. The write is
     * keyed on the PK alone, so the caller MUST have resolved the id within the
     * workspace first (and re-reads via `findRecordByIdInWorkspace` for the wire
     * shape). Pass `exec` to run inside the update tx. Caller guarantees `patch`
     * is non-empty.
     */
    /**
     * One list by NAME within a space — the pre-check for F27's
     * `uq_lists_space_name`. Matching is whatever the column's collation says,
     * and `lists.name` is `utf8mb4_unicode_ci`, so "Bugs" finds "bugs" for free.
     * Archived lists are included on purpose: the index covers them too, so an
     * archived list still owns its name.
     */
    async findByNameInSpace(spaceId, name, exec = this.db) {
        const rows = await exec
            .select({ id: schema_1.lists.id })
            .from(schema_1.lists)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.eq)(schema_1.lists.name, name)))
            .limit(1);
        return rows[0] ?? null;
    }
    async update(listId, patch, exec = this.db) {
        const setValues = {};
        if (patch.name !== undefined)
            setValues.name = patch.name;
        if (patch.description !== undefined)
            setValues.description = patch.description;
        if (patch.icon !== undefined)
            setValues.icon = patch.icon;
        if (patch.color !== undefined)
            setValues.color = patch.color;
        if (patch.defaultTaskTypeId !== undefined)
            setValues.defaultTaskTypeId = patch.defaultTaskTypeId;
        if (patch.spaceId !== undefined)
            setValues.spaceId = patch.spaceId;
        await exec.update(schema_1.lists).set(setValues).where((0, drizzle_orm_1.eq)(schema_1.lists.id, listId));
    }
    /**
     * Archive a list (set `archived_at = now`) only if it is not already
     * archived. The `archived_at IS NULL` predicate makes this a race-safe,
     * idempotent transition: the UPDATE's row lock serialises concurrent
     * archives, and `affectedRows` tells the caller whether THIS call did the
     * flip (1) or it was already archived / gone (0) — so the paired
     * `workspace_activity` row is written exactly once. Keyed on the PK, so the
     * caller MUST have resolved the id within the workspace first. `updated_at`
     * auto-bumps via the column's `ON UPDATE`.
     */
    async archive(listId, exec = this.db) {
        const [result] = await exec
            .update(schema_1.lists)
            .set({ archivedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.id, listId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)));
        return result.affectedRows > 0;
    }
    /**
     * Unarchive a list (clear `archived_at`) only if it is currently archived.
     * The mirror of `archive`: the `archived_at IS NOT NULL` predicate makes it a
     * race-safe, idempotent transition, and `affectedRows` (1 = flipped, 0 =
     * was not archived / gone) drives exactly-once activity. Keyed on the PK.
     */
    async unarchive(listId, exec = this.db) {
        const [result] = await exec
            .update(schema_1.lists)
            .set({ archivedAt: null })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.id, listId), (0, drizzle_orm_1.isNotNull)(schema_1.lists.archivedAt)));
        return result.affectedRows > 0;
    }
    /**
     * Hard-delete a list and tear down its list-scoped children, returning the
     * number of `lists` rows removed (0 when a concurrent delete already won).
     *
     * `statuses` are polymorphic children with NO foreign key to `lists`
     * (`statuses.scope_id` is validated in the app layer), so they would orphan
     * on delete — they are removed first, in the same tx. `forms` DO have
     * `fk_forms_list ON DELETE CASCADE`, so the DB clears them automatically.
     * (`custom_fields` are likewise polymorphic-and-FK-less, but §17 has no
     * create path in V1 so none can exist; when §17 lands, purge them here too.)
     *
     * Keyed on the PK — the caller MUST resolve the id within the workspace and
     * enforce the archived + empty preconditions first. `fk_tasks_list ON DELETE
     * RESTRICT` is the race-safe backstop: if a task is created against this list
     * between the caller's emptiness check and this delete, the driver rejects it
     * with `ER_ROW_IS_REFERENCED_2` for the service to map to `409
     * list.not_empty`. Always call inside the delete tx (pass `exec`).
     */
    async hardDelete(listId, exec = this.db) {
        await exec
            .delete(schema_1.statuses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.statuses.scopeType, "list"), (0, drizzle_orm_1.eq)(schema_1.statuses.scopeId, listId)));
        const [result] = await exec.delete(schema_1.lists).where((0, drizzle_orm_1.eq)(schema_1.lists.id, listId));
        return result.affectedRows;
    }
    /**
     * Count the non-archived lists in a space (`space_id = ? AND archived_at IS
     * NULL`). Backed by `idx_lists_space_archived (space_id, archived_at,
     * position)`. Used by the spaces hard-delete guard (a space must be "empty"
     * — no live lists — before it can be deleted) and to report how many lists a
     * space-archive cascade will touch. Pass `exec` to read inside a caller's
     * transaction.
     */
    async countNonArchivedBySpace(spaceId, exec = this.db) {
        const [row] = await exec
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.lists)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)));
        return row?.value ?? 0;
    }
    /**
     * Cascade-archive every non-archived list in a space, stamping the same
     * `archived_at` instant the parent space gets. Already-archived lists are
     * left untouched (so a later space-unarchive cannot tell which lists it
     * cascade-archived — see `SpacesService.unarchive`). Pass `exec` to run
     * inside the space-archive transaction so the parent + children flip
     * atomically.
     */
    async archiveAllBySpace(spaceId, asOf, exec = this.db) {
        await exec
            .update(schema_1.lists)
            .set({ archivedAt: asOf })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.isNull)(schema_1.lists.archivedAt)));
    }
    /**
     * F16 (ISS-041): restore exactly the lists the matching space-archive took
     * down — the ones whose `archived_at` equals the space's own `archived_at`
     * instant. The cascade above stamps every list with the SAME `asOf` the
     * space gets, and it skips lists that were already archived, so those keep
     * their earlier timestamp and this equality can never resurrect a list a
     * user archived independently. That was the stated reason unarchive did not
     * cascade at all — and the result was a space that came back EMPTY: P8
     * archived Marketing for two seconds and its three boards were invisible
     * for ninety minutes until someone noticed. Returns the restored count for
     * the activity row.
     */
    async unarchiveBySpaceArchivedAt(spaceId, asOf, exec = this.db) {
        const [result] = await exec
            .update(schema_1.lists)
            .set({ archivedAt: null })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId), (0, drizzle_orm_1.eq)(schema_1.lists.archivedAt, asOf)));
        return result.affectedRows;
    }
    /**
     * Count ALL lists in a space (archived and non-archived). Backed by
     * `idx_lists_space_archived`. Used by the spaces hard-delete guard: a space
     * must hold NO lists at all before it can be permanently deleted, because
     * the DB cascades `lists` on a space delete but does NOT cascade a list's
     * own children — `tasks` (`fk_tasks_list ON DELETE RESTRICT`) would block the
     * delete and `statuses` (polymorphic, no FK) would orphan. Archived lists
     * must first be removed via the §6 list-delete endpoint. Pass `exec` to read
     * inside the delete transaction.
     */
    async countBySpace(spaceId, exec = this.db) {
        const [row] = await exec
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.lists)
            .where((0, drizzle_orm_1.eq)(schema_1.lists.spaceId, spaceId));
        return row?.value ?? 0;
    }
    /**
     * Every list id inside the given spaces — the `listIds` half of a
     * `VisibilityScope` (RBAC_DYNAMIC_PLAN.md P8). Implements
     * `rbac/scope.ts#ListScopeSource`.
     *
     * Archived lists ARE included: visibility and archiving are separate
     * filters, and a caller that excludes archived rows still does so with its
     * own predicate. Joining `spaces` costs a PK lookup and buys tenant safety
     * — `lists` has no `workspace_id` of its own, so without the join a stray
     * space id from another workspace would widen what the caller can see.
     *
     * Backed by `idx_lists_space_archived (space_id, …)`.
     */
    async idsBySpaces(spaceIds, workspaceId, exec = this.db) {
        if (spaceIds.length === 0)
            return [];
        const rows = await exec
            .select({ id: schema_1.lists.id })
            .from(schema_1.lists)
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.lists.spaceId, [...spaceIds]), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId)));
        return rows.map((r) => r.id);
    }
}
exports.ListsRepo = ListsRepo;
