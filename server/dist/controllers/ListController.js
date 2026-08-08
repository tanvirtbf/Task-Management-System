"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListController = void 0;
const pagination_1 = require("../utils/pagination");
const errors_1 = require("../errors");
/** Schema defaults for `lists.icon` / `lists.color`, applied when omitted. */
const DEFAULT_LIST_ICON = "ListChecks";
const DEFAULT_LIST_COLOR = "#4F46E5";
const toWireList = (l) => ({
    id: l.id,
    space_id: l.spaceId,
    name: l.name,
    description: l.description,
    icon: l.icon,
    color: l.color,
    position: l.position,
    default_task_type_id: l.defaultTaskTypeId,
    is_private: l.isPrivate,
    archived_at: l.archivedAt ? l.archivedAt.toISOString() : null,
    created_by: l.createdBy,
    created_at: l.createdAt.toISOString(),
});
class ListController {
    listService;
    logger;
    constructor(listService, logger) {
        this.listService = listService;
        this.logger = logger;
    }
    /**
     * GET /api/v1/spaces/:spaceId/lists — list the lists in one space.
     *
     * Archived lists are excluded unless `?include_archived=true` (or `=1`).
     * The response uses the spec list envelope; lists are a bounded per-space
     * set with no `internal_id`, so the whole set is returned in a single page
     * (`next_cursor: null`, `has_more: false`) — matching `GET /spaces`.
     *
     * `404 space.not_found` if the space is missing or in another workspace.
     */
    async listBySpace(req, res, next) {
        try {
            const { spaceId } = req.params;
            // `include_archived` was checked as a boolean string by
            // `listBySpaceValidator`; coerce the raw query value here.
            const rawIncludeArchived = req.query.include_archived;
            const includeArchived = rawIncludeArchived === "true" || rawIncludeArchived === "1";
            const rows = await this.listService.listBySpace({
                spaceId,
                workspaceId: req.auth.workspaceId,
                includeArchived,
            });
            this.logger.debug("lists.list_by_space.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                spaceId,
                includeArchived,
                count: rows.length,
            });
            res.status(200).json(
            // F23 (ISS-007): a real limit + a working cursor —
            // this envelope used to say has_more:false no matter what.
            (0, pagination_1.paginateArray)(rows.map(toWireList), req.query.limit, req.query.cursor));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/lists — list every list in the caller's workspace, across all
     * spaces. Optional `?space_id` narrows to one space (resolved in-workspace
     * or `404 space.not_found`); archived lists are excluded unless
     * `?include_archived=true` (or `=1`).
     *
     * Like `GET /spaces` and `listBySpace`, lists are a bounded set with no
     * `internal_id`, so the whole set is returned in a single page
     * (`next_cursor: null`, `has_more: false`); a stray `?cursor` / `?limit` is
     * accepted but inert.
     */
    async listAll(req, res, next) {
        try {
            const workspaceId = req.auth.workspaceId;
            // `space_id` was trimmed + length-checked by `listAllValidator` when
            // present; narrow the raw query value to a string (a duplicated
            // param arrives as an array and is treated as no filter).
            const rawSpaceId = req.query.space_id;
            const spaceId = typeof rawSpaceId === "string" ? rawSpaceId : undefined;
            // `include_archived` was checked as a boolean string by the
            // validator; coerce the raw value here (mirrors `listBySpace`).
            const rawIncludeArchived = req.query.include_archived;
            const includeArchived = rawIncludeArchived === "true" || rawIncludeArchived === "1";
            const rows = await this.listService.listAll({
                workspaceId,
                spaceId,
                includeArchived,
            });
            this.logger.debug("lists.list_all.ok", {
                requestId: req.requestId,
                workspaceId,
                spaceId,
                includeArchived,
                count: rows.length,
            });
            res.status(200).json(
            // F23 (ISS-007): a real limit + a working cursor —
            // this envelope used to say has_more:false no matter what.
            (0, pagination_1.paginateArray)(rows.map(toWireList), req.query.limit, req.query.cursor));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/lists/:id — read one list by id, scoped to the caller's
     * workspace. Returns the bare wire `List` (single-resource convention — no
     * `{ data }` envelope, matching `GET /workspace` and `GET /auth/me`).
     *
     * `404 list.not_found` if the id is missing or in another workspace.
     * Archived lists resolve here (soft-delete is still readable on a direct
     * read); the service owns that policy.
     */
    async getById(req, res, next) {
        try {
            const { id } = req.params;
            const list = await this.listService.getById({
                listId: id,
                workspaceId: req.auth.workspaceId,
            });
            this.logger.debug("lists.get.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                listId: id,
            });
            res.status(200).json(toWireList(list));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/lists — create a list in a space (👑 admin/owner; the role
     * gate runs in the route's `canAccess` middleware).
     *
     * Identity comes from the verified access token (`req.auth`), never the body
     * — so the list always lands in the caller's own workspace and the creator
     * cannot be spoofed. Only the documented fields are read; stray keys
     * (`workspace_id`, `created_by`, `position`) are ignored. Omitted optional
     * fields fall back to the schema defaults. The service seeds the 5 default
     * statuses and writes the `created` activity in the same transaction.
     * Returns the new resource as a bare object per the spec single-resource
     * shape.
     */
    async create(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const body = req.body;
            const list = await this.listService.create({
                workspaceId,
                actorId,
                spaceId: body.space_id,
                name: body.name,
                description: body.description ?? null,
                icon: body.icon ?? DEFAULT_LIST_ICON,
                color: body.color ?? DEFAULT_LIST_COLOR,
                isPrivate: body.is_private ?? false,
                defaultTaskTypeId: body.default_task_type_id ?? null,
            });
            this.logger.info("lists.create.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                listId: list.id,
                spaceId: list.spaceId,
            });
            res.status(201).json(toWireList(list));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * PATCH /api/v1/lists/:id — partial update of a list (👑 admin/owner; the
     * role gate runs in the route's `canAccess` middleware).
     *
     * Reads only the whitelisted body fields (`name`, `description`, `icon`,
     * `color`, `default_task_type_id`, `space_id`); `is_private` / `position` /
     * `created_by` / `id` are never patchable here. At least one updatable field
     * must be present (422 otherwise). `description` / `default_task_type_id`
     * accept an explicit `null` to clear. Identity comes from `req.auth`. Returns
     * `200` with the updated `List` as a bare object.
     *
     * **F28 (ISS-036, decision D12.7): `space_id` MOVES the list.** A list
     * created in the wrong department used to be permanently stuck there. The
     * target must be a live space in this workspace and must not already hold a
     * list of the same name (409 `list.duplicate`, F27's index). Note that reach
     * is space-scoped, so a move changes **who can see the list's tasks**.
     *
     * `is_private` stays unpatchable ON PURPOSE and this is not an oversight:
     * `rbac/scope.ts` records that `lists.is_private` is enforced nowhere, so
     * offering the toggle would ship a control a user can switch on while every
     * member keeps seeing the list. (`SpacesController` does accept it for a
     * SPACE — that inconsistency is now deliberate and documented.)
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const { name, description, icon, color, default_task_type_id, space_id, } = req.body;
            // Count an explicit `null` as "provided" (it clears the field), so a
            // `null`-only patch is a valid update, not an empty one.
            const fields = [];
            if (name !== undefined)
                fields.push("name");
            if (description !== undefined)
                fields.push("description");
            if (icon !== undefined)
                fields.push("icon");
            if (color !== undefined)
                fields.push("color");
            if (default_task_type_id !== undefined)
                fields.push("default_task_type_id");
            if (space_id !== undefined)
                fields.push("space_id");
            if (fields.length === 0) {
                throw errors_1.AppError.validationFailed([
                    {
                        issue: "Provide at least one field to update: name, description, icon, color, default_task_type_id, or space_id",
                    },
                ]);
            }
            const list = await this.listService.update({
                listId: id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                name,
                description,
                icon,
                color,
                defaultTaskTypeId: default_task_type_id,
                spaceId: space_id,
                fields,
            });
            this.logger.info("lists.update.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                listId: id,
                fields,
            });
            res.status(200).json(toWireList(list));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/lists/:id/archive — soft-delete a list (👑 admin/owner; role
     * gate in the route's `canAccess`).
     *
     * Idempotent: archiving an already-archived list is still `204`. The list is
     * resolved within `req.auth.workspaceId` (404 `list.not_found` otherwise).
     * Returns `204 No Content` with an empty body.
     */
    async archive(req, res, next) {
        try {
            const { id } = req.params;
            await this.listService.archive({
                listId: id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            this.logger.info("lists.archive.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                listId: id,
            });
            res.status(204).end();
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/lists/:id/unarchive — reverse an archive (👑 admin/owner).
     *
     * Idempotent: unarchiving a non-archived list is still `204`. The list is
     * resolved within `req.auth.workspaceId` (404 `list.not_found` otherwise).
     * Returns `204 No Content` with an empty body.
     */
    async unarchive(req, res, next) {
        try {
            const { id } = req.params;
            await this.listService.unarchive({
                listId: id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            this.logger.info("lists.unarchive.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                listId: id,
            });
            res.status(204).end();
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * DELETE /api/v1/lists/:id — hard-delete a list (🛡️ owner only; role gate in
     * the route's `canAccess`).
     *
     * The list must be archived and empty (no tasks). The list is resolved within
     * `req.auth.workspaceId` (404 `list.not_found` otherwise); a non-archived
     * list is `409 list.not_archived`, a list with tasks `409 list.not_empty`.
     * Returns `204 No Content`.
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;
            await this.listService.delete({
                listId: id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            this.logger.info("lists.delete.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                listId: id,
            });
            res.status(204).end();
        }
        catch (err) {
            next(err);
        }
    }
}
exports.ListController = ListController;
