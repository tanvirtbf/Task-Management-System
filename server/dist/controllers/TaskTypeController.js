"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskTypeController = void 0;
const pagination_1 = require("../utils/pagination");
const toWireTaskType = (t) => ({
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
const optionalText = (value) => value && value.length > 0 ? value : undefined;
class TaskTypeController {
    taskTypeService;
    logger;
    constructor(taskTypeService, logger) {
        this.taskTypeService = taskTypeService;
        this.logger = logger;
    }
    /**
     * GET /api/v1/task-types — list every task type in the caller's workspace.
     * Workspace-scoped: the workspace id comes from the verified access token
     * (`req.auth.workspaceId`), never from client input.
     */
    async list(req, res, next) {
        try {
            const workspaceId = req.auth.workspaceId;
            const rows = await this.taskTypeService.list(workspaceId);
            this.logger.debug("task_types.list.ok", {
                requestId: req.requestId,
                workspaceId,
                count: rows.length,
            });
            res.status(200).json(
            // F23 (ISS-007): a real limit + a working cursor —
            // this envelope used to say has_more:false no matter what.
            (0, pagination_1.paginateArray)(rows.map(toWireTaskType), req.query.limit, req.query.cursor));
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * POST /api/v1/task-types — create a task type (👑 owner/admin, enforced by
     * the route's `canAccess`). The workspace and actor come from the verified
     * access token (`req.auth`), never from client input; `is_system`,
     * `position`, and `id` are server-owned and ignored if sent in the body.
     */
    async create(req, res, next) {
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
        }
        catch (err) {
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
    async update(req, res, next) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const id = req.params.id;
            const body = req.body;
            const patch = {};
            if (body.name !== undefined)
                patch.name = body.name;
            if (body.icon !== undefined)
                patch.icon = body.icon;
            if (body.color !== undefined)
                patch.color = body.color;
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
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * DELETE /api/v1/task-types/:id — delete a task type (👑 owner/admin,
     * enforced by the route's `canAccess`). Refuses with `403 task_type.system`
     * for a seeded system type and `409 task_type.in_use` when a task or list
     * still references it. The workspace and actor come from the verified access
     * token (`req.auth`). Returns `204 No Content` on success.
     */
    async remove(req, res, next) {
        try {
            const workspaceId = req.auth.workspaceId;
            const actorId = req.auth.sub;
            const id = req.params.id;
            await this.taskTypeService.delete({ workspaceId, actorId, id });
            this.logger.info("task_types.delete.ok", {
                requestId: req.requestId,
                workspaceId,
                taskTypeId: id,
            });
            res.status(204).send();
        }
        catch (err) {
            next(err);
        }
    }
}
exports.TaskTypeController = TaskTypeController;
