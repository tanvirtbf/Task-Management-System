"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentsController = void 0;
const express_validator_1 = require("express-validator");
/**
 * §14 Comments HTTP layer. Translates the validated request into a service call
 * and the service result into the wire shape. Identity + workspace scope always
 * come from `req.auth`, never the body. The GET returns a bare `Comment[]`
 * (replies nested); create returns 201 + the comment; edit 200; delete 204.
 */
class CommentsController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /** GET /api/v1/tasks/:id/comments (🔐). */
    async list(req, res, next) {
        try {
            const tree = await this.service.list({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
            });
            res.status(200).json(tree);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/tasks/:id/comments (🔐). 201 with the created comment. */
    async create(req, res, next) {
        try {
            const { body, parent_comment_id } = (0, express_validator_1.matchedData)(req, {
                locations: ["body"],
            });
            const comment = await this.service.create({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
                authorId: req.auth.sub,
                body,
                parentCommentId: parent_comment_id ?? null,
            });
            this.logger.info("comments.create.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                commentId: comment.id,
            });
            res.status(201).json(comment);
        }
        catch (err) {
            next(err);
        }
    }
    /** PATCH /api/v1/comments/:id (🔐 author, within 15 min). 200. */
    async update(req, res, next) {
        try {
            const { body } = (0, express_validator_1.matchedData)(req, { locations: ["body"] });
            const comment = await this.service.update({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                body,
            });
            res.status(200).json(comment);
        }
        catch (err) {
            next(err);
        }
    }
    /** DELETE /api/v1/comments/:id (🔐 author / 👑 admin). Soft delete. 204. */
    async remove(req, res, next) {
        try {
            await this.service.delete({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
            });
            this.logger.info("comments.delete.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                commentId: req.params.id,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.CommentsController = CommentsController;
