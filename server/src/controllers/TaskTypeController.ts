import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { TaskTypeService } from "../services/TaskTypeService";
import type { AuthRequest } from "../types";
import type {
    CreateTaskTypeRequest,
    UpdateTaskTypeRequest,
} from "../types/taskTypes";
import type {
    TaskTypeRecord,
    TaskTypeUpdateRow,
} from "../repositories/TaskTypesRepo";

/**
 * §8 Task types HTTP layer.
 *
 * Controllers translate request → service input and service result → wire
 * format. They never own business logic; they never touch the DB directly.
 */

/**
 * Wire-format `TaskType` per API_DESIGN.md Appendix A. snake_case fields, and
 * never leak `workspace_id`, `created_at`, or `updated_at`.
 */
interface WireTaskType {
    id: string;
    name: string;
    description: string | null;
    icon: string;
    color: string;
    is_milestone_type: boolean;
    is_system: boolean;
    is_dev_type: boolean;
    position: number;
}

const toWireTaskType = (t: TaskTypeRecord): WireTaskType => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    color: t.color,
    is_milestone_type: t.isMilestoneType,
    is_system: t.isSystem,
    is_dev_type: t.isDevType,
    position: t.position,
});

/**
 * Map an optional free-text field to what the data layer wants: `undefined`
 * (so the column DEFAULT / NULL applies) for an absent or blank value, or the
 * already-trimmed string otherwise. The validator trims the input, so a blank
 * entry arrives as `""`.
 */
const optionalText = (value: string | undefined): string | undefined =>
    value && value.length > 0 ? value : undefined;

export class TaskTypeController {
    constructor(
        private taskTypeService: TaskTypeService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/task-types — list every task type in the caller's workspace.
     * Workspace-scoped: the workspace id comes from the verified access token
     * (`req.auth.workspaceId`), never from client input.
     */
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaceId = req.auth.workspaceId;

            const rows = await this.taskTypeService.list(workspaceId);

            this.logger.debug("task_types.list.ok", {
                requestId: req.requestId,
                workspaceId,
                count: rows.length,
            });

            res.status(200).json({
                data: rows.map(toWireTaskType),
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
     * POST /api/v1/task-types — create a task type (👑 owner/admin, enforced by
     * the route's `canAccess`). The workspace and actor come from the verified
     * access token (`req.auth`), never from client input; `is_system`,
     * `position`, and `id` are server-owned and ignored if sent in the body.
     */
    async create(
        req: CreateTaskTypeRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const body = req.body;

            const record = await this.taskTypeService.create({
                workspaceId,
                actorId,
                name: body.name,
                description: optionalText(body.description),
                icon: body.icon,
                color: body.color,
                isMilestoneType: body.is_milestone_type,
                isDevType: body.is_dev_type,
            });

            this.logger.info("task_types.create.ok", {
                requestId: req.requestId,
                workspaceId,
                taskTypeId: record.id,
            });

            res.status(201).json(toWireTaskType(record));
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/task-types/:id — partial update (👑 owner/admin, enforced by
     * the route's `canAccess`). Only the body keys the client actually sent are
     * forwarded, so untouched columns stay put; `description` is tri-state
     * (absent = unchanged, null/blank = cleared). `is_system`, `position`,
     * `id`, and `workspace_id` are server-owned and ignored if present.
     */
    async update(
        req: UpdateTaskTypeRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const id = req.params.id;
            const body = req.body;

            const patch: TaskTypeUpdateRow = {};
            if (body.name !== undefined) patch.name = body.name;
            if (body.icon !== undefined) patch.icon = body.icon;
            if (body.color !== undefined) patch.color = body.color;
            if (body.description !== undefined) {
                // null / blank → clear to NULL; text → the trimmed value.
                patch.description =
                    optionalText(body.description ?? undefined) ?? null;
            }
            if (body.is_milestone_type !== undefined) {
                patch.isMilestoneType = body.is_milestone_type;
            }
            if (body.is_dev_type !== undefined) {
                patch.isDevType = body.is_dev_type;
            }

            const record = await this.taskTypeService.update({
                workspaceId,
                actorId,
                id,
                patch,
            });

            this.logger.info("task_types.update.ok", {
                requestId: req.requestId,
                workspaceId,
                taskTypeId: id,
                fields: Object.keys(patch),
            });

            res.status(200).json(toWireTaskType(record));
        } catch (err) {
            next(err);
        }
    }
}
