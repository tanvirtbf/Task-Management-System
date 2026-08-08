"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagService = void 0;
const errors_1 = require("../errors");
const isDuplicateKeyError = (err) => {
    const e = err;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};
class TagService {
    db;
    repo;
    activity;
    logger;
    constructor(db, repo, activity, logger) {
        this.db = db;
        this.repo = repo;
        this.activity = activity;
        this.logger = logger;
    }
    /**
     * List every tag in the caller's workspace. Workspace isolation is the
     * caller's responsibility: `workspaceId` MUST come from the verified access
     * token (`req.auth.workspaceId`), never from client input.
     */
    async list(workspaceId) {
        return this.repo.listByWorkspace(workspaceId);
    }
    /**
     * Create a workspace-wide tag and record the `created` activity in the same
     * transaction (all-or-nothing). A duplicate name within the workspace is the
     * one expected conflict: the `uq_tags_workspace_name` unique index raises it
     * race-free (collation `utf8mb4_unicode_ci`, so it is case-insensitive) and
     * we map it to `409 tag.duplicate`. The workspace id is the caller's own
     * (from `req.auth`), so this can never touch another tenant.
     */
    async create(input) {
        try {
            return await this.db.transaction(async (tx) => {
                const tag = await this.repo.create({
                    workspaceId: input.workspaceId,
                    name: input.name,
                    color: input.color,
                }, tx);
                await this.activity.record({
                    workspaceId: input.workspaceId,
                    actorId: input.actorId,
                    entityType: "tag",
                    entityId: tag.id,
                    action: "created",
                    context: { name: tag.name, color: tag.color },
                }, tx);
                return tag;
            });
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("tag.duplicate", `A tag named "${input.name}" already exists in this workspace`);
            }
            throw err;
        }
    }
    /**
     * Apply a partial update (`name` and/or `color`) to a tag the caller owns,
     * recording one `updated` activity row in the same transaction. The flow is
     * the codebase's read-modify-write template:
     *
     *   1. Lock the row scoped to the caller's workspace; missing ⇒ 404.
     *   2. Diff the submitted fields against the locked current values.
     *   3. If nothing actually changed, return the current state — no UPDATE,
     *      no activity (a genuine no-op leaves the audit log untouched).
     *   4. Otherwise UPDATE only the changed columns and append the activity,
     *      both under the lock so concurrent edits to the same tag serialize.
     *
     * A rename that collides with another tag in the workspace surfaces as the
     * `uq_tags_workspace_name` unique-violation → `409 tag.duplicate`.
     */
    async update(input) {
        const { workspaceId, actorId, id, name, color } = input;
        try {
            return await this.db.transaction(async (tx) => {
                const current = await this.repo.lockByIdInWorkspace(id, workspaceId, tx);
                if (!current) {
                    throw errors_1.AppError.notFound("tag.not_found", `Tag ${id} does not exist`);
                }
                const patch = {};
                const changes = {};
                if (name !== undefined && name !== current.name) {
                    patch.name = name;
                    changes.name = { from: current.name, to: name };
                }
                if (color !== undefined && color !== current.color) {
                    patch.color = color;
                    changes.color = { from: current.color, to: color };
                }
                const next = {
                    id: current.id,
                    name: patch.name ?? current.name,
                    color: patch.color ?? current.color,
                };
                // Genuine no-op: nothing to persist, nothing to audit.
                if (Object.keys(patch).length === 0) {
                    return next;
                }
                await this.repo.update(id, workspaceId, patch, tx);
                await this.activity.record({
                    workspaceId,
                    actorId,
                    entityType: "tag",
                    entityId: id,
                    action: "updated",
                    context: { changes },
                }, tx);
                return next;
            });
        }
        catch (err) {
            if (isDuplicateKeyError(err)) {
                throw errors_1.AppError.conflict("tag.duplicate", `A tag named "${name}" already exists in this workspace`);
            }
            throw err;
        }
    }
    /**
     * Delete a tag the caller owns, recording one `deleted` activity row in the
     * same transaction. Mirrors the update flow:
     *
     *   1. Lock the row scoped to the caller's workspace; missing ⇒ `404
     *      tag.not_found` (a cross-tenant id is indistinguishable from a missing
     *      one — no existence oracle).
     *   2. Delete it — `fk_task_tags_tag ON DELETE CASCADE` removes the tag from
     *      every task that had it, so no manual `task_tags` cleanup is needed.
     *   3. Append the `deleted` activity, capturing the tag's name/color (read
     *      under the lock) for the audit context.
     *
     * The `FOR UPDATE` lock serializes concurrent deletes of the SAME tag: the
     * loser re-reads inside its tx, finds the row gone, and returns 404 — so the
     * side effects (one row removed, one activity row) happen exactly once.
     */
    async delete(input) {
        const { workspaceId, actorId, id } = input;
        await this.db.transaction(async (tx) => {
            const current = await this.repo.lockByIdInWorkspace(id, workspaceId, tx);
            if (!current) {
                throw errors_1.AppError.notFound("tag.not_found", `Tag ${id} does not exist`);
            }
            // F22 (ISS-011): an in-use tag can no longer be deleted out from
            // under its tasks. The FK cascade made the delete SILENTLY strip
            // the tag from every task that carried it — categorisation data
            // lost with no warning. §32 promises 409 tag.in_use.
            const inUse = await this.repo.countTaskLinks(id, tx);
            if (inUse > 0) {
                throw errors_1.AppError.conflict("tag.in_use", `This tag is on ${inUse} task(s) — remove it from them first`);
            }
            await this.repo.delete(id, workspaceId, tx);
            await this.activity.record({
                workspaceId,
                actorId,
                entityType: "tag",
                entityId: id,
                action: "deleted",
                context: { name: current.name, color: current.color },
            }, tx);
        });
    }
}
exports.TagService = TagService;
