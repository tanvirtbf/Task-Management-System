import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import type { TaskDeleteRequest } from "../db/schema";
import type { TaskDeleteRequestsService } from "../services/TaskDeleteRequestsService";
import type { AuthRequest } from "../types";

/**
 * HTTP layer for the permanent-delete approval flow (upgrades/023).
 *
 * Thin by design — every rule lives in the service, because the same decisions
 * have to hold whether they arrive over HTTP or (later) from the assistant.
 */

/** snake_case wire shape (API_DESIGN convention). */
const toWire = (r: TaskDeleteRequest) => ({
    id: r.id,
    task_id: r.taskId,
    task_name: r.taskName,
    space_id: r.spaceId,
    requested_by: r.requestedBy,
    reason: r.reason,
    status: r.status,
    decided_by: r.decidedBy,
    decided_at: r.decidedAt ? r.decidedAt.toISOString() : null,
    decision_note: r.decisionNote,
    created_at: r.createdAt.toISOString(),
});

export class TaskDeleteRequestsController {
    constructor(
        private service: TaskDeleteRequestsService,
        private logger: Logger,
    ) {}

    /**
     * POST /tasks/:id/delete-request — 204 when the caller could approve it
     * themselves (the task is already gone), 201 with the queued request
     * otherwise. Two different outcomes on purpose: the client has to tell the
     * person which one happened.
     */
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };
            const body = req.body as { reason?: string };
            const out = await this.service.request({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                taskId: id,
                reason: body?.reason ?? null,
            });
            this.logger.info("task_delete_request.create.ok", {
                requestId: req.requestId,
                taskId: id,
                deleted: out.deleted,
            });
            if (out.deleted) {
                res.sendStatus(204);
                return;
            }
            res.status(201).json({
                data: out.request ? toWire(out.request) : null,
            });
        } catch (err) {
            next(err);
        }
    }

    /** GET /tasks/:id/delete-request — the live request, or null. */
    async forTask(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };
            const found = await this.service.forTask({
                workspaceId: req.auth.workspaceId,
                taskId: id,
            });
            res.status(200).json({ data: found ? toWire(found) : null });
        } catch (err) {
            next(err);
        }
    }

    /** GET /delete-requests?box=pending|mine */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const box = req.query.box === "mine" ? "mine" : "pending";
            const rows = await this.service.list({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                box,
            });
            res.status(200).json({ data: rows.map(toWire) });
        } catch (err) {
            next(err);
        }
    }

    /** POST /delete-requests/:id/approve | /reject */
    decide(approve: boolean) {
        return async (req: AuthRequest, res: Response, next: NextFunction) => {
            try {
                const { id } = matchedData(req, { locations: ["params"] }) as {
                    id: string;
                };
                const body = req.body as { note?: string };
                await this.service.decide({
                    workspaceId: req.auth.workspaceId,
                    actorId: req.auth.sub,
                    role: req.auth.role,
                    requestId: id,
                    approve,
                    note: body?.note ?? null,
                });
                this.logger.info("task_delete_request.decide.ok", {
                    requestId: req.requestId,
                    deleteRequestId: id,
                    approve,
                });
                res.sendStatus(204);
            } catch (err) {
                next(err);
            }
        };
    }

    /** POST /delete-requests/:id/cancel — the requester withdraws. */
    async cancel(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { id } = matchedData(req, { locations: ["params"] }) as {
                id: string;
            };
            await this.service.cancel({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                requestId: id,
            });
            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }
}
