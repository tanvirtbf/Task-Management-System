"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskMembershipController = void 0;
/**
 * §11 Task membership HTTP layer (assignees · watchers · tags).
 *
 * Controllers translate request → service input and service result → wire
 * format. Business logic + DB writes live in `TaskMembershipService`.
 */
class TaskMembershipController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    async addAssignees(req, res, next) {
        try {
            const taskId = req.params.id;
            const { sub: actorId, workspaceId } = req.auth;
            const userIds = this.collectUserIds(req.body);
            const { added } = await this.service.addAssignees({
                taskId,
                workspaceId,
                actorId,
                userIds,
            });
            this.logger.info("task.assignees.added", {
                requestId: req.requestId,
                taskId,
                actorId,
                added,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    async removeAssignee(req, res, next) {
        try {
            const taskId = req.params.id;
            const userId = req.params.userId;
            const { sub: actorId, workspaceId } = req.auth;
            const { removed } = await this.service.removeAssignee({
                taskId,
                workspaceId,
                actorId,
                userId,
            });
            this.logger.info("task.assignees.removed", {
                requestId: req.requestId,
                taskId,
                userId,
                actorId,
                removed,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    async watchSelf(req, res, next) {
        try {
            const taskId = req.params.id;
            const { sub: userId, workspaceId } = req.auth;
            const { watched } = await this.service.watchSelf({
                taskId,
                workspaceId,
                userId,
            });
            this.logger.info("task.watchers.self.added", {
                requestId: req.requestId,
                taskId,
                userId,
                watched,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    async unwatchSelf(req, res, next) {
        try {
            const taskId = req.params.id;
            const { sub: userId, workspaceId } = req.auth;
            const { unwatched } = await this.service.unwatchSelf({
                taskId,
                workspaceId,
                userId,
            });
            this.logger.info("task.watchers.self.removed", {
                requestId: req.requestId,
                taskId,
                userId,
                unwatched,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    async addTags(req, res, next) {
        try {
            const taskId = req.params.id;
            const { sub: actorId, workspaceId } = req.auth;
            const tagIds = this.collectTagIds(req.body);
            const { added } = await this.service.addTags({
                taskId,
                workspaceId,
                actorId,
                tagIds,
            });
            this.logger.info("task.tags.added", {
                requestId: req.requestId,
                taskId,
                actorId,
                added,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    async removeTag(req, res, next) {
        try {
            const taskId = req.params.id;
            const tagId = req.params.tagId;
            const { sub: actorId, workspaceId } = req.auth;
            const { removed } = await this.service.removeTag({
                taskId,
                workspaceId,
                actorId,
                tagId,
            });
            this.logger.info("task.tags.removed", {
                requestId: req.requestId,
                taskId,
                tagId,
                actorId,
                removed,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * Normalise the two accepted body shapes (`{ user_id }` and
     * `{ user_ids: [] }`) into a single trimmed, deduped id list, preserving
     * first-seen order. The validator has already guaranteed at least one is
     * present and well-typed.
     */
    collectUserIds(body) {
        const raw = [];
        if (typeof body.user_id === "string")
            raw.push(body.user_id);
        if (Array.isArray(body.user_ids))
            raw.push(...body.user_ids);
        const seen = new Set();
        const out = [];
        for (const id of raw) {
            const trimmed = id.trim();
            if (trimmed.length > 0 && !seen.has(trimmed)) {
                seen.add(trimmed);
                out.push(trimmed);
            }
        }
        return out;
    }
    /**
     * Normalise the two accepted tag body shapes (`{ tag_id }` and
     * `{ tag_ids: [] }`) into a single trimmed, deduped id list, preserving
     * first-seen order. The validator has already guaranteed at least one is
     * present and well-typed.
     */
    collectTagIds(body) {
        const raw = [];
        if (typeof body.tag_id === "string")
            raw.push(body.tag_id);
        if (Array.isArray(body.tag_ids))
            raw.push(...body.tag_ids);
        const seen = new Set();
        const out = [];
        for (const id of raw) {
            const trimmed = id.trim();
            if (trimmed.length > 0 && !seen.has(trimmed)) {
                seen.add(trimmed);
                out.push(trimmed);
            }
        }
        return out;
    }
}
exports.TaskMembershipController = TaskMembershipController;
