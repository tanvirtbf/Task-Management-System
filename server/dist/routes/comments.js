"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const CommentsController_1 = require("../controllers/CommentsController");
const CommentsService_1 = require("../services/CommentsService");
const CommentsRepo_1 = require("../repositories/CommentsRepo");
const TasksRepo_1 = require("../repositories/TasksRepo");
const TaskActivityRepo_1 = require("../repositories/TaskActivityRepo");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const requirePermission_1 = require("../middlewares/requirePermission");
const validate_1 = require("../middlewares/validate");
const comments_1 = require("../validators/comments");
/**
 * §14 Comments router. Declares FULL paths (spanning `/tasks/:id/comments` and
 * `/comments/:id`), so it mounts at the v1 ROOT — and BEFORE the `/tasks` mount,
 * so the 3-segment `/tasks/:id/comments` resolves ahead of the tasks router's
 * `/:id` catch-alls (same pattern as §12 dependencies / §17 custom-fields).
 */
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const db = (0, client_1.getDb)();
const commentsRepo = new CommentsRepo_1.CommentsRepo(db);
const tasksRepo = new TasksRepo_1.TasksRepo(db);
const activityRepo = new TaskActivityRepo_1.TaskActivityRepo(db);
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
const service = new CommentsService_1.CommentsService(db, commentsRepo, tasksRepo, activityRepo, notificationsRepo);
const controller = new CommentsController_1.CommentsController(service, logger_1.default);
// ─── GET /api/v1/tasks/:id/comments ───────────────────────────────────────────
// 🔐 any member. Top-level comments with their replies nested (bare `Comment[]`).
router.get("/tasks/:id/comments", authenticate_1.default, comments_1.listCommentsValidator, validate_1.validate, (req, res, next) => controller.list(req, res, next));
// ─── POST /api/v1/tasks/:id/comments ──────────────────────────────────────────
// 🔐 any member. Adds a comment or a 1-level reply; parses `@handle` mentions
// (→ `mentioned` notifications) and `#TASK-ID` refs (→ cross-task activity). 201.
router.post("/tasks/:id/comments", authenticate_1.default, (0, requirePermission_1.requirePermission)("comment.create"), comments_1.createCommentValidator, validate_1.validate, (req, res, next) => controller.create(req, res, next));
// ─── PATCH /api/v1/comments/:id ───────────────────────────────────────────────
// 🔐 author only, within the 15-minute edit window (else 403). Sets `edited_at`.
router.patch("/comments/:id", authenticate_1.default, comments_1.updateCommentValidator, validate_1.validate, (req, res, next) => controller.update(req, res, next));
// ─── DELETE /api/v1/comments/:id ──────────────────────────────────────────────
// 🔐 author OR 👑 admin/owner. Soft-delete (tombstone preserves thread). 204.
router.delete("/comments/:id", authenticate_1.default, comments_1.commentIdParamValidator, validate_1.validate, (req, res, next) => controller.remove(req, res, next));
exports.default = router;
