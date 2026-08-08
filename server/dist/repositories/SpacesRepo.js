"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpacesRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const context_1 = require("../rbac/context");
const utils_1 = require("../utils");
class SpacesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * List the spaces in a workspace, ordered by `position` with a stable
     * tie-break on `id`. Archived rows (`archived_at IS NOT NULL`) are excluded
     * unless `includeArchived` is set.
     *
     * Backed by `idx_spaces_workspace_archived (workspace_id, archived_at,
     * position)`.
     */
    async listByWorkspace(workspaceId, opts) {
        // RBAC P16 — the caller sees only the spaces they are assigned to.
        // `undefined` for an unrestricted viewer, so the SQL is unchanged.
        const visible = await (0, context_1.spaceScopeFilter)(schema_1.spaces.id);
        const where = opts.includeArchived
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), visible)
            : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.spaces.archivedAt), visible);
        const rows = await this.db
            .select({
            id: schema_1.spaces.id,
            name: schema_1.spaces.name,
            description: schema_1.spaces.description,
            icon: schema_1.spaces.icon,
            color: schema_1.spaces.color,
            isPrivate: schema_1.spaces.isPrivate,
            headUserId: schema_1.spaces.headUserId,
            position: schema_1.spaces.position,
            archivedAt: schema_1.spaces.archivedAt,
            createdBy: schema_1.spaces.createdBy,
            createdAt: schema_1.spaces.createdAt,
        })
            .from(schema_1.spaces)
            .where(where)
            .orderBy((0, drizzle_orm_1.asc)(schema_1.spaces.position), (0, drizzle_orm_1.asc)(schema_1.spaces.id));
        return rows;
    }
    /**
     * Resolve one space by id within a workspace. Returns `null` when the id
     * does not exist OR belongs to another workspace, so callers can translate
     * both to `404 space.not_found` (no cross-workspace existence oracle).
     *
     * `archived_at` is intentionally NOT filtered — an archived space still
     * exists (its lists are cascade-archived), so it resolves here rather than
     * 404.
     *
     * Pass `exec` to read inside a caller's transaction — `create` uses this to
     * fetch the just-inserted row (authoritative DB `created_at`) before commit.
     */
    async findByIdInWorkspace(spaceId, workspaceId, exec = this.db) {
        const [row] = await exec
            .select({
            id: schema_1.spaces.id,
            name: schema_1.spaces.name,
            description: schema_1.spaces.description,
            icon: schema_1.spaces.icon,
            color: schema_1.spaces.color,
            isPrivate: schema_1.spaces.isPrivate,
            headUserId: schema_1.spaces.headUserId,
            position: schema_1.spaces.position,
            archivedAt: schema_1.spaces.archivedAt,
            createdBy: schema_1.spaces.createdBy,
            createdAt: schema_1.spaces.createdAt,
        })
            .from(schema_1.spaces)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.id, spaceId), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), 
        // RBAC P16 — an invisible space resolves to null, which
        // every caller already turns into 404 (D-9: reads deny by
        // 404 so there is no existence oracle).
        await (0, context_1.spaceScopeFilter)(schema_1.spaces.id)))
            .limit(1);
        return row ?? null;
    }
    /**
     * Insert a space and return its generated id. `created_at` / `updated_at`
     * are left to their DB defaults (and `archived_at` to NULL) so the row's
     * timestamps are authoritative; the service re-reads via
     * `findByIdInWorkspace` to return the canonical wire shape.
     *
     * Pass `exec` to run inside the caller's transaction so the paired
     * `workspace_activity` write is atomic with this insert.
     */
    async insert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("sp");
        await exec.insert(schema_1.spaces).values({
            id,
            workspaceId: input.workspaceId,
            name: input.name,
            description: input.description,
            icon: input.icon,
            color: input.color,
            isPrivate: input.isPrivate,
            position: input.position,
            createdBy: input.createdBy,
            headUserId: input.headUserId ?? null,
        });
        return id;
    }
    /**
     * Acquire a row lock on the space (`SELECT … FOR UPDATE`) inside a
     * transaction so concurrent writes to the SAME space (update / archive /
     * unarchive / delete) serialize. Every writer takes this lock first, in the
     * same order, which removes the InnoDB deadlock between the row mutation and
     * its paired `workspace_activity` append, and lets the caller re-read the
     * authoritative row state race-free. Mirrors `TasksRepo.lockById`.
     */
    async lockById(spaceId, exec = this.db) {
        await exec
            .select({ id: schema_1.spaces.id })
            .from(schema_1.spaces)
            .where((0, drizzle_orm_1.eq)(schema_1.spaces.id, spaceId))
            .for("update");
    }
    /**
     * Apply a partial update to a space. Only the keys present in `fields` are
     * written (Drizzle's `.set()` emits a column only when its key exists), so
     * an omitted field is left untouched; `updated_at` bumps automatically via
     * its `ON UPDATE CURRENT_TIMESTAMP`. The caller must pass at least one field
     * — an empty `.set()` is invalid SQL — and scopes the workspace check before
     * calling. Pass `exec` to run inside the caller's transaction.
     */
    async updateFields(spaceId, fields, exec = this.db) {
        await exec.update(schema_1.spaces).set(fields).where((0, drizzle_orm_1.eq)(schema_1.spaces.id, spaceId));
    }
    /**
     * Set (archive) or clear (unarchive) a space's `archived_at`. A `Date`
     * soft-deletes the space; `null` restores it. `updated_at` bumps via its
     * `ON UPDATE CURRENT_TIMESTAMP`. Pass `exec` to run inside the caller's
     * transaction so the flip and its `workspace_activity` row (and any list
     * cascade) commit atomically.
     */
    async setArchivedAt(spaceId, value, exec = this.db) {
        await exec
            .update(schema_1.spaces)
            .set({ archivedAt: value })
            .where((0, drizzle_orm_1.eq)(schema_1.spaces.id, spaceId));
    }
    /**
     * Permanently delete a space by id, returning the number of rows removed
     * (0 when a concurrent delete already won). The caller MUST enforce the
     * preconditions first (resolved within the workspace, archived, and holding
     * NO lists). With no lists the space has no children to cascade — list-scoped
     * statuses/tasks/forms live under lists, and V1 creates no space-scoped
     * statuses/custom_fields — so a plain row delete is clean and orphan-free.
     * Pass `exec` to run inside the delete transaction.
     */
    async deleteById(spaceId, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.spaces)
            .where((0, drizzle_orm_1.eq)(schema_1.spaces.id, spaceId));
        return result.affectedRows;
    }
    /**
     * Count `department_reports` rows for a space (Dept Review V1). Reports are
     * retained HR history — `fk_dept_reports_space` is ON DELETE RESTRICT — so
     * the delete flow checks this first and surfaces `409 space.has_reports`
     * instead of letting the FK bounce the DELETE into a 500. Pass `exec` to
     * re-check inside the delete transaction.
     */
    async countReportsBySpace(spaceId, exec = this.db) {
        const [row] = await exec
            .select({ n: (0, drizzle_orm_1.count)() })
            .from(schema_1.departmentReports)
            .where((0, drizzle_orm_1.eq)(schema_1.departmentReports.spaceId, spaceId));
        return row?.n ?? 0;
    }
    /**
     * Null out every headship a user holds (Dept Review V1). Runs inside the
     * deactivation transaction: users are soft-deactivated (never deleted), so
     * the FK's ON DELETE SET NULL can never fire — this app-side write is the
     * only mechanism that removes a deactivated head. Reactivation does NOT
     * restore headships (one-way by design).
     */
    async clearHeadships(userId, workspaceId, exec = this.db) {
        await exec
            .update(schema_1.spaces)
            .set({ headUserId: null })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.headUserId, userId), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId)));
    }
    /**
     * Every non-archived space across ALL workspaces — the weekly
     * department-report job's iteration set (Dept Review V1 P20;
     * single-tenant today, multi-tenant-ready like the rest of the schema).
     */
    async listAllActive() {
        return this.db
            .select({
            id: schema_1.spaces.id,
            workspaceId: schema_1.spaces.workspaceId,
            name: schema_1.spaces.name,
            headUserId: schema_1.spaces.headUserId,
        })
            .from(schema_1.spaces)
            .where((0, drizzle_orm_1.isNull)(schema_1.spaces.archivedAt))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.spaces.id));
    }
}
exports.SpacesRepo = SpacesRepo;
