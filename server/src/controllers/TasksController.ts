import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { matchedData } from "express-validator";
import { TasksService } from "../services/TasksService";
import { bugSeverities, statusGroups } from "../db/schema/_shared";
import type {
    GetTaskRequest,
    ListTasksFilters,
    ListTasksRequest,
    SubtasksRequest,
} from "../types/tasks";

/**
 * §10 Tasks HTTP layer (read side). Translates the validated query into a
 * service call and the result into the spec's `{ data, pagination }` envelope.
 */

/** Validated, sanitized subset of the query string (see `listTasksValidator`). */
interface ListTasksQuery {
    status?: string;
    status_group?: string;
    assignee?: string;
    reviewer?: string;
    priority?: string;
    task_type?: string;
    tag?: string;
    sprint?: string;
    bug_severity?: string;
    q?: string;
    due_before?: string;
    due_after?: string;
    include_archived?: string;
    include_subtasks?: string;
    cursor?: string;
    limit?: number;
}

export class TasksController {
    constructor(
        private tasksService: TasksService,
        private logger: Logger,
    ) {}

    /**
     * GET /api/v1/lists/:listId/tasks — one filtered, cursor-paginated page of
     * a list's tasks, each fully hydrated (assignees, watchers, tags,
     * custom_field_values inline).
     *
     * Workspace-scoped via `req.auth.workspaceId` (never client input); the
     * service resolves `:listId` inside that workspace or throws
     * `404 list.not_found`. The v1-level `apiLimiter` (600/min/user) applies.
     */
    async listByList(req: ListTasksRequest, res: Response, next: NextFunction) {
        try {
            const query: ListTasksQuery = matchedData(req, {
                locations: ["query"],
            });

            const filters: ListTasksFilters = {
                statusIds: splitCsv(query.status),
                statusGroups: narrowCsv(query.status_group, statusGroups),
                assigneeIds: splitCsv(query.assignee),
                reviewerId: query.reviewer,
                priorities: splitCsv(query.priority)?.map(Number),
                taskTypeIds: splitCsv(query.task_type),
                tagIds: splitCsv(query.tag),
                sprintId: query.sprint,
                bugSeverities: narrowCsv(query.bug_severity, bugSeverities),
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
        } catch (err) {
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
    async getById(req: GetTaskRequest, res: Response, next: NextFunction) {
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
        } catch (err) {
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
    async getSubtasks(req: SubtasksRequest, res: Response, next: NextFunction) {
        try {
            const query: { include_archived?: string } = matchedData(req, {
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
        } catch (err) {
            next(err);
        }
    }
}

/**
 * Split a comma-separated query value into trimmed, non-empty members, or
 * `undefined` when the param is absent/empty (treated as "filter not supplied").
 */
const splitCsv = (raw?: string): string[] | undefined => {
    if (!raw) return undefined;
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
const narrowCsv = <T extends string>(
    raw: string | undefined,
    allowed: readonly T[],
): T[] | undefined => {
    const members = splitCsv(raw);
    if (!members) return undefined;
    const narrowed = members.filter((member): member is T =>
        (allowed as readonly string[]).includes(member),
    );
    return narrowed.length > 0 ? narrowed : undefined;
};
