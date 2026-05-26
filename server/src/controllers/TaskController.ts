import { NextFunction, Response } from "express";
import { validationResult } from "express-validator";
import createHttpError from "http-errors";
import { TaskService } from "../services/taskService";
import { AuthRequest } from "../types/authTypes";
import { TaskPriority, TaskStatus } from "../constant";

export class TaskController {
    constructor(private readonly taskService: TaskService) {}

    list = async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.auth?.sub);
            const role = req.auth?.role ?? "member";

            const result = await this.taskService.list({
                userId,
                role,
                page: req.query.page ? Number(req.query.page) : undefined,
                perPage: req.query.perPage ? Number(req.query.perPage) : undefined,
                status: req.query.status as TaskStatus | undefined,
                priority: req.query.priority as TaskPriority | undefined,
                assigneeId: req.query.assigneeId
                    ? Number(req.query.assigneeId)
                    : undefined,
            });

            res.json(result);
        } catch (err) {
            next(err);
        }
    };

    getOne = async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.auth?.sub);
            const role = req.auth?.role ?? "member";
            const id = Number(req.params.id);

            if (Number.isNaN(id)) throw createHttpError(400, "Invalid id");

            const task = await this.taskService.findOne(id, userId, role);
            res.json({ data: task });
        } catch (err) {
            next(err);
        }
    };

    create = async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const userId = Number(req.auth?.sub);
            const task = await this.taskService.create({
                ...req.body,
                creator_id: userId,
            });

            res.status(201).json({ data: task });
        } catch (err) {
            next(err);
        }
    };

    update = async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const userId = Number(req.auth?.sub);
            const role = req.auth?.role ?? "member";
            const id = Number(req.params.id);

            if (Number.isNaN(id)) throw createHttpError(400, "Invalid id");

            const task = await this.taskService.update(id, userId, role, req.body);
            res.json({ data: task });
        } catch (err) {
            next(err);
        }
    };

    remove = async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const userId = Number(req.auth?.sub);
            const role = req.auth?.role ?? "member";
            const id = Number(req.params.id);

            if (Number.isNaN(id)) throw createHttpError(400, "Invalid id");

            await this.taskService.remove(id, userId, role);
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    };
}
