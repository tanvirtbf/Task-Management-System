"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsController = void 0;
const express_validator_1 = require("express-validator");
class NotificationsController {
    service;
    logger;
    constructor(service, logger) {
        this.service = service;
        this.logger = logger;
    }
    /**
     * GET /api/v1/notifications — one unread-first, newest-first, cursor-
     * paginated page of the caller's inbox (soft-deleted rows excluded).
     */
    async feed(req, res, next) {
        try {
            const { cursor, limit } = (0, express_validator_1.matchedData)(req, {
                locations: ["query"],
            });
            const result = await this.service.feed({
                userId: req.auth.sub,
                cursor,
                limit,
            });
            this.logger.debug("notifications.feed.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
                count: result.data.length,
            });
            res.status(200).json({
                data: result.data,
                pagination: {
                    next_cursor: result.nextCursor,
                    has_more: result.hasMore,
                    total_estimate: result.total,
                },
            });
        }
        catch (err) {
            next(err);
        }
    }
    /** GET /api/v1/notifications/unread-count — the bell badge number. */
    async unreadCount(req, res, next) {
        try {
            const count = await this.service.unreadCount(req.auth.sub);
            res.status(200).json({ unread_count: count });
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/notifications/:id/read — mark one read (idempotent). */
    async markRead(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, {
                locations: ["params"],
            });
            const notification = await this.service.markRead({
                userId: req.auth.sub,
                id,
            });
            this.logger.debug("notifications.read.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
                notificationId: id,
            });
            res.status(200).json(notification);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/notifications/:id/unread — mark one unread (clears snooze). */
    async markUnread(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, {
                locations: ["params"],
            });
            const notification = await this.service.markUnread({
                userId: req.auth.sub,
                id,
            });
            res.status(200).json(notification);
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/notifications/mark-all-read — bulk mark every unread → read. */
    async markAllRead(req, res, next) {
        try {
            const markedRead = await this.service.markAllRead(req.auth.sub);
            this.logger.info("notifications.mark_all_read.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
                markedRead,
            });
            res.status(200).json({ marked_read: markedRead });
        }
        catch (err) {
            next(err);
        }
    }
    /** POST /api/v1/notifications/:id/snooze — snooze until a future instant. */
    async snooze(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, {
                locations: ["params"],
            });
            const { snoozed_until } = (0, express_validator_1.matchedData)(req, { locations: ["body"] });
            const notification = await this.service.snooze({
                userId: req.auth.sub,
                id,
                snoozedUntil: new Date(snoozed_until),
            });
            this.logger.debug("notifications.snooze.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
                notificationId: id,
            });
            res.status(200).json(notification);
        }
        catch (err) {
            next(err);
        }
    }
    /** DELETE /api/v1/notifications/:id — soft-delete one notification. */
    async remove(req, res, next) {
        try {
            const { id } = (0, express_validator_1.matchedData)(req, {
                locations: ["params"],
            });
            await this.service.softDelete({ userId: req.auth.sub, id });
            this.logger.info("notifications.delete.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
                notificationId: id,
            });
            res.sendStatus(204);
        }
        catch (err) {
            next(err);
        }
    }
    /** GET /api/v1/notifications/preferences — the caller's per-type prefs. */
    async getPreferences(req, res, next) {
        try {
            const prefs = await this.service.getPreferences(req.auth.sub);
            res.status(200).json(prefs);
        }
        catch (err) {
            next(err);
        }
    }
    /**
     * PUT /api/v1/notifications/preferences — upsert per-type prefs.
     *
     * The validator (`updatePreferencesValidator`) guarantees the body is a map
     * of known notification type → `{ in_app_enabled }` (F19/D8: the email
     * channel was removed — it promised delivery with no implementation),
     * so the body is read directly (it has no per-field `matchedData` whitelist)
     * and normalised into the repo's upsert shape. Returns the full, freshly-read
     * preferences map.
     */
    async updatePreferences(req, res, next) {
        try {
            const body = req.body;
            const prefs = Object.entries(body).map(([type, pref]) => ({
                type: type,
                inAppEnabled: pref.in_app_enabled,
            }));
            const updated = await this.service.updatePreferences({
                userId: req.auth.sub,
                prefs,
            });
            this.logger.info("notifications.preferences.update.ok", {
                requestId: req.requestId,
                userId: req.auth.sub,
                types: prefs.map((p) => p.type),
            });
            res.status(200).json(updated);
        }
        catch (err) {
            next(err);
        }
    }
}
exports.NotificationsController = NotificationsController;
