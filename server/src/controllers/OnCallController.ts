import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { OnCallService } from "../services/OnCallService";
import type { AuthRequest } from "../types";
import type { SetOnCallRequest } from "../types/onCall";
import { toWireOnCallShift } from "../serializers/onCallSerializer";

/**
 * §21 On-call HTTP layer. Controllers translate request → service input and
 * service result → wire format. They never own business logic; they never touch
 * the DB directly.
 */
export class OnCallController {
    constructor(
        private service: OnCallService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/on-call/current — the shift covering today (🔐 any member).
     * Workspace-scoped via `req.auth.workspaceId`. Returns the shift as a bare
     * object, or `null` when no one is on call this week (a "who is on call now"
     * read can legitimately be empty — that is not a 404).
     */
    async current(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const shift = await this.service.getCurrent(workspaceId);

            this.logger.debug("on_call.current.ok", {
                requestId: req.requestId,
                workspaceId,
                found: shift !== null,
            });

            res.status(200).json(shift ? toWireOnCallShift(shift) : null);
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/on-call/schedule — every shift in the workspace, chronological
     * (🔐 any member). Optional `?from=&to=` (YYYY-MM-DD) window on `week_start`.
     * Workspace-scoped via `req.auth.workspaceId`. A bounded per-workspace set,
     * so it returns as a single complete page (`next_cursor: null`,
     * `has_more: false`). `from`/`to` are read defensively as strings — the
     * validator already rejected non-string (array) or malformed values.
     */
    async schedule(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const from =
                typeof req.query.from === "string" ? req.query.from : undefined;
            const to =
                typeof req.query.to === "string" ? req.query.to : undefined;

            const rows = await this.service.listSchedule(workspaceId, {
                from,
                to,
            });

            this.logger.debug("on_call.schedule.ok", {
                requestId: req.requestId,
                workspaceId,
                count: rows.length,
            });

            res.status(200).json({
                data: rows.map(toWireOnCallShift),
                pagination: {
                    next_cursor: null,
                    has_more: false,
                    total_estimate: rows.length,
                },
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * PUT /api/v1/on-call/:weekStart — assign the on-call engineer for a week
     * (👑 admin/owner; the role gate runs in the route's `canAccess`). Identity
     * and tenant come from `req.auth`; the Monday-keyed week is the validated
     * path param; only `engineer_id` is read from the body (stray `id` /
     * `created_by` are ignored — not a mass-assignment surface). Idempotent
     * upsert. Returns the resulting shift as a bare object.
     */
    async set(req: SetOnCallRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const weekStart = req.params.weekStart;
            const engineerId = req.body.engineer_id;

            const shift = await this.service.set({
                workspaceId,
                actorId,
                weekStart,
                engineerId,
            });

            this.logger.info("on_call.set.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                weekStart,
            });

            res.status(200).json(toWireOnCallShift(shift));
        } catch (err) {
            next(err);
        }
    }

    /**
     * DELETE /api/v1/on-call/:weekStart — clear a week's on-call assignment (👑
     * admin/owner; the role gate runs in the route's `canAccess`). Identity and
     * tenant come from `req.auth`; the Monday-keyed week is the validated path
     * param. A missing / cross-workspace week is `404 on_call.not_found`.
     * Returns `204` with an empty body.
     */
    async delete(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const weekStart = req.params.weekStart;

            await this.service.delete(workspaceId, weekStart);

            this.logger.info("on_call.delete.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                weekStart,
            });

            res.status(204).end();
        } catch (err) {
            next(err);
        }
    }
}
