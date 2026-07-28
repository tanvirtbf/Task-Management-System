"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskDependenciesController = void 0;
/**
 * §12 Task dependencies HTTP layer. Controllers translate request → service
 * input and service result → response; the service already returns wire-shaped
 * data (the hydrated `TaskDependency` views), mirroring §10's tasks read side.
 */
class TaskDependenciesController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /**
     * GET /api/v1/tasks/:id/dependencies — both directions in one payload
     * (`{ blocks, blocked_by }`), each edge carrying the OTHER end as a fully
     * hydrated `Task`. 🔐 any member; the task is resolved in
     * `req.auth.workspaceId` (404 `task.not_found` otherwise).
     */
    async getForTask(req, res, next) {
        try {
            const view = await this.service.getForTask({
                taskId: req.params.id,
                workspaceId: req.auth.workspaceId,
                role: req.auth.role,
            });
            this.logger.debug("task_dependencies.list.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                taskId: req.params.id,
                blocks: view.blocks.length,
                blockedBy: view.blocked_by.length,
            });
            res.status(200).json(view);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/task-dependencies — add a `blocks` edge (🔐 any member).
     * Identity comes from `req.auth`, never the body. Only `task_id` /
     * `related_task_id` are read (`type` is validated but the server always
     * stores `blocks`). Returns 201 with the created `TaskDependency` (the other
     * end hydrated, `type: "blocks"`).
     */
    async create(req, res, next) {
        try {
            const { task_id, related_task_id } = req.body;
            const dep = await this.service.create({
                taskId: task_id,
                relatedTaskId: related_task_id,
                actorId: req.auth.sub,
                workspaceId: req.auth.workspaceId,
                role: req.auth.role,
            });
            this.logger.info("task_dependencies.create.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                dependencyId: dep.id,
            });
            res.status(201).json(dep);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * DELETE /api/v1/task-dependencies/:id — remove one edge (🔐 any member).
     * Resolved within `req.auth.workspaceId` (404 `dep.not_found` otherwise).
     * Returns 204 with an empty body.
     */
    async delete(req, res, next) {
        try {
            await this.service.delete({
                depId: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });
            this.logger.info("task_dependencies.delete.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                dependencyId: req.params.id,
            });
            res.status(204).end();
        }
        catch (err) {
            next(err);
        }
    }
}
exports.TaskDependenciesController = TaskDependenciesController;
