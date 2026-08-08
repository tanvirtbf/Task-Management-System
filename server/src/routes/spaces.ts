import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { allowQuery } from "../middlewares/allowQuery";
import { SpacesController } from "../controllers/SpacesController";
import { SpacesService } from "../services/SpacesService";
import { SpacesRepo } from "../repositories/SpacesRepo";
import { ListsRepo } from "../repositories/ListsRepo";
import { WorkspaceActivityRepo } from "../repositories/WorkspaceActivityRepo";
import { UsersRepo } from "../repositories/UsersRepo";
import { TasksRepo } from "../repositories/TasksRepo";
import { ReviewsRepo } from "../repositories/ReviewsRepo";
import { TaskActivityRepo } from "../repositories/TaskActivityRepo";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { ReviewsService } from "../services/ReviewsService";
import { ReviewsController } from "../controllers/ReviewsController";
import {
    reviewQueueValidator,
    reviewSummaryValidator,
} from "../validators/reviews";
import type {
    ReviewQueueRequest,
    ReviewSummaryRequest,
} from "../types/reviews";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { requirePermission } from "../middlewares/requirePermission";
import { validate } from "../middlewares/validate";
import {
    createSpaceValidator,
    getSpaceValidator,
    listSpacesValidator,
    spaceIdParamValidator,
    updateSpaceValidator,
} from "../validators/spaces";
import type {
    CreateSpaceRequest,
    GetSpaceRequest,
    ListSpacesRequest,
    SpaceIdRequest,
    UpdateSpaceRequest,
} from "../types/spaces";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const spacesRepo = new SpacesRepo(db);
const listsRepo = new ListsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo(db);
const usersRepo = new UsersRepo(db);
const spacesService = new SpacesService(
    db,
    spacesRepo,
    listsRepo,
    workspaceActivityRepo,
    usersRepo,
    logger,
);
const spacesController = new SpacesController(spacesService, logger);
// Dept Review V1 (A-2/A-3) — summary + queue live under /spaces/:id/*.
const tasksRepo = new TasksRepo(db);
const reviewsRepo = new ReviewsRepo(db);
const taskActivityRepo = new TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo(db);
const reviewsService = new ReviewsService(
    db,
    spacesRepo,
    tasksRepo,
    reviewsRepo,
    taskActivityRepo,
    notificationsRepo,
    usersRepo,
    logger,
);
const reviewsController = new ReviewsController(reviewsService, logger);

// ─── GET /api/v1/spaces ────────────────────────────────────────────────────
// Authenticated — any role may list the workspace's spaces (only create /
// archive are owner/admin per Appendix B). Workspace scoping comes from
// `req.auth.workspaceId`, never from client input.
router.get(
    "/",
    authenticate,
    // F23 (ISS-014): a mistyped filter is a 422, not the full set.
    allowQuery(["include_archived","limit","cursor"]),
    listSpacesValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.list(req as ListSpacesRequest, res, next),
);

// ─── POST /api/v1/spaces ─────────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the actor come from `req.auth`, never the body.
router.post(
    "/",
    authenticate,
    requirePermission("space.create"),
    createSpaceValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.create(req as CreateSpaceRequest, res, next),
);

// ─── GET /api/v1/spaces/:id/review-summary ───────────────────────────────────
// Dept Review V1 (A-2). Per-member rollup + task-level totals for the head's
// /dept dashboard. Head-of-space or owner/admin — enforced service-level
// (403 review.not_head; archived space 409; foreign id 404).
router.get(
    "/:id/review-summary",
    authenticate,
    reviewSummaryValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        reviewsController.summary(req as ReviewSummaryRequest, res, next),
);

// ─── GET /api/v1/spaces/:id/review-queue ─────────────────────────────────────
// Dept Review V1 (A-3). One keyset page of a bucket (needs_review | flagged |
// overdue | due_today), optional member filter. Same service-level gate.
router.get(
    "/:id/review-queue",
    authenticate,
    reviewQueueValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        reviewsController.queue(req as ReviewQueueRequest, res, next),
);

// ─── GET /api/v1/spaces/:id ──────────────────────────────────────────────────
// Authenticated — any role may read a space in their workspace (only create /
// archive are owner/admin per Appendix B). The space is resolved within
// `req.auth.workspaceId`, so a cross-workspace id yields 404 `space.not_found`.
router.get(
    "/:id",
    authenticate,
    getSpaceValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.getById(req as GetSpaceRequest, res, next),
);

// ─── PATCH /api/v1/spaces/:id ────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the actor come from `req.auth`, never the body. Body is a partial update;
// an empty body is a no-op that returns the unchanged space.
router.patch(
    "/:id",
    authenticate,
    requirePermission("space.edit"),
    updateSpaceValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.update(req as UpdateSpaceRequest, res, next),
);

// ─── POST /api/v1/spaces/:id/archive ─────────────────────────────────────────
// 👑 admin/owner only. Soft-deletes the space (sets `archived_at`) and
// cascade-archives its lists. Idempotent (already-archived → 204). No body.
router.post(
    "/:id/archive",
    authenticate,
    requirePermission("space.archive"),
    spaceIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.archive(req as SpaceIdRequest, res, next),
);

// ─── POST /api/v1/spaces/:id/unarchive ───────────────────────────────────────
// 👑 admin/owner only. Reverses #archive — clears `archived_at` on the space
// (does NOT restore the cascade-archived lists). Idempotent (live → 204). No
// body.
router.post(
    "/:id/unarchive",
    authenticate,
    requirePermission("space.archive"),
    spaceIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.unarchive(req as SpaceIdRequest, res, next),
);

// ─── DELETE /api/v1/spaces/:id ───────────────────────────────────────────────
// 🛡️ OWNER only (API_DESIGN.md §5 "Role required: owner only" — supersedes the
// 05-spaces.md table's 👑). Hard delete; requires the space to be archived AND
// hold no lists (else 409 space.not_archived / space.not_empty). No body.
router.delete(
    "/:id",
    authenticate,
    requirePermission("space.delete"),
    spaceIdParamValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        spacesController.remove(req as SpaceIdRequest, res, next),
);

export default router;
