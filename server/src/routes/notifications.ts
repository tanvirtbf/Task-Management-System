import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { NotificationsController } from "../controllers/NotificationsController";
import { NotificationsService } from "../services/NotificationsService";
import { NotificationsRepo } from "../repositories/NotificationsRepo";
import { NotificationPrefsRepo } from "../repositories/NotificationPrefsRepo";
import { getDb } from "../db/client";
import logger from "../config/logger";
import authenticate from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import {
    listNotificationsValidator,
    notificationIdValidator,
    snoozeNotificationValidator,
    updatePreferencesValidator,
} from "../validators/notifications";
import type {
    NotificationFeedRequest,
    UnreadCountRequest,
    MarkAllReadRequest,
    NotificationIdRequest,
    SnoozeNotificationRequest,
    GetPreferencesRequest,
    UpdatePreferencesRequest,
} from "../types/notifications";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
// `getDb()` works because `server.ts` calls `initDb()` before this module is
// imported transitively through `app.ts`.
const db = getDb();
const notificationsRepo = new NotificationsRepo(db);
const prefsRepo = new NotificationPrefsRepo(db);
const notificationsService = new NotificationsService(
    db,
    notificationsRepo,
    prefsRepo,
);
const controller = new NotificationsController(notificationsService, logger);

// NOTE on route ordering: the literal-segment routes (`/unread-count`,
// `/mark-all-read`, `/preferences`) are declared BEFORE the `/:id/...` routes.
// They never actually collide (none is a `GET /:id` or `PUT /:id`, and the
// `/:id/...` mutations are all two-segment), but declaring literals first
// matches the convention used by the tasks router and is collision-proof.

// ─── GET /api/v1/notifications ───────────────────────────────────────────────
// Authenticated. The caller's own inbox (`req.auth.sub`), unread-first, cursor-
// paginated. Soft-deleted notifications are excluded.
router.get(
    "/",
    authenticate,
    listNotificationsValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.feed(req as NotificationFeedRequest, res, next),
);

// ─── GET /api/v1/notifications/unread-count ──────────────────────────────────
router.get(
    "/unread-count",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.unreadCount(req as UnreadCountRequest, res, next),
);

// ─── POST /api/v1/notifications/mark-all-read ────────────────────────────────
router.post(
    "/mark-all-read",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.markAllRead(req as MarkAllReadRequest, res, next),
);

// ─── GET /api/v1/notifications/preferences ───────────────────────────────────
router.get(
    "/preferences",
    authenticate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.getPreferences(req as GetPreferencesRequest, res, next),
);

// ─── PUT /api/v1/notifications/preferences ───────────────────────────────────
router.put(
    "/preferences",
    authenticate,
    updatePreferencesValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.updatePreferences(
            req as UpdatePreferencesRequest,
            res,
            next,
        ),
);

// ─── POST /api/v1/notifications/:id/read ─────────────────────────────────────
router.post(
    "/:id/read",
    authenticate,
    notificationIdValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.markRead(req as NotificationIdRequest, res, next),
);

// ─── POST /api/v1/notifications/:id/unread ───────────────────────────────────
router.post(
    "/:id/unread",
    authenticate,
    notificationIdValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.markUnread(req as NotificationIdRequest, res, next),
);

// ─── POST /api/v1/notifications/:id/snooze ───────────────────────────────────
router.post(
    "/:id/snooze",
    authenticate,
    snoozeNotificationValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.snooze(req as SnoozeNotificationRequest, res, next),
);

// ─── DELETE /api/v1/notifications/:id ────────────────────────────────────────
router.delete(
    "/:id",
    authenticate,
    notificationIdValidator,
    validate,
    (req: Request, res: Response, next: NextFunction) =>
        controller.remove(req as NotificationIdRequest, res, next),
);

export default router;
