import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { WorkspaceActivityController } from "../controllers/WorkspaceActivityController";
import { WorkspaceActivityService } from "../services/WorkspaceActivityService";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import {
    recentActivityValidator,
    activityFeedValidator,
} from "../validators/workspaceActivity";
import type {
    RecentActivityRequest,
    ActivityFeedRequest,
} from "../types/workspaceActivity";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const activityRepo = new WorkspaceActivityRepo(db);
const usersRepo = new UsersRepo(db);
const service = new WorkspaceActivityService(activityRepo, usersRepo);
const controller = new WorkspaceActivityController(service, logger);

// Mounted at the `/activity` prefix. `/recent` (literal) is declared before the
// `/` feed for clarity; the two never collide (distinct paths).

// ─── GET /api/v1/activity/recent ─────────────────────────────────────────────
// Authenticated — any workspace member may read the workspace's activity feed
// (no role gate per the spec). Workspace scope comes from `req.auth.workspaceId`.
router.get(
    "/recent",
    authenticate,
    recentActivityValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.recent(req as RecentActivityRequest, res, next),
);

// ─── GET /api/v1/activity ────────────────────────────────────────────────────
router.get(
    "/",
    authenticate,
    activityFeedValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.feed(req as ActivityFeedRequest, res, next),
);

export default router;
