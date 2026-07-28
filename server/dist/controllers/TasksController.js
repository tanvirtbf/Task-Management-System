"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksController = void 0;
const express_validator_1 = require("express-validator");
const _shared_1 = require("../db/schema/_shared");
class TasksController {
    tasksService;
    logger;
    constructor(tasksService, logger) {
        this.tasksService = tasksService;
        this.logger = logger;
    }
    /**
     * GET /api/v1/lists/:listId/tasks — one filtered, cursor-paginated page of
     * a list's tasks, each fully hydrated (assignees, watchers, tags,
     * custom_field_values inline).
     *
     * Workspace-scoped via `req.auth.workspaceId` (never client input); the
     * service resolves `:listId` inside that workspace or throws
     * `404 list.not_found`. The v1-level `apiLimiter` (600/min/user) applies.
     */
    async listByList(req, res, next) {
        try {
            const query = (0, express_validator_1.matchedData)(req, {
                locations: ["query"],
            });
            const filters = {
                statusIds: splitCsv(query.status),
                statusGroups: narrowCsv(query.status_group, _shared_1.statusGroups),
                assigneeIds: splitCsv(query.assignee),
                reviewerId: query.reviewer,
                priorities: splitCsv(query.priority)?.map(Number),
                taskTypeIds: splitCsv(query.task_type),
                tagIds: splitCsv(query.tag),
                sprintId: query.sprint,
                bugSeverities: narrowCsv(query.bug_severity, _shared_1.bugSeverities),
                q: query.q,
                dueBefore: query.due_before,
                dueAfter: query.due_after,
                includeArchived: query.include_archived === "true",
                includeSubtasks: query.include_subtasks === "true",
            };
            const result = await this.tasksService.listByList({
                listId: req.params.listId,
                workspaceId: req.auth.workspaceId,
                role: req.auth.role,
                filters,
                cursor: query.cursor,
                limit: query.limit,
            });
            this.logger.debug("tasks.list_by_list.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                listId: req.params.listId,
                count: result.data.length,
            });
            res.status(200).json({
                data: result.data,
                pagination: {
                    next_cursor: result.nextCursor,
                    has_more: result.hasMore,
                    total_estimate: result.total,
                },
            });
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/tasks/:id — one fully-hydrated task (assignees, watchers,
     * tags, custom_field_values inline) by internal id or custom_id.
     *
     * Workspace-scoped via `req.auth.workspaceId` (never client input); the
     * service resolves `:id` inside that workspace or throws `404
     * task.not_found`. Returns the bare `Task` object (single-resource
     * responses are not envelope-wrapped — API_DESIGN.md §1).
     */
    async getById(req, res, next) {
        try {
            const task = await this.tasksService.getById({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
                role: req.auth.role,
            });
            this.logger.debug("tasks.get_by_id.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                taskId: task.id,
            });
            // Same ETag contract as create/PATCH (TaskWriteController): the
            // task's `updated_at`, so a client can GET → echo it in `If-Match`
            // on the next PATCH. Without this, Express's default weak
            // content-hash ETag leaks through and never matches If-Match.
            res.setHeader("ETag", task.updated_at);
            res.status(200).json(task);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * GET /api/v1/tasks/:id/subtasks — the parent's direct children, each fully
     * hydrated, as a bare `Task[]` (the §10 "array of Task" shape — like
     * `GET /lists/:listId/statuses`, not the `{ data, pagination }` envelope).
     *
     * Workspace-scoped via `req.auth.workspaceId`; the service resolves the
     * parent `:id` (internal id or custom_id) in that workspace or throws `404
     * task.not_found`. Archived children are excluded unless
     * `?include_archived=true`.
     */
    async getSubtasks(req, res, next) {
        try {
            const query = (0, express_validator_1.matchedData)(req, {
                locations: ["query"],
            });
            const subtasks = await this.tasksService.getSubtasks({
                idOrKey: req.params.id,
                workspaceId: req.auth.workspaceId,
                role: req.auth.role,
                includeArchived: query.include_archived === "true",
            });
            this.logger.debug("tasks.get_subtasks.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                parentId: req.params.id,
                count: subtasks.length,
            });
            res.status(200).json(subtasks);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.TasksController = TasksController;
/**
 * Split a comma-separated query value into trimmed, non-empty members, or
 * `undefined` when the param is absent/empty (treated as "filter not supplied").
 */
const splitCsv = (raw) => {
    if (!raw)
        return undefined;
    const members = raw
        .split(",")
        .map((member) => member.trim())
        .filter((member) => member.length > 0);
    return members.length > 0 ? members : undefined;
};
/**
 * Split a CSV value and keep only members of `allowed`, narrowing to the enum
 * union. The validator already rejects out-of-set members; this re-narrows for
 * type-safety and returns `undefined` when nothing remains.
 */
const narrowCsv = (raw, allowed) => {
    const members = splitCsv(raw);
    if (!members)
        return undefined;
    const narrowed = members.filter((member) => allowed.includes(member));
    return narrowed.length > 0 ? narrowed : undefined;
};
