import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { StatusesService } from "../services/StatusesService";
import { AppError } from "../errors";
import type { StatusRecord } from "../repositories/StatusesRepo";
import type {
    CreateStatusRequest,
    DeleteStatusRequest,
    ListStatusesRequest,
    ReorderStatusesRequest,
    UpdateStatusRequest,
} from "../types/statuses";
import type { ReorderStatusItem } from "../services/StatusesService";

/**
 * §7 Statuses HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

/**
 * Wire-format `Status` per API_DESIGN.md Appendix A. snake_case fields; the
 * internal `created_at` / `updated_at` columns are never exposed.
 */
interface WireStatus {
    id: string;
    scope_type: StatusRecord["scopeType"];
    scope_id: string;
    name: string;
    color: string;
    status_group: StatusRecord["statusGroup"];
    position: number;
}

const toWireStatus = (s: StatusRecord): WireStatus => ({
    id: s.id,
    scope_type: s.scopeType,
    scope_id: s.scopeId,
    name: s.name,
    color: s.color,
    status_group: s.statusGroup,
    position: s.position,
});

export class StatusesController {
    constructor(
        private statusesService: StatusesService,
        private logger: Logger,
    ) {}

    async listByList(
        req: ListStatusesRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { listId } = req.params;

            this.logger.debug("statuses.list_by_list.attempt", {
                requestId: req.requestId,
                listId,
            });

            const rows = await this.statusesService.listByList({
                listId,
                workspaceId: req.auth.workspaceId,
            });

            res.status(200).json(rows.map(toWireStatus));
        } catch (err) {
            next(err);
        }
    }

    /**
     * POST /api/v1/lists/:listId/statuses — add a status to a list.
     *
     * Owner/Admin only (enforced by `canAccess` in the route chain). Reads only
     * the whitelisted body fields (`name`, `status_group`, `color`, `position`);
     * `scope_type` / `scope_id` / `id` are never taken from the client. Returns
     * `201` with the created `Status` as a bare object.
     */
    async create(req: CreateStatusRequest, res: Response, next: NextFunction) {
        try {
            const { listId } = req.params;
            const { name, status_group, color, position } = req.body;

            const record = await this.statusesService.createForList({
                listId,
                workspaceId: req.auth.workspaceId,
                name,
                statusGroup: status_group,
                color,
                position,
            });

            this.logger.info("statuses.create.ok", {
                requestId: req.requestId,
                listId,
                statusId: record.id,
                statusGroup: record.statusGroup,
                position: record.position,
            });

            res.status(201).json(toWireStatus(record));
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/statuses/:id — update a status's name / color / group.
     *
     * Owner/Admin only (enforced by `canAccess` in the route chain). Reads only
     * the whitelisted body fields; `scope_type` / `scope_id` / `position` / `id`
     * are never taken from the client. At least one of `name` / `color` /
     * `status_group` must be present (422 otherwise). Returns `200` with the
     * updated `Status` as a bare object.
     */
    async update(req: UpdateStatusRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const { name, color, status_group } = req.body;

            const fields: string[] = [];
            if (name !== undefined) fields.push("name");
            if (color !== undefined) fields.push("color");
            if (status_group !== undefined) fields.push("status_group");
            if (fields.length === 0) {
                throw AppError.validationFailed([
                    {
                        issue: "Provide at least one field to update: name, color, or status_group",
                    },
                ]);
            }

            const record = await this.statusesService.updateById({
                id,
                workspaceId: req.auth.workspaceId,
                name,
                color,
                statusGroup: status_group,
            });

            this.logger.info("statuses.update.ok", {
                requestId: req.requestId,
                statusId: id,
                fields,
            });

            res.status(200).json(toWireStatus(record));
        } catch (err) {
            next(err);
        }
    }

    /**
     * DELETE /api/v1/statuses/:id — delete a status.
     *
     * Owner/Admin only (enforced by `canAccess` in the route chain). Refuses with
     * `409 status.in_use` if any task references the status, and with
     * `422 status.last_in_group` if it is the last status of its group (the Board
     * view needs ≥1 status per group). Returns `204 No Content` on success.
     */
    async remove(req: DeleteStatusRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;

            await this.statusesService.deleteById({
                id,
                workspaceId: req.auth.workspaceId,
            });

            res.status(204).send();
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/lists/:listId/statuses/reorder — bulk-reposition a list's
     * statuses.
     *
     * Owner/Admin only (enforced by `canAccess` in the route chain). The request
     * body is a bare JSON array of `{ id, position }` items, which `checkSchema`
     * cannot validate cleanly at the top level — so the array's structure (it is a
     * non-empty array; each item is `{ id: string ≤64, position: int ≥0 }`; ids
     * are unique) is validated here and surfaced as `422 validation.failed`. The
     * service applies the positions in one transaction and returns the full list
     * reordered (`200`, GET shape).
     */
    async reorder(
        req: ReorderStatusesRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const { listId } = req.params;
            const items = this.parseReorderItems(req.body);

            const rows = await this.statusesService.reorderForList({
                listId,
                workspaceId: req.auth.workspaceId,
                items,
            });

            res.status(200).json(rows.map(toWireStatus));
        } catch (err) {
            next(err);
        }
    }

    /**
     * Validate + normalise the reorder request body. Throws `422
     * validation.failed` with a precise per-item detail on the first violation.
     */
    private parseReorderItems(body: unknown): ReorderStatusItem[] {
        if (!Array.isArray(body) || body.length === 0) {
            throw AppError.validationFailed([
                {
                    field: "body",
                    issue: "Body must be a non-empty array of { id, position } items",
                },
            ]);
        }

        const items: ReorderStatusItem[] = [];
        const seen = new Set<string>();

        body.forEach((raw, i) => {
            if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
                throw AppError.validationFailed([
                    { field: `[${i}]`, issue: "Each item must be an object" },
                ]);
            }

            const { id, position } = raw as {
                id?: unknown;
                position?: unknown;
            };

            if (typeof id !== "string" || id.length < 1 || id.length > 64) {
                throw AppError.validationFailed([
                    {
                        field: `[${i}].id`,
                        issue: "id must be a string of 1–64 characters",
                    },
                ]);
            }
            if (
                typeof position !== "number" ||
                !Number.isInteger(position) ||
                position < 0
            ) {
                throw AppError.validationFailed([
                    {
                        field: `[${i}].position`,
                        issue: "position must be a non-negative integer",
                    },
                ]);
            }
            if (seen.has(id)) {
                throw AppError.validationFailed([
                    {
                        field: `[${i}].id`,
                        issue: `Duplicate id "${id}" in reorder request`,
                    },
                ]);
            }
            seen.add(id);
            items.push({ id, position });
        });

        return items;
    }
}
