"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagController = void 0;
const pagination_1 = require("../utils/pagination");
/** Schema default for `tags.color` — applied when the body omits `color`. */
const DEFAULT_TAG_COLOR = "#94A3B8";
const toWireTag = (t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
});
class TagController {
    tagService;
    logger;
    constructor(tagService, logger) {
        this.tagService = tagService;
        this.logger = logger;
    }
    /**
     * GET /api/v1/tags — list every tag in the caller's workspace.
     *
     * Workspace-scoped: the workspace id comes from the verified access token
     * (`req.auth.workspaceId`), never from client input. Tags are a bounded
     * per-workspace set with no `internal_id`, so the whole set is returned as
     * a single complete page (`next_cursor: null`, `has_more: false`).
     */
    async list(req, res, next) {
        try {
            const workspaceId = req.auth.workspaceId;
            const rows = await this.tagService.list(workspaceId);
            this.logger.debug("tags.list.ok", {
                requestId: req.requestId,
                workspaceId,
                count: rows.length,
            });
            res.status(200).json(
            // F23 (ISS-007): a real limit + a working cursor —
            // this envelope used to say has_more:false no matter what.
            (0, pagination_1.paginateArray)(rows.map(toWireTag), req.query.limit, req.query.cursor));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/tags — create a workspace-wide tag (👑 admin/owner; the role
     * gate runs in the route's `canAccess` middleware).
     *
     * Identity is taken from the verified access token (`req.auth`), never the
     * body — so the tag always lands in the caller's own workspace and the actor
     * cannot be spoofed. Only `name`/`color` are read from the body (the
     * validator trimmed both and defaulted nothing), so stray fields such as the
     * frontend's `spaceId` are ignored, not persisted. Returns the new resource
     * as a bare object per the spec's single-resource shape.
     */
    async create(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const name = req.body.name;
            const color = req.body.color ?? DEFAULT_TAG_COLOR;
            const tag = await this.tagService.create({
                workspaceId,
                actorId,
                name,
                color,
            });
            this.logger.info("tags.create.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                tagId: tag.id,
            });
            res.status(201).json(toWireTag(tag));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * PATCH /api/v1/tags/:id — partially update a tag's name and/or color (👑
     * admin/owner; the role gate runs in the route's `canAccess` middleware).
     *
     * Identity and tenant come from the verified access token (`req.auth`); the
     * tag id is a path param. Only `name`/`color` are read from the body (the
     * validator trimmed both and guaranteed at least one), so stray fields such
     * as the frontend's `spaceId` are ignored, not persisted. A no-op (submitted
     * values equal the current ones) still returns 200 with the resource.
     * Returns the updated tag as a bare object per the spec's single-resource
     * shape.
     */
    async update(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const id = req.params.id;
            const { name, color } = req.body;
            const tag = await this.tagService.update({
                workspaceId,
                actorId,
                id,
                name,
                color,
            });
            this.logger.info("tags.update.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                tagId: tag.id,
            });
            res.status(200).json(toWireTag(tag));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * DELETE /api/v1/tags/:id — delete a workspace-wide tag (👑 admin/owner; the
     * role gate runs in the route's `canAccess` middleware).
     *
     * Identity and tenant come from the verified access token (`req.auth`); the
     * tag id is a path param. Removing the tag also removes it from every task
     * that had it — handled by the `task_tags` FK cascade, not by the app. A
     * missing or cross-workspace id is `404 tag.not_found`. Returns `204 No
     * Content` with an empty body.
     */
    async delete(req, res, next) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const id = req.params.id;
            await this.tagService.delete({ workspaceId, actorId, id });
            this.logger.info("tags.delete.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                tagId: id,
            });
            res.status(204).end();
        }
        catch (err) {
            next(err);
        }
    }
}
exports.TagController = TagController;
