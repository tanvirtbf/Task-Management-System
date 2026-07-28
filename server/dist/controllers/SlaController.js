"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlaController = void 0;
/**
 * §29 SLA management — HTTP layer. Parses the `/sla/breached` query filters and
 * maps the snake_case override body to the service input; the service returns
 * wire-shaped data.
 */
class SlaController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /**
     * GET /api/v1/sla/breached — list breached-SLA tasks (🔐 any member).
     * Optional `?team=` (reporter_team or "engineering") and `?severity=S0,S1`
     * (comma list) filters. Returns a bare `SLABreach[]` (200).
     */
    async listBreached(req, res, next) {
        try {
            const teamRaw = req.query.team;
            const severityRaw = req.query.severity;
            const filters = {
                team: typeof teamRaw === "string" ? teamRaw : undefined,
                severities: typeof severityRaw === "string"
                    ? severityRaw
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : undefined,
            };
            const breaches = await this.service.listBreached({
                workspaceId: req.auth.workspaceId,
                filters,
            });
            this.logger.debug("sla.breached.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                count: breaches.length,
            });
            res.status(200).json(breaches);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * PATCH /api/v1/tasks/:id/sla — manually set/clear the SLA (👑 owner/admin).
     * Body `{ sla_due_at: ISO | null }`. Returns 200 with the updated Task.
     */
    async override(req, res, next) {
        try {
            const task = await this.service.override({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                taskId: req.params.id,
                slaDueAt: req.body.sla_due_at ?? null,
            });
            this.logger.info("sla.override.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: req.params.id,
            });
            res.status(200).json(task);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.SlaController = SlaController;
