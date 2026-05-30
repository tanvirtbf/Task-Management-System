import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { StatusesService } from "../services/StatusesService";
import { AppError } from "../errors";
import type { StatusRecord } from "../repositories/StatusesRepo";
import type {
    CreateStatusRequest,
    ListStatusesRequest,
    UpdateStatusRequest,
} from "../types/statuses";

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
}
