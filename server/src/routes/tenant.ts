import express, { NextFunction, Response } from "express";
import { TenantController } from "../controllers/TenantController";
import { TenantService } from "../services/TenantService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { Roles } from "../constants";
import tenantValidator from "../validators/tenant-validator";
import { CreateTenantRequest } from "../types";

const router = express.Router();

const tenantService = new TenantService(getDb());
const tenantController = new TenantController(tenantService, logger);

router.post(
    "/",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    tenantValidator,
    (req: CreateTenantRequest, res: Response, next: NextFunction) =>
        tenantController.create(req, res, next),
);

router.patch(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    tenantValidator,
    (req: CreateTenantRequest, res: Response, next: NextFunction) =>
        tenantController.update(req, res, next),
);

router.get("/", (req, res, next) => tenantController.getAll(req, res, next));

router.get(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    (req, res, next) => tenantController.getOne(req, res, next),
);

router.delete(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    (req, res, next) => tenantController.destroy(req, res, next),
);

export default router;
