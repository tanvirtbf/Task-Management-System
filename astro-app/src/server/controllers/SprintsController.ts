import type { NextFunction, Response } from "express";
import type { Logger } from "winston";
import { SprintsService } from "../services/SprintsService";
import { AppError } from "../errors";
import type { SprintStatus } from "../repositories/SprintsRepo";
import type {
    AddSprintTasksRequest,
    CloseSprintRequest,
    CreateSprintRequest,
    GetActiveSprintRequest,
    GetSprintRequest,
    ListSprintsRequest,
    RemoveSprintTaskRequest,
    StartSprintRequest,
    UpdateSprintRequest,
} from "../types/sprints";

/**
 * §20 Sprints HTTP layer. Controllers translate request → service input and the
 * service's wire-shaped result → response. Workspace + actor identity always
 * come from `req.auth`, never the body. Reads return a bare `Sprint` / `Sprint[]`
 * (the §20 contract — sprints are a small per-workspace collection, no cursor);
 * mutations return the affected sprint (or 204 for the task membership writes).
 */
export class SprintsController {
    constructor(
        private service: SprintsService,
        private logger: Logger,
    ) {}

    /** GET /api/v1/sprints — all sprints, optional `?status=` filter (🔐). */
    async list(req: ListSprintsRequest, res: Response, next: NextFunction) {
        try {
            const raw = req.query.status;
            // A duplicated `?status=a&status=b` arrives as an array — reject it
            // rather than silently returning an unfiltered list (`status` is a
            // single-value enum filter per §20).
            if (raw !== undefined && typeof raw !== "string") {
                throw AppError.validationFailed([
                    { field: "status", issue: "status must be a single value" },
                ]);
            }
            const status = raw as SprintStatus | undefined;

            const sprints = await this.service.list({
                workspaceId: req.auth.workspaceId,
                status,
            });

            this.logger.debug("sprints.list.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                status,
                count: sprints.length,
            });

            res.status(200).json(sprints);
        } catch (err) {
            next(err);
        }
    }

    /** GET /api/v1/sprints/active — the single active sprint (🔐, 404 if none). */
    async getActive(
        req: GetActiveSprintRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            const sprint = await this.service.getActive({
                workspaceId: req.auth.workspaceId,
            });
            res.status(200).json(sprint);
        } catch (err) {
            next(err);
        }
    }

    /** GET /api/v1/sprints/:id — one sprint resolved in the workspace (🔐). */
    async getById(req: GetSprintRequest, res: Response, next: NextFunction) {
        try {
            const sprint = await this.service.getById({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
            });
            res.status(200).json(sprint);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/sprints — create a planned sprint (👑). Returns 201. */
    async create(req: CreateSprintRequest, res: Response, next: NextFunction) {
        try {
            const { name, goal, start_date, end_date, committed_points } =
                req.body;

            const sprint = await this.service.create({
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                name,
                goal: goal ?? null,
                startDate: start_date,
                endDate: end_date,
                committedPoints: committed_points ?? 0,
            });

            this.logger.info("sprints.create.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                sprintId: sprint.id,
            });

            res.status(201).json(sprint);
        } catch (err) {
            next(err);
        }
    }

    /** PATCH /api/v1/sprints/:id — partial update (👑). Returns 200. */
    async update(req: UpdateSprintRequest, res: Response, next: NextFunction) {
        try {
            const b = req.body;
            const sprint = await this.service.update({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                fields: {
                    name: b.name,
                    goal: b.goal,
                    startDate: b.start_date,
                    endDate: b.end_date,
                    committedPoints: b.committed_points,
                },
            });

            this.logger.info("sprints.update.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                sprintId: sprint.id,
            });

            res.status(200).json(sprint);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/sprints/:id/start — planned → active (👑). Returns 200. */
    async start(req: StartSprintRequest, res: Response, next: NextFunction) {
        try {
            const sprint = await this.service.start({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });

            this.logger.info("sprints.start.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                sprintId: sprint.id,
            });

            res.status(200).json(sprint);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/sprints/:id/close — active → closed (👑). Returns `{rolled_over}`. */
    async close(req: CloseSprintRequest, res: Response, next: NextFunction) {
        try {
            const result = await this.service.close({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
            });

            this.logger.info("sprints.close.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                sprintId: req.params.id,
                rolledOver: result.rolled_over,
            });

            res.status(200).json(result);
        } catch (err) {
            next(err);
        }
    }

    /** POST /api/v1/sprints/:id/tasks — bulk attach tasks (🔐). Returns 204. */
    async addTasks(
        req: AddSprintTasksRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            await this.service.addTasks({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskIds: req.body.task_ids,
            });

            this.logger.info("sprints.tasks.add.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                sprintId: req.params.id,
                count: req.body.task_ids.length,
            });

            res.status(204).end();
        } catch (err) {
            next(err);
        }
    }

    /** DELETE /api/v1/sprints/:id/tasks/:taskId — detach one task (🔐). Returns 204. */
    async removeTask(
        req: RemoveSprintTaskRequest,
        res: Response,
        next: NextFunction,
    ) {
        try {
            await this.service.removeTask({
                id: req.params.id,
                workspaceId: req.auth.workspaceId,
                actorId: req.auth.sub,
                taskId: req.params.taskId,
            });

            this.logger.info("sprints.tasks.remove.ok", {
                requestId: req.requestId,
                workspaceId: req.auth.workspaceId,
                sprintId: req.params.id,
                taskId: req.params.taskId,
            });

            res.status(204).end();
        } catch (err) {
            next(err);
        }
    }
}
