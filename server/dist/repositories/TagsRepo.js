"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
class TagsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * List every tag in a workspace, ordered by `name` with a stable `id`
     * tie-break. `name` is UNIQUE per workspace (`uq_tags_workspace_name`) so
     * the order is already deterministic; the `id` tie-break keeps the idiom
     * identical to the other hierarchy lists. That same unique index backs both
     * the `workspace_id` filter and the `name` sort.
     *
     * `tags` has no `archived_at` column — tags are hard-deleted (the delete
     * cascades to `task_tags`), so there is deliberately no soft-delete filter.
     */
    /**
     * Return the subset of `tagIds` that exist in `workspaceId`, as a Set — the
     * bulk validator for task tag writes (#4 initial tags, #5/#10 tag_add). The
     * caller compares the returned set against the requested ids and rejects the
     * difference, so a cross-tenant tag id is indistinguishable from a missing
     * one (no existence oracle). Mirrors `UsersRepo.findActiveIdsInWorkspace`.
     */
    async findIdsInWorkspace(tagIds, workspaceId) {
        if (tagIds.length === 0)
            return new Set();
        const rows = await this.db
            .select({ id: schema_1.tags.id })
            .from(schema_1.tags)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tags.workspaceId, workspaceId), (0, drizzle_orm_1.inArray)(schema_1.tags.id, tagIds)));
        return new Set(rows.map((r) => r.id));
    }
    async listByWorkspace(workspaceId) {
        const rows = await this.db
            .select({
            id: schema_1.tags.id,
            name: schema_1.tags.name,
            color: schema_1.tags.color,
        })
            .from(schema_1.tags)
            .where((0, drizzle_orm_1.eq)(schema_1.tags.workspaceId, workspaceId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.tags.name), (0, drizzle_orm_1.asc)(schema_1.tags.id));
        return rows;
    }
    /**
     * Insert a tag and return it in wire shape. A duplicate `(workspace_id,
     * name)` raises the DB unique-violation (`uq_tags_workspace_name`); the
     * service catches it and maps it to `409 tag.duplicate` — there is no
     * pre-check `SELECT`, so the unique index is the single, race-free guard.
     *
     * Pass `exec` to run inside the caller's transaction (so the paired
     * `workspace_activity` write is atomic with this insert).
     */
    async create(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("tag");
        await exec.insert(schema_1.tags).values({
            id,
            workspaceId: input.workspaceId,
            name: input.name,
            color: input.color,
        });
        return { id, name: input.name, color: input.color };
    }
    /**
     * Lock a tag row (`SELECT … FOR UPDATE`) scoped to the caller's workspace
     * and return its current wire shape, or `null` when no such tag exists in
     * that workspace — a missing id and a cross-tenant id are indistinguishable,
     * and the caller renders both as `tag.not_found`. Must run inside a
     * transaction (`exec` is the tx handle): the lock serializes concurrent
     * updates to the SAME tag so the service's read-modify-write is race-free.
     */
    async lockByIdInWorkspace(id, workspaceId, exec) {
        const [row] = await exec
            .select({
            id: schema_1.tags.id,
            name: schema_1.tags.name,
            color: schema_1.tags.color,
        })
            .from(schema_1.tags)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tags.id, id), (0, drizzle_orm_1.eq)(schema_1.tags.workspaceId, workspaceId)))
            .for("update");
        return row ?? null;
    }
    /**
     * Apply a partial update, setting only the supplied columns. The `WHERE` is
     * workspace-scoped as defense-in-depth (the caller already proved ownership
     * via `lockByIdInWorkspace`). A rename that collides with another tag raises
     * the `uq_tags_workspace_name` unique-violation, which the service maps to
     * `409 tag.duplicate`.
     */
    async update(id, workspaceId, patch, exec = this.db) {
        await exec
            .update(schema_1.tags)
            .set(patch)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tags.id, id), (0, drizzle_orm_1.eq)(schema_1.tags.workspaceId, workspaceId)));
    }
    /**
     * Hard-delete a tag, scoped to the caller's workspace. The workspace-scoped
     * `WHERE` is defense-in-depth (the caller already proved ownership via
     * `lockByIdInWorkspace` inside the same tx). Deleting a tag automatically
     * removes its rows from `task_tags` via `fk_task_tags_tag ON DELETE CASCADE`,
     * so there is NO manual junction cleanup — the FK is the single, race-free
     * guarantee. `tags` has no `archived_at`, so this is a true row delete, not a
     * soft-delete. Pass `exec` to run inside the delete tx (so the paired
     * `workspace_activity` write is atomic with this delete).
     */
    async delete(id, workspaceId, exec = this.db) {
        await exec
            .delete(schema_1.tags)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tags.id, id), (0, drizzle_orm_1.eq)(schema_1.tags.workspaceId, workspaceId)));
    }
}
exports.TagsRepo = TagsRepo;
