import { NextFunction, Request, Response } from "express";
import { Logger } from "winston";

import { UserService } from "../services/UserService";
import { AppError } from "../errors";
import {
    AuthRequest,
    CreateUserRequest,
    UpdateUserRequest,
} from "../types";

export class UserController {
    constructor(
        private userService: UserService,
        private logger: Logger,
    ) {}

    async create(req: CreateUserRequest, res: Response, next: NextFunction) {
        const { firstName, lastName, email, password, role } = req.body;
        const authReq = req as unknown as AuthRequest;
        const workspaceId = req.body.workspaceId ?? authReq.auth?.workspaceId;

        try {
            const user = await this.userService.create({
                firstName,
                lastName,
                email,
                password,
                role,
                workspaceId,
            });
            if (!user) {
                return next(AppError.internal("User creation failed"));
            }
            res.status(201).json({ id: user.id });
        } catch (err) {
            next(err);
        }
    }

    async update(req: UpdateUserRequest, res: Response, next: NextFunction) {
        const { firstName, lastName, role } = req.body;
        const userId = req.params.id;

        if (!userId) {
            return next(
                AppError.badRequest("user.id_required", "User id required"),
            );
        }

        this.logger.debug("user.update", {
            requestId: req.requestId,
            userId,
        });

        try {
            await this.userService.update(userId, {
                firstName,
                lastName,
                role,
            });
            this.logger.info("user.update.ok", {
                requestId: req.requestId,
                userId,
            });
            res.json({ id: userId });
        } catch (err) {
            next(err);
        }
    }

    async getAll(req: Request, res: Response, next: NextFunction) {
        const authReq = req as unknown as AuthRequest;
        const workspaceId = authReq.auth?.workspaceId;
        if (!workspaceId) {
            return next(
                AppError.unauthorized(
                    "auth.workspace_missing",
                    "Workspace context missing",
                ),
            );
        }
        try {
            const users = await this.userService.listByWorkspace(workspaceId);
            res.json(users);
        } catch (err) {
            next(err);
        }
    }

    async getOne(req: Request, res: Response, next: NextFunction) {
        const userId = req.params.id;
        if (!userId) {
            return next(
                AppError.badRequest("user.id_required", "User id required"),
            );
        }

        try {
            const user = await this.userService.findById(userId);
            if (!user) {
                return next(
                    AppError.notFound("user.not_found", "User does not exist"),
                );
            }
            res.json(user);
        } catch (err) {
            next(err);
        }
    }

    async destroy(req: Request, res: Response, next: NextFunction) {
        const userId = req.params.id;
        if (!userId) {
            return next(
                AppError.badRequest("user.id_required", "User id required"),
            );
        }

        try {
            await this.userService.deleteById(userId);
            this.logger.info("user.delete.ok", {
                requestId: req.requestId,
                userId,
            });
            res.json({ id: userId });
        } catch (err) {
            next(err);
        }
    }
}
