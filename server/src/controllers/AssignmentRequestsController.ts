import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { toWireAssignmentRequest } from "../serializers/assignmentRequestSerializer";
import type {
    AssignmentRequestsService,
    RequestBox,
} from "../services/AssignmentRequestsService";
import type { AuthRequest } from "../types";

/**
 * HTTP layer for the assignment-approval flow (team-access P8). Thin: parse
 * the validated request, delegate, serialize `{ data }`. Authorisation is
 * RELATIONSHIP-based (requester / target / target's Head / admin) and lives in
 * the SERVICE — the routes carry `authenticate` only, the roster-guard
 * precedent from teams (P1); a non-party caller gets the same 404 a wrong id
 * gets.
 */
export class AssignmentRequestsController {
    constructor(
        private service: AssignmentRequestsService,
        private logger: Logger,
    ) {}

    /** GET /api/v1/assignment-requests?box=received|sent|team&status=pending|all */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const box = (req.query.box as RequestBox | undefined) ?? "received";
            const onlyPending =
                ((req.query.status as string | undefined) ?? "pending") ===
                "pending";
            const details = await this.service.listFor({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                actorRole: req.auth.role,
                box,
                onlyPending,
            });
            res.status(200).json({
                data: details.map(toWireAssignmentRequest),
            });
        } catch (err) {
            next(err);
        }
    }

    /** GET /api/v1/tasks/:id/assignment-requests — the drawer panel feed. */
    async listForTask(
        req: AuthRequest & { params: { id: string } },
        res: Response,
        next: NextFunction,
    ) {
        try {
            const details = await this.service.listForTask(
                req.params.id,
                req.auth.workspaceId,
            );
            res.status(200).json({
                data: details.map(toWireAssignmentRequest),
            });
        } catch (err) {
            next(err);
        }
    }

    private action(
        name: "accept" | "decline" | "cancel",
    ): (
        req: AuthRequest & { params: { id: string } },
        res: Response,
        next: NextFunction,
    ) => Promise<void> {
        return async (req, res, next) => {
            try {
                const base = {
                    requestId: req.params.id,
                    workspaceId: req.auth.workspaceId,
                    actorId: req.auth.sub,
                    actorRole: req.auth.role,
                };
                const note =
                    (req.body as { note?: string | null } | undefined)?.note ??
                    null;
                const detail =
                    name === "accept"
                        ? await this.service.accept({ ...base, note })
                        : name === "decline"
                          ? await this.service.decline({ ...base, note })
                          : await this.service.cancel(base);
                this.logger.info(`assignment_requests.${name}.ok`, {
                    requestId: req.requestId,
                    id: req.params.id,
                    actorId: req.auth.sub,
                });
                res.status(200).json({
                    data: toWireAssignmentRequest(detail),
                });
            } catch (err) {
                next(err);
            }
        };
    }

    /** POST /api/v1/assignment-requests/:id/accept */
    accept = this.action("accept");
    /** POST /api/v1/assignment-requests/:id/decline */
    decline = this.action("decline");
    /** POST /api/v1/assignment-requests/:id/cancel */
    cancel = this.action("cancel");

    /** POST /api/v1/assignment-requests/:id/query — "I need 2 more days". */
    async query(
        req: AuthRequest & { params: { id: string } },
        res: Response,
        next: NextFunction,
    ) {
        try {
            const body = req.body as {
                note: string;
                proposed_due_date?: string | null;
            };
            const detail = await this.service.query({
                requestId: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                actorRole: req.auth.role,
                note: body.note,
                proposedDueDate: body.proposed_due_date ?? null,
            });
            this.logger.info("assignment_requests.query.ok", {
                requestId: req.requestId,
                id: req.params.id,
                actorId: req.auth.sub,
            });
            res.status(200).json({ data: toWireAssignmentRequest(detail) });
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/assignment-requests/:id/answer — the requester replies (B2). */
    async answer(
        req: AuthRequest & { params: { id: string } },
        res: Response,
        next: NextFunction,
    ) {
        try {
            const body = req.body as {
                note?: string | null;
                due_date?: string;
            };
            const detail = await this.service.answer({
                requestId: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                actorRole: req.auth.role,
                note: body.note ?? null,
                dueDate: body.due_date,
            });
            this.logger.info("assignment_requests.answer.ok", {
                requestId: req.requestId,
                id: req.params.id,
                actorId: req.auth.sub,
                movedDate: body.due_date !== undefined,
            });
            res.status(200).json({ data: toWireAssignmentRequest(detail) });
        } catch (err) {
            next(err);
        }
    }
}
