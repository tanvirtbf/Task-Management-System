import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import type { EngineeringService } from "../services/EngineeringService";
import type {
    ReportBugRequest,
    GetEngHomeRequest,
    CreatePostmortemRequest,
} from "../types/engineering";
import { bugSeverities, reporterTeams } from "../db/schema/_shared";

type BugSeverity = (typeof bugSeverities)[number];
type ReporterTeam = (typeof reporterTeams)[number];

/**
 * §22 Engineering specials — HTTP layer. Translates the snake_case wire body to
 * the service's camelCase input; the service returns wire-shaped data.
 */
export class EngineeringController {
    constructor(
        private service: EngineeringService,
        private logger: Logger,
    ) {}

    /**
     * POST /api/v1/eng/report-bug — cross-team bug intake (🔐 any member).
     * Composes a Bug task in the workspace's "Bug Triage" list, applies the §29
     * SLA per severity, and auto-assigns the current on-call engineer for
     * S0/S1. Returns 201 with the fully-hydrated Task. The `severity` /
     * `reporter_team` strings were already enum-validated by the validator.
     */
    async reportBug(req: ReportBugRequest, res: Response, next: NextFunction) {
        try {
            const b = req.body;
            const task = await this.service.reportBug({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                role: req.auth.role,
                steps: b.steps,
                happened: b.happened,
                expected: b.expected,
                severity: b.severity as BugSeverity | undefined,
                reporterTeam: b.reporter_team as ReporterTeam,
                url: b.url,
                screenshots: b.screenshots,
            });

            this.logger.info("eng.report_bug.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: task.id,
            });

            res.status(201).json(task);
        } catch (err) {
            next(err);
        }
    }

    /**
     * GET /api/v1/eng/home — the Engineering dashboard rollup (🔐 any member).
     * Returns open-bug / open-incident counts + previews, the caller's
     * active-sprint tasks, PRs awaiting their review, stale tickets, the current
     * on-call engineer, and the active sprint, in a single response.
     */
    async getHome(req: GetEngHomeRequest, res: Response, next: NextFunction) {
        try {
            const view = await this.service.getHome({
                workspaceId: req.auth.workspaceId,
                userId: req.auth.sub,
                role: req.auth.role,
            });

            this.logger.debug("eng.home.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
            });

            res.status(200).json(view);
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/eng/incidents/:id/postmortem — save (upsert) the postmortem
     * checklist on a resolved Incident (🔐 any member). 409 `incident.not_incident`
     * / `incident.not_resolved` for an ineligible task, 404 `task.not_found` for
     * an unknown id. Returns 200 with the saved postmortem.
     */
    async createPostmortem(
        req: CreatePostmortemRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const postmortem = await this.service.submitPostmortem({
                workspaceId: req.auth.workspaceId,
                incidentId: req.params.id,
                items: req.body.items,
                actorId: req.auth.sub,
            });

            this.logger.info("eng.postmortem.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                incidentId: req.params.id,
            });

            res.status(200).json(postmortem);
        } catch (err) {
            next(err);
        }
    }
}
