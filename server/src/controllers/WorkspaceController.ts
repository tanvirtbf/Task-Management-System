import { NextFunction, Request, Response } from "express";
import { Logger } from "winston";
import { validationResult } from "express-validator";
import createHttpError from "http-errors";

import { WorkspaceService } from "../services/WorkspaceService";
import { CreateWorkspaceRequest } from "../types";

export class WorkspaceController {
    constructor(
        private workspaceService: WorkspaceService,
        private logger: Logger,
    ) {}

    async create(
        req: CreateWorkspaceRequest,
        res: Response,
        next: NextFunction,
    ) {
        const result = validationResult(req);
        if (!result.isEmpty()) {
            return res.status(400).json({ errors: result.array() });
        }

        const { name, logoUrl, timezone, defaultLocale } = req.body;
        this.logger.debug("Request for creating a workspace", { name });

        try {
            const workspace = await this.workspaceService.create({
                name,
                logoUrl,
                timezone,
                defaultLocale,
            });
            if (!workspace) {
                return next(createHttpError(500, "Workspace creation failed"));
            }
            this.logger.info("Workspace has been created", { id: workspace.id });
            res.status(201).json({ id: workspace.id });
        } catch (err) {
            next(err);
        }
    }

    async update(
        req: CreateWorkspaceRequest,
        res: Response,
        next: NextFunction,
    ) {
        const result = validationResult(req);
        if (!result.isEmpty()) {
            return res.status(400).json({ errors: result.array() });
        }

        const { id } = req.params;
        if (!id) {
            return next(createHttpError(400, "Workspace id required"));
        }

        try {
            await this.workspaceService.update(id, req.body);
            this.logger.info("Workspace has been updated", { id });
            res.json({ id });
        } catch (err) {
            next(err);
        }
    }

    async getAll(_req: Request, res: Response, next: NextFunction) {
        try {
            const workspaces = await this.workspaceService.getAll();
            res.json(workspaces);
        } catch (err) {
            next(err);
        }
    }

    async getOne(req: Request, res: Response, next: NextFunction) {
        const { id } = req.params;
        if (!id) {
            return next(createHttpError(400, "Workspace id required"));
        }

        try {
            const workspace = await this.workspaceService.getById(id);
            if (!workspace) {
                return next(createHttpError(404, "Workspace does not exist"));
            }
            res.json(workspace);
        } catch (err) {
            next(err);
        }
    }

    async destroy(req: Request, res: Response, next: NextFunction) {
        const { id } = req.params;
        if (!id) {
            return next(createHttpError(400, "Workspace id required"));
        }

        try {
            await this.workspaceService.deleteById(id);
            this.logger.info("Workspace has been deleted", { id });
            res.json({ id });
        } catch (err) {
            next(err);
        }
    }
}
