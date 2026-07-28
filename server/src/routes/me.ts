import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { MeController } from "../controllers/MeController";
import { getPolicy } from "../rbac/policy";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import type { AuthRequest } from "../types";

const router = express.Router();

const meController = new MeController(getPolicy(), logger);

// ─── GET /api/v1/me/permissions ──────────────────────────────────────────────
// 🔐 any authenticated user. Their resolved permission set + the spaces they
// can see, resolved fresh from the DB (never from the JWT) so a revocation is
// visible on the next call.
router.get(
    "/me/permissions",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        meController.permissions(req as AuthRequest, res, next),
);

export default router;
