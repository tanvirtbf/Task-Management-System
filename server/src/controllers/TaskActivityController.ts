import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import { TaskActivityService } from "../services/TaskActivityService";
import type { TaskActivityRequest } from "../types/tasks";

/**
 * §13 Task activity HTTP layer (read-only). Translates the validated query into
 * a service call and the result into the spec's `{ data, pagination }` envelope.
 */

/** Validated, sanitized subset of the query string (see `taskActivityValidator`). */
interface TaskActivityQuery {
    action?: string;
    cursor?: string;
    limit?: number;
}

export class TaskActivityController {
    constructor(
        private service: TaskActivityService,
        private logger: Logger,
    ) {}

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
    async listByTask(
        req: TaskActivityRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const query: TaskActivityQuery = matchedData(req, {
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
        } catch (err) {
            next(err);
        }
    }
}
