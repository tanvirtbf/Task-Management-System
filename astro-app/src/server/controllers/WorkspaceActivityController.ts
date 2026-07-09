import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import { WorkspaceActivityService } from "../services/WorkspaceActivityService";
import type { WorkspaceActivityEntityType } from "../repositories/WorkspaceActivityRepo";
import type {
    RecentActivityRequest,
    ActivityFeedRequest,
} from "../types/workspaceActivity";

/**
 * §26 Workspace-activity HTTP layer (read-only). Translates the validated query
 * into a service call and the result into the wire shape — `recent` returns a
 * bare `{ data }` slice (last N, no paging); `feed` returns the spec's
 * `{ data, pagination }` envelope. Workspace scope comes from `req.auth`.
 */

/** Validated subset of the recent query (see `recentActivityValidator`). */
interface RecentQuery {
    limit?: number;
}

/** Validated subset of the feed query (see `activityFeedValidator`). */
interface FeedQuery {
    entity_type?: WorkspaceActivityEntityType;
    actor_id?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
}

export class WorkspaceActivityController {
    constructor(
        private service: WorkspaceActivityService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/activity/recent — the last N workspace events for the home
     * activity card, newest-first, actor hydrated. Workspace-scoped via
     * `req.auth.workspaceId` (never client input).
     */
    async recent(
        req: RecentActivityRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { limit }: RecentQuery = matchedData(req, {
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
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/activity — the filtered, cursor-paginated full feed
     * (`?entity_type` / `?actor_id` / `?from` / `?to`), newest-first, actor
     * hydrated. Workspace-scoped via `req.auth.workspaceId`.
     */
    async feed(req: ActivityFeedRequest, res: Response, next: NextFunction) {
        try {
            const {
                entity_type,
                actor_id,
                from,
                to,
                cursor,
                limit,
            }: FeedQuery = matchedData(req, { locations: ["query"] });

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
        } catch (err) {
            next(err);
        }
    }
}
