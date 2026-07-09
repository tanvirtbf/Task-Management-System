import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { SpacesService } from "../services/SpacesService";
import type {
    SpaceRecord,
    SpaceUpdateFields,
} from "../repositories/SpacesRepo";
import type {
    CreateSpaceRequest,
    GetSpaceRequest,
    ListSpacesRequest,
    SpaceIdRequest,
    UpdateSpaceRequest,
} from "../types/spaces";

/** Schema defaults for `spaces.icon` / `spaces.color`, applied when omitted. */
const DEFAULT_SPACE_ICON = "Folder";
const DEFAULT_SPACE_COLOR = "#4F46E5";

/**
 * §5 Spaces HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

/**
 * Wire-format `Space` per API_DESIGN.md Appendix A. snake_case fields; never
 * leak `workspace_id` or `updated_at`.
 */
interface WireSpace {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    is_private: boolean;
    position: number;
    archived_at: string | null;
    created_by: string;
    created_at: string;
}

const toWireSpace = (s: SpaceRecord): WireSpace => ({
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    color: s.color,
    is_private: s.isPrivate,
    position: s.position,
    archived_at: s.archivedAt ? s.archivedAt.toISOString() : null,
    created_by: s.createdBy,
    created_at: s.createdAt.toISOString(),
});

export class SpacesController {
    constructor(
        private spacesService: SpacesService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/spaces — list the workspace's spaces.
     *
     * Archived spaces are excluded unless `?include_archived=true`. The
     * response uses the spec list envelope; spaces are a bounded per-workspace
     * set with no `internal_id`, so the whole set is returned in a single page
     * (`next_cursor: null`, `has_more: false`).
     */
    async list(req: ListSpacesRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;

            // The validator sanitises `include_archived` to lower-case and
            // restricts it to "true" | "false"; absent ⇒ default false.
            const includeArchived = req.query.include_archived === "true";

            const rows = await this.spacesService.listSpaces({
                workspaceId,
                includeArchived,
            });

            this.logger.debug("spaces.list.ok", {
                requestId: req.requestId,
                workspaceId,
                includeArchived,
                count: rows.length,
            });

            res.status(200).json({
                data: rows.map(toWireSpace),
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
     * GET /api/v1/spaces/:id — read a single space.
     *
     * Workspace-scoped: the space is resolved within `req.auth.workspaceId`, so
     * a missing or another tenant's id both surface as `404 space.not_found`.
     * The response is the bare wire `Space` object (single-resource convention,
     * cf. `GET /api/v1/workspace`), not the list envelope. An archived space
     * still resolves here with its `archived_at` set.
     */
    async getById(req: GetSpaceRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;
            const spaceId = req.params.id;

            const space = await this.spacesService.getSpace({
                spaceId,
                workspaceId,
            });

            this.logger.debug("spaces.get.ok", {
                requestId: req.requestId,
                workspaceId,
                spaceId,
            });

            res.status(200).json(toWireSpace(space));
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/spaces — create a space (👑 admin/owner; the role gate runs
     * in the route's `canAccess` middleware).
     *
     * Identity is taken from the verified access token (`req.auth`), never the
     * body — so the space always lands in the caller's own workspace and the
     * creator cannot be spoofed. Only the documented fields are read; stray body
     * keys (e.g. `workspace_id`, `created_by`) are ignored. Omitted optional
     * fields fall back to the schema defaults. Returns the new resource as a
     * bare object per the spec's single-resource shape.
     */
    async create(req: CreateSpaceRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const body = req.body;

            const space = await this.spacesService.create({
                workspaceId,
                actorId,
                name: body.name,
                description: body.description ?? null,
                icon: body.icon ?? DEFAULT_SPACE_ICON,
                color: body.color ?? DEFAULT_SPACE_COLOR,
                isPrivate: body.is_private ?? false,
                position: body.position ?? 0,
            });

            this.logger.info("spaces.create.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                spaceId: space.id,
            });

            res.status(201).json(toWireSpace(space));
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/spaces/:id — update a space (👑 admin/owner; the role gate
     * runs in the route's `canAccess` middleware).
     *
     * Identity and workspace scope come from `req.auth`, never the body. Only
     * the documented, validator-checked fields are read; stray keys are ignored
     * (no mass-assignment). A body with no updatable fields is a no-op that
     * returns the unchanged space. Returns the updated resource as a bare object
     * per the spec's single-resource shape.
     */
    async update(req: UpdateSpaceRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const spaceId = req.params.id;
            const body = req.body;

            const fields: SpaceUpdateFields = {};
            if (body.name !== undefined) fields.name = body.name;
            if (body.description !== undefined)
                fields.description = body.description;
            if (body.icon !== undefined) fields.icon = body.icon;
            if (body.color !== undefined) fields.color = body.color;
            if (body.is_private !== undefined)
                fields.isPrivate = body.is_private;
            if (body.position !== undefined) fields.position = body.position;

            const space = await this.spacesService.update({
                spaceId,
                workspaceId,
                actorId,
                fields,
            });

            this.logger.info("spaces.update.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                spaceId,
                fields: Object.keys(fields),
            });

            res.status(200).json(toWireSpace(space));
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/spaces/:id/archive — soft-delete a space (👑 admin/owner; the
     * role gate runs in the route's `canAccess` middleware).
     *
     * Sets `archived_at` and cascade-archives the space's lists. Idempotent: an
     * already-archived space still returns 204. Workspace scope comes from
     * `req.auth`. No response body (204).
     */
    async archive(req: SpaceIdRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const spaceId = req.params.id;

            await this.spacesService.archive({
                spaceId,
                workspaceId,
                actorId,
            });

            this.logger.info("spaces.archive.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                spaceId,
            });

            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/spaces/:id/unarchive — restore a soft-deleted space (👑
     * admin/owner; the role gate runs in the route's `canAccess` middleware).
     *
     * Clears `archived_at`. Idempotent: a live space still returns 204. Does NOT
     * restore the lists the archive cascaded (see `SpacesService.unarchive`).
     * Workspace scope comes from `req.auth`. No response body (204).
     */
    async unarchive(req: SpaceIdRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const spaceId = req.params.id;

            await this.spacesService.unarchive({
                spaceId,
                workspaceId,
                actorId,
            });

            this.logger.info("spaces.unarchive.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                spaceId,
            });

            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }

    /**
     * DELETE /api/v1/spaces/:id — permanently delete a space (🛡️ owner-only; the
     * role gate runs in the route's `canAccess` middleware).
     *
     * Requires the space to be archived and hold no lists (else 409). Workspace
     * scope comes from `req.auth`. No response body (204).
     */
    async remove(req: SpaceIdRequest, res: Response, next: NextFunction) {
        try {
            const { sub: actorId, workspaceId } = req.auth;
            const spaceId = req.params.id;

            await this.spacesService.remove({
                spaceId,
                workspaceId,
                actorId,
            });

            this.logger.info("spaces.delete.ok", {
                requestId: req.requestId,
                workspaceId,
                actorId,
                spaceId,
            });

            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }
}
