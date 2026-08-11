"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssignmentRequestsController = void 0;
const assignmentRequestSerializer_1 = require("../serializers/assignmentRequestSerializer");
/**
 * HTTP layer for the assignment-approval flow (team-access P8). Thin: parse
 * the validated request, delegate, serialize `{ data }`. Authorisation is
 * RELATIONSHIP-based (requester / target / target's Head / admin) and lives in
 * the SERVICE — the routes carry `authenticate` only, the roster-guard
 * precedent from teams (P1); a non-party caller gets the same 404 a wrong id
 * gets.
 */
class AssignmentRequestsController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /** GET /api/v1/assignment-requests?box=received|sent|team&status=pending|all */
    async list(req, res, next) {
        try {
            const box = req.query.box ?? "received";
            const onlyPending = (req.query.status ?? "pending") ===
                "pending";
            const details = await this.service.listFor({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                actorRole: req.auth.role,
                box,
                onlyPending,
            });
            res.status(200).json({
                data: details.map(assignmentRequestSerializer_1.toWireAssignmentRequest),
            });
        }
        catch (err) {
            next(err);
        }
    }
    /** GET /api/v1/tasks/:id/assignment-requests — the drawer panel feed. */
    async listForTask(req, res, next) {
        try {
            const details = await this.service.listForTask(req.params.id, req.auth.workspaceId);
            res.status(200).json({
                data: details.map(assignmentRequestSerializer_1.toWireAssignmentRequest),
            });
        }
        catch (err) {
            next(err);
        }
    }
    action(name) {
        return async (req, res, next) => {
            try {
                const base = {
                    requestId: req.params.id,
                    workspaceId: req.auth.workspaceId,
                    actorId: req.auth.sub,
                    actorRole: req.auth.role,
                };
                const note = req.body?.note ??
                    null;
                const detail = name === "accept"
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
                    data: (0, assignmentRequestSerializer_1.toWireAssignmentRequest)(detail),
                });
            }
            catch (err) {
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
    async query(req, res, next) {
        try {
            const body = req.body;
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
            res.status(200).json({ data: (0, assignmentRequestSerializer_1.toWireAssignmentRequest)(detail) });
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/assignment-requests/:id/answer — the requester replies (B2). */
    async answer(req, res, next) {
        try {
            const body = req.body;
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
            res.status(200).json({ data: (0, assignmentRequestSerializer_1.toWireAssignmentRequest)(detail) });
        }
        catch (err) {
            next(err);
        }
    }
}
exports.AssignmentRequestsController = AssignmentRequestsController;
