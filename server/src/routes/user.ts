import express, { NextFunction, Response } from "express";
import authenticate from "../middlewares/authenticate";
import { canAccess } from "../middlewares/canAccess";
import { Roles } from "../constants";
import { UserController } from "../controllers/UserController";
import { UserService } from "../services/UserService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import createUserValidator from "../validators/create-user-validator";
import updateUserValidator from "../validators/update-user-validator";
import { validate } from "../middlewares/validate";
import { CreateUserRequest, UpdateUserRequest } from "../types";

const router = express.Router();

const userService = new UserService(getDb());
const userController = new UserController(userService, logger);

router.post(
    "/",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    createUserValidator,
    validate,
    (req: CreateUserRequest, res: Response, next: NextFunction) =>
        userController.create(req, res, next),
);

router.patch(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    updateUserValidator,
    validate,
    (req: UpdateUserRequest, res: Response, next: NextFunction) =>
        userController.update(req, res, next),
);

router.get(
    "/",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    (req, res, next) => userController.getAll(req, res, next),
);

router.get(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    (req, res, next) => userController.getOne(req, res, next),
);

router.delete(
    "/:id",
    authenticate,
    canAccess([Roles.OWNER, Roles.ADMIN]),
    (req, res, next) => userController.destroy(req, res, next),
);

export default router;
