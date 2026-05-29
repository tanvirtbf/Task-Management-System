import express, { NextFunction, Response } from "express";
import { WorkspaceController } from "../controllers/WorkspaceController";
import { WorkspaceService } from "../services/WorkspaceService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { Roles } from "../constants";
import workspaceValidator from "../validators/workspace-validator";
import { validate } from "../middlewares/validate";
import { CreateWorkspaceRequest } from "../types";

const router = express.Router();

const workspaceService = new WorkspaceService(getDb());
const workspaceController = new WorkspaceController(workspaceService, logger);

router.post(
    "/",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    workspaceValidator,
    validate,
    (req: CreateWorkspaceRequest, res: Response, next: NextFunction) =>
        workspaceController.create(req, res, next),
);

router.patch(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    workspaceValidator,
    validate,
    (req: CreateWorkspaceRequest, res: Response, next: NextFunction) =>
        workspaceController.update(req, res, next),
);

router.get("/", authenticate, (req, res, next) =>
    workspaceController.getAll(req, res, next),
);

router.get(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    (req, res, next) => workspaceController.getOne(req, res, next),
);

router.delete(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER]),
    (req, res, next) => workspaceController.destroy(req, res, next),
);

export default router;
