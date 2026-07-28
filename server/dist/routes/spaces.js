"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const SpacesController_1 = require("../controllers/SpacesController");
const SpacesService_1 = require("../services/SpacesService");
const SpacesRepo_1 = require("../repositories/SpacesRepo");
const ListsRepo_1 = require("../repositories/ListsRepo");
const WorkspaceActivityRepo_1 = require("../repositories/WorkspaceActivityRepo");
const UsersRepo_1 = require("../repositories/UsersRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const ReviewsRepo_1 = require("../repositories/ReviewsRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const ReviewsService_1 = require("../services/ReviewsService");
const ReviewsController_1 = require("../controllers/ReviewsController");
const reviews_1 = require("../validators/reviews");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const spaces_1 = require("../validators/spaces");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const spacesRepo = new SpacesRepo_1.SpacesRepo(db);
const listsRepo = new ListsRepo_1.ListsRepo(db);
const workspaceActivityRepo = new WorkspaceActivityRepo_1.WorkspaceActivityRepo(db);
const usersRepo = new UsersRepo_1.UsersRepo(db);
const spacesService = new SpacesService_1.SpacesService(db, spacesRepo, listsRepo, workspaceActivityRepo, usersRepo, logger_1.default);
const spacesController = new SpacesController_1.SpacesController(spacesService, logger_1.default);
// Dept Review V1 (A-2/A-3) — summary + queue live under /spaces/:id/*.
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const reviewsRepo = new ReviewsRepo_1.ReviewsRepo(db);
const taskActivityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
const reviewsService = new ReviewsService_1.ReviewsService(db, spacesRepo, tasksRepo, reviewsRepo, taskActivityRepo, notificationsRepo, usersRepo, logger_1.default);
const reviewsController = new ReviewsController_1.ReviewsController(reviewsService, logger_1.default);
// ─── GET /api/v1/spaces ────────────────────────────────────────────────────
// Authenticated — any role may list the workspace's spaces (only create /
// archive are owner/admin per Appendix B). Workspace scoping comes from
// `req.auth.workspaceId`, never from client input.
router.get("/", authenticate_1.default, spaces_1.listSpacesValidator, validate_1.validate, (req, res, next) => spacesController.list(req, res, next));
// ─── POST /api/v1/spaces ─────────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the actor come from `req.auth`, never the body.
router.post("/", authenticate_1.default, (0, requirePermission_1.requirePermission)("space.create"), spaces_1.createSpaceValidator, validate_1.validate, (req, res, next) => spacesController.create(req, res, next));
// ─── GET /api/v1/spaces/:id/review-summary ───────────────────────────────────
// Dept Review V1 (A-2). Per-member rollup + task-level totals for the head's
// /dept dashboard. Head-of-space or owner/admin — enforced service-level
// (403 review.not_head; archived space 409; foreign id 404).
router.get("/:id/review-summary", authenticate_1.default, reviews_1.reviewSummaryValidator, validate_1.validate, (req, res, next) => reviewsController.summary(req, res, next));
// ─── GET /api/v1/spaces/:id/review-queue ─────────────────────────────────────
// Dept Review V1 (A-3). One keyset page of a bucket (needs_review | flagged |
// overdue | due_today), optional member filter. Same service-level gate.
router.get("/:id/review-queue", authenticate_1.default, reviews_1.reviewQueueValidator, validate_1.validate, (req, res, next) => reviewsController.queue(req, res, next));
// ─── GET /api/v1/spaces/:id ──────────────────────────────────────────────────
// Authenticated — any role may read a space in their workspace (only create /
// archive are owner/admin per Appendix B). The space is resolved within
// `req.auth.workspaceId`, so a cross-workspace id yields 404 `space.not_found`.
router.get("/:id", authenticate_1.default, spaces_1.getSpaceValidator, validate_1.validate, (req, res, next) => spacesController.getById(req, res, next));
// ─── PATCH /api/v1/spaces/:id ────────────────────────────────────────────────
// 👑 admin/owner only. Chain order encodes the spec's status precedence:
// `authenticate` (401) → `requirePermission` (403) → validation (422). Workspace scope
// and the actor come from `req.auth`, never the body. Body is a partial update;
// an empty body is a no-op that returns the unchanged space.
router.patch("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("space.edit"), spaces_1.updateSpaceValidator, validate_1.validate, (req, res, next) => spacesController.update(req, res, next));
// ─── POST /api/v1/spaces/:id/archive ─────────────────────────────────────────
// 👑 admin/owner only. Soft-deletes the space (sets `archived_at`) and
// cascade-archives its lists. Idempotent (already-archived → 204). No body.
router.post("/:id/archive", authenticate_1.default, (0, requirePermission_1.requirePermission)("space.archive"), spaces_1.spaceIdParamValidator, validate_1.validate, (req, res, next) => spacesController.archive(req, res, next));
// ─── POST /api/v1/spaces/:id/unarchive ───────────────────────────────────────
// 👑 admin/owner only. Reverses #archive — clears `archived_at` on the space
// (does NOT restore the cascade-archived lists). Idempotent (live → 204). No
// body.
router.post("/:id/unarchive", authenticate_1.default, (0, requirePermission_1.requirePermission)("space.archive"), spaces_1.spaceIdParamValidator, validate_1.validate, (req, res, next) => spacesController.unarchive(req, res, next));
// ─── DELETE /api/v1/spaces/:id ───────────────────────────────────────────────
// 🛡️ OWNER only (API_DESIGN.md §5 "Role required: owner only" — supersedes the
// 05-spaces.md table's 👑). Hard delete; requires the space to be archived AND
// hold no lists (else 409 space.not_archived / space.not_empty). No body.
router.delete("/:id", authenticate_1.default, (0, requirePermission_1.requirePermission)("space.delete"), spaces_1.spaceIdParamValidator, validate_1.validate, (req, res, next) => spacesController.remove(req, res, next));
exports.default = router;
