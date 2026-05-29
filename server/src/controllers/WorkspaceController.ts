import { NextFunction, Request, Response } from "express";
import { Logger } from "winston";

import { WorkspaceService } from "../services/WorkspaceService";
import { AppError } from "../errors";
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
        const { name, logoUrl, timezone, defaultLocale } = req.body;
        this.logger.debug("workspace.create", {
            requestId: req.requestId,
            name,
        });

        try {
            const workspace = await this.workspaceService.create({
                name,
                logoUrl,
                timezone,
                defaultLocale,
            });
            if (!workspace) {
                return next(AppError.internal("Workspace creation failed"));
            }
            this.logger.info("workspace.create.ok", {
                requestId: req.requestId,
                workspaceId: workspace.id,
            });
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
        const { id } = req.params;
        if (!id) {
            return next(
                AppError.badRequest(
                    "workspace.id_required",
                    "Workspace id required",
                ),
            );
        }

        try {
            await this.workspaceService.update(id, req.body);
            this.logger.info("workspace.update.ok", {
                requestId: req.requestId,
                workspaceId: id,
            });
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
            return next(
                AppError.badRequest(
                    "workspace.id_required",
                    "Workspace id required",
                ),
            );
        }

        try {
            const workspace = await this.workspaceService.getById(id);
            if (!workspace) {
                return next(
                    AppError.notFound(
                        "workspace.not_found",
                        "Workspace does not exist",
                    ),
                );
            }
            res.json(workspace);
        } catch (err) {
            next(err);
        }
    }

    async destroy(req: Request, res: Response, next: NextFunction) {
        const { id } = req.params;
        if (!id) {
            return next(
                AppError.badRequest(
                    "workspace.id_required",
                    "Workspace id required",
                ),
            );
        }

        try {
            await this.workspaceService.deleteById(id);
            this.logger.info("workspace.delete.ok", {
                requestId: req.requestId,
                workspaceId: id,
            });
            res.json({ id });
        } catch (err) {
            next(err);
        }
    }
}
