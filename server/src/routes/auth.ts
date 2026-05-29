import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { AuthController } from "../controllers/AuthController";
import { AuthService } from "../services/AuthService";
import { TokenService } from "../services/TokenService";
import { CredentialService } from "../services/CredentialService";
import { UsersRepo } from "../repositories/UsersRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import { authStrictLimiter } from "../middlewares/rateLimit";
import { validate } from "../middlewares/validate";
import { loginValidator } from "../validators/auth";
import type { LoginRequest, RefreshRequest } from "../types/auth";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const usersRepo = new UsersRepo(db);
const tokens = new TokenService(db);
const creds = new CredentialService();
const authService = new AuthService(db, tokens, creds, usersRepo, logger);
const authController = new AuthController(authService, logger);

// ─── POST /api/v1/auth/login ─────────────────────────────────────────────────
router.post(
    "/login",
    authStrictLimiter,
    loginValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        authController.login(req as LoginRequest, res, next),
);

// ─── POST /api/v1/auth/refresh ───────────────────────────────────────────────
// Public — reads the `bb_refresh` cookie. The v1-level `apiLimiter` (600/min
// /IP) already covers it; no per-endpoint validator (the cookie is the input).
router.post(
    "/refresh",
    (req: Request, res: Response, next: NextFunction) =>
        authController.refresh(req as RefreshRequest, res, next),
);

export default router;
