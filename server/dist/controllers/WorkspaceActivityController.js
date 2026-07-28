"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceActivityController = void 0;
const express_validator_1 = require("express-validator");
class WorkspaceActivityController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /**
     * GET /api/v1/activity/recent — the last N workspace events for the home
     * activity card, newest-first, actor hydrated. Workspace-scoped via
     * `req.auth.workspaceId` (never client input).
     */
    async recent(req, res, next) {
        try {
            const { limit } = (0, express_validator_1.matchedData)(req, {
                locations: ["query"],
            });
            const result = await this.service.recent({
                workspaceId: req.auth.workspaceId,
                limit,
            });
            this.logger.debug("workspace_activity.recent.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                count: result.data.length,
            });
            res.status(200).json({ data: result.data });
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/activity — the filtered, cursor-paginated full feed
     * (`?entity_type` / `?actor_id` / `?from` / `?to`), newest-first, actor
     * hydrated. Workspace-scoped via `req.auth.workspaceId`.
     */
    async feed(req, res, next) {
        try {
            const { entity_type, actor_id, from, to, cursor, limit, } = (0, express_validator_1.matchedData)(req, { locations: ["query"] });
            const result = await this.service.feed({
                workspaceId: req.auth.workspaceId,
                entityType: entity_type,
                actorId: actor_id,
                from,
                to,
                cursor,
                limit,
            });
            this.logger.debug("workspace_activity.feed.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
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
exports.WorkspaceActivityController = WorkspaceActivityController;
