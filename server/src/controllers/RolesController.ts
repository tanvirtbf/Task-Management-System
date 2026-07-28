import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { AppError } from "../errors";
import { currentActor } from "../rbac/context";
import { permissionsByGroup } from "../rbac/catalog";
import type { RolesAdminService } from "../services/RolesAdminService";
import type { AuthRequest } from "../types";
import {
    toWireAssignment,
    toWireCatalog,
    toWireRole,
} from "../serializers/roleSerializer";

/**
 * §34 Roles & permissions administration.
 *
 * Every write needs the RESOLVED actor (not the JWT role) because the
 * escalation guard compares what is being granted against what the caller
 * actually holds. `requirePermission` has already run, so an actor exists.
 */
export class RolesController {
    constructor(
        private service: RolesAdminService,
        private logger: Logger,
    ) {}

    private async actorOf(req: AuthRequest) {
        const actor = await currentActor();
        if (!actor) {
            throw AppError.forbidden(
                "auth.forbidden",
                "You don't have enough permissions",
            );
        }
        this.logger.debug("rbac.admin.actor", {
            requestId: req.requestId,
            userId: actor.userId,
        });
        return actor;
    }

    /** The permission catalog, grouped — the admin grid's column source. */
    catalog(_req: AuthRequest, res: Response, next: NextFunction) {
        try {
            res.status(200).json({ groups: toWireCatalog(permissionsByGroup()) });
        } catch (err) {
            next(err);
        }
    }

    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const roles = await this.service.list(req.auth.workspaceId);
            res.status(200).json({ data: roles.map(toWireRole) });
        } catch (err) {
            next(err);
        }
    }

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const body = req.body as {
                name: string;
                description?: string | null;
                color?: string;
                permissions?: { key: string; scope: string }[];
            };
            const role = await this.service.create({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                name: body.name,
                description: body.description ?? null,
                ...(body.color !== undefined ? { color: body.color } : {}),
                grants: (body.permissions ?? []).map((p) => ({
                    permissionKey: p.key,
                    scope: p.scope as never,
                })),
            });
            res.status(201).json(toWireRole(role));
        } catch (err) {
            next(err);
        }
    }

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const body = req.body as {
                name?: string;
                description?: string | null;
                color?: string;
            };
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
            res.status(200).json(toWireRole(role));
        } catch (err) {
            next(err);
        }
    }

    async setPermissions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const body = req.body as {
                permissions: { key: string; scope: string }[];
            };
            const grants = await this.service.setGrants({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                roleId: req.params.id,
                grants: body.permissions.map((p) => ({
                    permissionKey: p.key,
                    scope: p.scope as never,
                })),
            });
            res.status(200).json({
                permissions: grants.map((g) => ({
                    key: g.permissionKey,
                    scope: g.scope,
                })),
            });
        } catch (err) {
            next(err);
        }
    }

    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await this.service.remove({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                roleId: req.params.id,
            });
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }

    async holders(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const rows = await this.service.holders(
                req.auth.workspaceId,
                req.params.id,
            );
            res.status(200).json({
                data: rows.map((r) => ({
                    user_id: r.userId,
                    scope_type: r.scopeType,
                    space_id: r.scopeId,
                })),
            });
        } catch (err) {
            next(err);
        }
    }

    // ─── assignments ─────────────────────────────────────────────────────────

    async listAssignments(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const rows = await this.service.assignmentsForUser(
                req.auth.workspaceId,
                req.params.id,
            );
            res.status(200).json({ data: rows.map(toWireAssignment) });
        } catch (err) {
            next(err);
        }
    }

    async assign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const body = req.body as { role_id: string; space_id?: string | null };
            const rows = await this.service.assign({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                userId: req.params.id,
                roleId: body.role_id,
                spaceId: body.space_id ?? null,
            });
            res.status(201).json({ data: rows.map(toWireAssignment) });
        } catch (err) {
            next(err);
        }
    }

    async revoke(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const rows = await this.service.revoke({
                workspaceId: req.auth.workspaceId,
                actor: await this.actorOf(req),
                userId: req.params.id,
                assignmentId: req.params.assignmentId,
            });
            res.status(200).json({ data: rows.map(toWireAssignment) });
        } catch (err) {
            next(err);
        }
    }

    async spaceMembers(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const rows = await this.service.spaceMembers(
                req.auth.workspaceId,
                req.params.id,
            );
            res.status(200).json({ data: rows.map(toWireAssignment) });
        } catch (err) {
            next(err);
        }
    }
}
