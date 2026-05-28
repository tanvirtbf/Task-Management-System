import { NextFunction, Request, Response } from "express";
import { Logger } from "winston";
import { validationResult } from "express-validator";
import createHttpError from "http-errors";

import { UserService } from "../services/UserService";
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
        const result = validationResult(req);
        if (!result.isEmpty()) {
            return res.status(400).json({ errors: result.array() });
        }

        const { firstName, lastName, email, password, role } = req.body;
        // Inherit workspace from the caller — single-workspace API surface.
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
                return next(createHttpError(500, "User creation failed"));
            }
            res.status(201).json({ id: user.id });
        } catch (err) {
            next(err);
        }
    }

    async update(req: UpdateUserRequest, res: Response, next: NextFunction) {
        const result = validationResult(req);
        if (!result.isEmpty()) {
            return res.status(400).json({ errors: result.array() });
        }

        const { firstName, lastName, role } = req.body;
        const userId = req.params.id;

        if (!userId) {
            return next(createHttpError(400, "User id required"));
        }

        this.logger.debug("Request for updating a user", req.body);

        try {
            await this.userService.update(userId, {
                firstName,
                lastName,
                role,
            });
            this.logger.info("User has been updated", { id: userId });
            res.json({ id: userId });
        } catch (err) {
            next(err);
        }
    }

    async getAll(req: Request, res: Response, next: NextFunction) {
        const authReq = req as unknown as AuthRequest;
        const workspaceId = authReq.auth?.workspaceId;
        if (!workspaceId) {
            return next(createHttpError(401, "Workspace context missing"));
        }
        try {
            const users = await this.userService.listByWorkspace(workspaceId);
            this.logger.info("All users have been fetched", { workspaceId });
            res.json(users);
        } catch (err) {
            next(err);
        }
    }

    async getOne(req: Request, res: Response, next: NextFunction) {
        const userId = req.params.id;

        if (!userId) {
            return next(createHttpError(400, "User id required"));
        }

        try {
            const user = await this.userService.findById(userId);
            if (!user) {
                return next(createHttpError(404, "User does not exist"));
            }
            this.logger.info("User has been fetched", { id: user.id });
            res.json(user);
        } catch (err) {
            next(err);
        }
    }

    async destroy(req: Request, res: Response, next: NextFunction) {
        const userId = req.params.id;

        if (!userId) {
            return next(createHttpError(400, "User id required"));
        }

        try {
            await this.userService.deleteById(userId);
            this.logger.info("User has been deleted", { id: userId });
            res.json({ id: userId });
        } catch (err) {
            next(err);
        }
    }
}
