import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { ListService } from "../services/ListService";
import type { ListRecord } from "../repositories/ListsRepo";
import type {
    GetListRequest,
    ListAllRequest,
    ListBySpaceRequest,
} from "../types/lists";

/**
 * §6 Lists HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

/**
 * Wire-format `List` per API_DESIGN.md Appendix A. snake_case fields; omits
 * `updated_at`, which the contract does not expose.
 */
interface WireList {
    id: string;
    space_id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    position: number;
    default_task_type_id: string | null;
    is_private: boolean;
    archived_at: string | null;
    created_by: string;
    created_at: string;
}

const toWireList = (l: ListRecord): WireList => ({
    id: l.id,
    space_id: l.spaceId,
    name: l.name,
    description: l.description,
    icon: l.icon,
    color: l.color,
    position: l.position,
    default_task_type_id: l.defaultTaskTypeId,
    is_private: l.isPrivate,
    archived_at: l.archivedAt ? l.archivedAt.toISOString() : null,
    created_by: l.createdBy,
    created_at: l.createdAt.toISOString(),
});

export class ListController {
    constructor(
        private listService: ListService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/spaces/:spaceId/lists — list the lists in one space.
     *
     * Archived lists are excluded unless `?include_archived=true` (or `=1`).
     * The response uses the spec list envelope; lists are a bounded per-space
     * set with no `internal_id`, so the whole set is returned in a single page
     * (`next_cursor: null`, `has_more: false`) — matching `GET /spaces`.
     *
     * `404 space.not_found` if the space is missing or in another workspace.
     */
    async listBySpace(
        req: ListBySpaceRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { spaceId } = req.params;

            // `include_archived` was checked as a boolean string by
            // `listBySpaceValidator`; coerce the raw query value here.
            const rawIncludeArchived = req.query.include_archived;
            const includeArchived =
                rawIncludeArchived === "true" || rawIncludeArchived === "1";

            const rows = await this.listService.listBySpace({
                spaceId,
                workspaceId: req.auth.workspaceId,
                includeArchived,
            });

            this.logger.debug("lists.list_by_space.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                spaceId,
                includeArchived,
                count: rows.length,
            });

            res.status(200).json({
                data: rows.map(toWireList),
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
     * GET /api/v1/lists — list every list in the caller's workspace, across all
     * spaces. Optional `?space_id` narrows to one space (resolved in-workspace
     * or `404 space.not_found`); archived lists are excluded unless
     * `?include_archived=true` (or `=1`).
     *
     * Like `GET /spaces` and `listBySpace`, lists are a bounded set with no
     * `internal_id`, so the whole set is returned in a single page
     * (`next_cursor: null`, `has_more: false`); a stray `?cursor` / `?limit` is
     * accepted but inert.
     */
    async listAll(req: ListAllRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;

            // `space_id` was trimmed + length-checked by `listAllValidator` when
            // present; narrow the raw query value to a string (a duplicated
            // param arrives as an array and is treated as no filter).
            const rawSpaceId = req.query.space_id;
            const spaceId =
                typeof rawSpaceId === "string" ? rawSpaceId : undefined;

            // `include_archived` was checked as a boolean string by the
            // validator; coerce the raw value here (mirrors `listBySpace`).
            const rawIncludeArchived = req.query.include_archived;
            const includeArchived =
                rawIncludeArchived === "true" || rawIncludeArchived === "1";

            const rows = await this.listService.listAll({
                workspaceId,
                spaceId,
                includeArchived,
            });

            this.logger.debug("lists.list_all.ok", {
                requestId: req.requestId,
                workspaceId,
                spaceId,
                includeArchived,
                count: rows.length,
            });

            res.status(200).json({
                data: rows.map(toWireList),
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
     * GET /api/v1/lists/:id — read one list by id, scoped to the caller's
     * workspace. Returns the bare wire `List` (single-resource convention — no
     * `{ data }` envelope, matching `GET /workspace` and `GET /auth/me`).
     *
     * `404 list.not_found` if the id is missing or in another workspace.
     * Archived lists resolve here (soft-delete is still readable on a direct
     * read); the service owns that policy.
     */
    async getById(req: GetListRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;

            const list = await this.listService.getById({
                listId: id,
                workspaceId: req.auth.workspaceId,
            });

            this.logger.debug("lists.get.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                listId: id,
            });

            res.status(200).json(toWireList(list));
        } catch (err) {
            next(err);
        }
    }
}
