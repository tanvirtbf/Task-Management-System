import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { CommentsController } from "../controllers/CommentsController";
import { CommentsService } from "../services/CommentsService";
import { CommentsRepo } from "../repositories/CommentsRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import {
    commentIdParamValidator,
    createCommentValidator,
    listCommentsValidator,
    updateCommentValidator,
} from "../validators/comments";
import type { AuthRequest } from "../types";
import type {
    CreateCommentRequest,
    UpdateCommentRequest,
} from "../types/comments";

/**
 * §14 Comments router. Declares FULL paths (spanning `/tasks/:id/comments` and
 * `/comments/:id`), so it mounts at the v1 ROOT — and BEFORE the `/tasks` mount,
 * so the 3-segment `/tasks/:id/comments` resolves ahead of the tasks router's
 * `/:id` catch-alls (same pattern as §12 dependencies / §17 custom-fields).
 */
const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = getDb();
const commentsRepo = new CommentsRepo(db);
const tasksRepo = new TasksRepo(db);
const activityRepo = new TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo(db);
const service = new CommentsService(
    db,
    commentsRepo,
    tasksRepo,
    activityRepo,
    notificationsRepo,
);
const controller = new CommentsController(service, logger);

// ─── GET /api/v1/tasks/:id/comments ───────────────────────────────────────────
// 🔐 any member. Top-level comments with their replies nested (bare `Comment[]`).
router.get(
    "/tasks/:id/comments",
    authenticate,
    listCommentsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.list(req as AuthRequest, res, next),
);

// ─── POST /api/v1/tasks/:id/comments ──────────────────────────────────────────
// 🔐 any member. Adds a comment or a 1-level reply; parses `@handle` mentions
// (→ `mentioned` notifications) and `#TASK-ID` refs (→ cross-task activity). 201.
router.post(
    "/tasks/:id/comments",
    authenticate,
    createCommentValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.create(req as CreateCommentRequest, res, next),
);

// ─── PATCH /api/v1/comments/:id ───────────────────────────────────────────────
// 🔐 author only, within the 15-minute edit window (else 403). Sets `edited_at`.
router.patch(
    "/comments/:id",
    authenticate,
    updateCommentValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.update(req as UpdateCommentRequest, res, next),
);

// ─── DELETE /api/v1/comments/:id ──────────────────────────────────────────────
// 🔐 author OR 👑 admin/owner. Soft-delete (tombstone preserves thread). 204.
router.delete(
    "/comments/:id",
    authenticate,
    commentIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.remove(req as AuthRequest, res, next),
);

export default router;
