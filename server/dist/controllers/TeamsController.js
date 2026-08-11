"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamsController = void 0;
const teamSerializer_1 = require("../serializers/teamSerializer");
/**
 * Teams & membership endpoints (team-access P1). Thin: workspace + actor come
 * from `req.auth` (never the body), everything else is the service's job.
 */
class TeamsController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /** GET /api/v1/teams — the whole org chart in one read. */
    async directory(req, res, next) {
        try {
            const directory = await this.service.directory(req.auth.workspaceId);
            res.status(200).json((0, teamSerializer_1.toWireTeamDirectory)(directory));
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/spaces/:id/members — add a person to the team. */
    async addMember(req, res, next) {
        try {
            const body = req.body;
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
        }
        catch (err) {
            next(err);
        }
    }
    /** DELETE /api/v1/spaces/:id/members/:userId — remove from the team. */
    async removeMember(req, res, next) {
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
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/spaces/:id/visibility-grants — team A can also see B. */
    async grantVisibility(req, res, next) {
        try {
            const body = req.body;
            await this.service.grantVisibility({
                workspaceId: req.auth.workspaceId,
                viewerSpaceId: req.params.id,
                targetSpaceId: body.target_space_id,
                actorId: req.auth.sub,
            });
            this.logger.info("teams.grant_visibility.ok", {
                requestId: req.requestId,
                viewerSpaceId: req.params.id,
                targetSpaceId: body.target_space_id,
            });
            res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    }
    /** DELETE /api/v1/spaces/:id/visibility-grants/:targetId. */
    async revokeVisibility(req, res, next) {
        try {
            await this.service.revokeVisibility({
                workspaceId: req.auth.workspaceId,
                viewerSpaceId: req.params.id,
                targetSpaceId: req.params.targetId,
                actorId: req.auth.sub,
            });
            this.logger.info("teams.revoke_visibility.ok", {
                requestId: req.requestId,
                viewerSpaceId: req.params.id,
                targetSpaceId: req.params.targetId,
            });
            res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    }
    /** PATCH /api/v1/users/:id/team — set/clear a person's home team. */
    async setHomeTeam(req, res, next) {
        try {
            const body = req.body;
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
        }
        catch (err) {
            next(err);
        }
    }
}
exports.TeamsController = TeamsController;
