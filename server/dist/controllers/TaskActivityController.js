"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskActivityController = void 0;
const express_validator_1 = require("express-validator");
class TaskActivityController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /**
     * GET /api/v1/tasks/:id/activity — one newest-first, cursor-paginated page of
     * a task's activity feed, each row's `actor` hydrated to the full `User`
     * object (or `null` for a system event). `?action=` filters by exact action
     * code.
     *
     * Workspace-scoped via `req.auth.workspaceId` (never client input); the
     * service resolves `:id` (internal id or `custom_id`) inside that workspace
     * or throws `404 task.not_found`. The v1-level `apiLimiter` applies.
     */
    async listByTask(req, res, next) {
        try {
            const query = (0, express_validator_1.matchedData)(req, {
                locations: ["query"],
            });
            const result = await this.service.listByTask({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
                action: query.action,
                cursor: query.cursor,
                limit: query.limit,
            });
            this.logger.debug("task_activity.list.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                taskId: req.params.id,
                count: result.data.length,
            });
            res.status(200).json({
                data: result.data,
                pagination: {
                    next_cursor: result.nextCursor,
                    has_more: result.hasMore,
                    total_estimate: result.total,
                },
            });
        }
        catch (err) {
            next(err);
        }
    }
}
exports.TaskActivityController = TaskActivityController;
