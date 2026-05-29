import express, { NextFunction, Request, Response } from "express";
import { AuthController } from "../controllers/AuthController";
import { UserService } from "../services/UserService";
import { TokenService } from "../services/TokenService";
import { CredentialService } from "../services/CredentialService";
import { getDb } from "../db/client";
import logger from "../config/logger";
import registerValidator from "../validators/register-validator";
import loginValidator from "../validators/login-validator";
import authenticate from "../middlewares/authenticate";
import { AuthRequest } from "../types";
import validateRefreshToken from "../middlewares/validateRefreshToken";
import parseRefreshToken from "../middlewares/parseRefreshToken";
import { validate } from "../middlewares/validate";
import { authStrictLimiter } from "../middlewares/rateLimit";

const router = express.Router();

const db = getDb();
const userService = new UserService(db);
const tokenService = new TokenService(db);
const credentialService = new CredentialService();
const authController = new AuthController(
    userService,
    logger,
    tokenService,
    credentialService,
);

router.post(
    "/register",
    authStrictLimiter,
    registerValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.register(req, res, next),
);

router.post(
    "/login",
    authStrictLimiter,
    loginValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.login(req, res, next),
);

router.get(
    "/me",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.self(req as AuthRequest, res, next),
);

router.post(
    "/refresh",
    validateRefreshToken,
    (req: Request, res: Response, next: NextFunction) =>
        authController.refresh(req as AuthRequest, res, next),
);

router.post(
    "/logout",
    authenticate,
    parseRefreshToken,
    (req: Request, res: Response, next: NextFunction) =>
        authController.logout(req as AuthRequest, res, next),
);

export default router;
