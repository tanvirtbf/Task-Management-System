"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const NotificationsController_1 = require("../controllers/NotificationsController");
const NotificationsService_1 = require("../services/NotificationsService");
const NotificationsRepo_1 = require("../repositories/NotificationsRepo");
const NotificationPrefsRepo_1 = require("../repositories/NotificationPrefsRepo");
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const authenticate_1 = __importDefault(require("../middlewares/authenticate"));
const validate_1 = require("../middlewares/validate");
const notifications_1 = require("../validators/notifications");
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = (0, client_1.getDb)();
const notificationsRepo = new NotificationsRepo_1.NotificationsRepo(db);
const prefsRepo = new NotificationPrefsRepo_1.NotificationPrefsRepo(db);
const notificationsService = new NotificationsService_1.NotificationsService(db, notificationsRepo, prefsRepo);
const controller = new NotificationsController_1.NotificationsController(notificationsService, logger_1.default);
// NOTE on route ordering: the literal-segment routes (`/unread-count`,
// `/mark-all-read`, `/preferences`) are declared BEFORE the `/:id/...` routes.
// They never actually collide (none is a `GET /:id` or `PUT /:id`, and the
// `/:id/...` mutations are all two-segment), but declaring literals first
// matches the convention used by the tasks router and is collision-proof.
// ─── GET /api/v1/notifications ───────────────────────────────────────────────
// Authenticated. The caller's own inbox (`req.auth.sub`), unread-first, cursor-
// paginated. Soft-deleted notifications are excluded.
router.get("/", authenticate_1.default, notifications_1.listNotificationsValidator, validate_1.validate, (req, res, next) => controller.feed(req, res, next));
// ─── GET /api/v1/notifications/unread-count ──────────────────────────────────
router.get("/unread-count", authenticate_1.default, (req, res, next) => controller.unreadCount(req, res, next));
// ─── POST /api/v1/notifications/mark-all-read ────────────────────────────────
router.post("/mark-all-read", authenticate_1.default, (req, res, next) => controller.markAllRead(req, res, next));
// ─── GET /api/v1/notifications/preferences ───────────────────────────────────
router.get("/preferences", authenticate_1.default, (req, res, next) => controller.getPreferences(req, res, next));
// ─── PUT /api/v1/notifications/preferences ───────────────────────────────────
router.put("/preferences", authenticate_1.default, notifications_1.updatePreferencesValidator, validate_1.validate, (req, res, next) => controller.updatePreferences(req, res, next));
// ─── POST /api/v1/notifications/:id/read ─────────────────────────────────────
router.post("/:id/read", authenticate_1.default, notifications_1.notificationIdValidator, validate_1.validate, (req, res, next) => controller.markRead(req, res, next));
// ─── POST /api/v1/notifications/:id/unread ───────────────────────────────────
router.post("/:id/unread", authenticate_1.default, notifications_1.notificationIdValidator, validate_1.validate, (req, res, next) => controller.markUnread(req, res, next));
// ─── POST /api/v1/notifications/:id/snooze ───────────────────────────────────
router.post("/:id/snooze", authenticate_1.default, notifications_1.snoozeNotificationValidator, validate_1.validate, (req, res, next) => controller.snooze(req, res, next));
// ─── DELETE /api/v1/notifications/:id ────────────────────────────────────────
router.delete("/:id", authenticate_1.default, notifications_1.notificationIdValidator, validate_1.validate, (req, res, next) => controller.remove(req, res, next));
exports.default = router;
