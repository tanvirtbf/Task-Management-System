"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RolesController = void 0;
const errors_1 = require("../errors");
const context_1 = require("../rbac/context");
const catalog_1 = require("../rbac/catalog");
const roleSerializer_1 = require("../serializers/roleSerializer");
/**
 * §34 Roles & permissions administration.
 *
 * Every write needs the RESOLVED actor (not the JWT role) because the
 * escalation guard compares what is being granted against what the caller
 * actually holds. `requirePermission` has already run, so an actor exists.
 */
class RolesController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    async actorOf(req) {
        const actor = await (0, context_1.currentActor)();
        if (!actor) {
            throw errors_1.AppError.forbidden("auth.forbidden", "You don't have enough permissions");
        }
        this.logger.debug("rbac.admin.actor", {
            requestId: req.requestId,
            userId: actor.userId,
        });
        return actor;
    }
    /** The permission catalog, grouped — the admin grid's column source. */
    catalog(_req, res, next) {
        try {
            res.status(200).json({ groups: (0, roleSerializer_1.toWireCatalog)((0, catalog_1.permissionsByGroup)()) });
        }
        catch (err) {
            next(err);
        }
    }
    async list(req, res, next) {
        try {
            const roles = await this.service.list(req.auth.workspaceId);
            res.status(200).json({ data: roles.map(roleSerializer_1.toWireRole) });
        }
        catch (err) {
            next(err);
        }
    }
    async create(req, res, next) {
        try {
            const body = req.body;
            const role = await this.service.create({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                name: body.name,
                description: body.description ?? null,
                ...(body.color !== undefined ? { color: body.color } : {}),
                grants: (body.permissions ?? []).map((p) => ({
                    permissionKey: p.key,
                    scope: p.scope,
                })),
            });
            res.status(201).json((0, roleSerializer_1.toWireRole)(role));
        }
        catch (err) {
            next(err);
        }
    }
    async update(req, res, next) {
        try {
            const body = req.body;
            const role = await this.service.update({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                roleId: req.params.id,
                ...(body.name !== undefined ? { name: body.name } : {}),
                ...(body.description !== undefined
                    ? { description: body.description }
                    : {}),
                ...(body.color !== undefined ? { color: body.color } : {}),
            });
            res.status(200).json((0, roleSerializer_1.toWireRole)(role));
        }
        catch (err) {
            next(err);
        }
    }
    async setPermissions(req, res, next) {
        try {
            const body = req.body;
            const grants = await this.service.setGrants({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                roleId: req.params.id,
                grants: body.permissions.map((p) => ({
                    permissionKey: p.key,
                    scope: p.scope,
                })),
            });
            res.status(200).json({
                permissions: grants.map((g) => ({
                    key: g.permissionKey,
                    scope: g.scope,
                })),
            });
        }
        catch (err) {
            next(err);
        }
    }
    async remove(req, res, next) {
        try {
            await this.service.remove({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                roleId: req.params.id,
            });
            res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    }
    async holders(req, res, next) {
        try {
            const rows = await this.service.holders(req.auth.workspaceId, req.params.id);
            res.status(200).json({
                data: rows.map((r) => ({
                    user_id: r.userId,
                    scope_type: r.scopeType,
                    space_id: r.scopeId,
                })),
            });
        }
        catch (err) {
            next(err);
        }
    }
    // ─── assignments ─────────────────────────────────────────────────────────
    async listAssignments(req, res, next) {
        try {
            const rows = await this.service.assignmentsForUser(req.auth.workspaceId, req.params.id);
            res.status(200).json({ data: rows.map(roleSerializer_1.toWireAssignment) });
        }
        catch (err) {
            next(err);
        }
    }
    async assign(req, res, next) {
        try {
            const body = req.body;
            const rows = await this.service.assign({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                userId: req.params.id,
                roleId: body.role_id,
                spaceId: body.space_id ?? null,
            });
            res.status(201).json({ data: rows.map(roleSerializer_1.toWireAssignment) });
        }
        catch (err) {
            next(err);
        }
    }
    async revoke(req, res, next) {
        try {
            const rows = await this.service.revoke({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                userId: req.params.id,
                assignmentId: req.params.assignmentId,
            });
            res.status(200).json({ data: rows.map(roleSerializer_1.toWireAssignment) });
        }
        catch (err) {
            next(err);
        }
    }
    async spaceMembers(req, res, next) {
        try {
            const rows = await this.service.spaceMembers(req.auth.workspaceId, req.params.id);
            res.status(200).json({ data: rows.map(roleSerializer_1.toWireAssignment) });
        }
        catch (err) {
            next(err);
        }
    }
}
exports.RolesController = RolesController;
