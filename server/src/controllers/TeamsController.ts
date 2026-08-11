import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import type { TeamMembershipService } from "../services/TeamMembershipService";
import type { AuthRequest } from "../types";
import { toWireTeamDirectory } from "../serializers/teamSerializer";

/**
 * Teams & membership endpoints (team-access P1). Thin: workspace + actor come
 * from `req.auth` (never the body), everything else is the service's job.
 */
export class TeamsController {
    constructor(
        private service: TeamMembershipService,
        private logger: Logger,
    ) {}

    /** GET /api/v1/teams — the whole org chart in one read. */
    async directory(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const directory = await this.service.directory(
                req.auth.workspaceId,
            );
            res.status(200).json(toWireTeamDirectory(directory));
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/spaces/:id/members — add a person to the team. */
    async addMember(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const body = req.body as { user_id: string };
            await this.service.addMember({
                workspaceId: req.auth.workspaceId,
                spaceId: req.params.id,
                userId: body.user_id,
                actorId: req.auth.sub,
                actorRole: req.auth.role,
            });
            this.logger.info("teams.add_member.ok", {
                requestId: req.requestId,
                spaceId: req.params.id,
                userId: body.user_id,
            });
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }

    /** DELETE /api/v1/spaces/:id/members/:userId — remove from the team. */
    async removeMember(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await this.service.removeMember({
                workspaceId: req.auth.workspaceId,
                spaceId: req.params.id,
                userId: req.params.userId,
                actorId: req.auth.sub,
                actorRole: req.auth.role,
            });
            this.logger.info("teams.remove_member.ok", {
                requestId: req.requestId,
                spaceId: req.params.id,
                userId: req.params.userId,
            });
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/users/:id/team — set/clear a person's home team. */
    async setHomeTeam(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const body = req.body as { space_id: string | null };
            await this.service.setHomeTeam({
                workspaceId: req.auth.workspaceId,
                userId: req.params.id,
                spaceId: body.space_id ?? null,
                actorId: req.auth.sub,
            });
            this.logger.info("teams.set_home.ok", {
                requestId: req.requestId,
                userId: req.params.id,
                spaceId: body.space_id ?? null,
            });
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }
}
