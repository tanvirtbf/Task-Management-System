"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const errors_1 = require("../errors");
const notificationSerializer_1 = require("../serializers/notificationSerializer");
/**
 * §19 Notifications domain logic — the per-user inbox: read feed, unread badge,
 * read/unread/snooze/soft-delete state, and per-type delivery preferences.
 *
 * Every endpoint is user-scoped: the owning user is always the authenticated
 * `userId` (`req.auth.sub`), never client input. By-id mutations load the row
 * first so a non-existent id is 404 `notification.not_found` while another
 * user's id is 403 `notification.not_owner` (the one place §19 distinguishes the
 * two, per the spec). The cursor codec + `clampLimit` are kept local, mirroring
 * `TaskActivityService` (the codebase keeps one copy per paginated service).
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
class NotificationsService {
    db;
    notifications;
    prefs;
    constructor(db, notifications, prefs) {
        this.db = db;
        this.notifications = notifications;
        this.prefs = prefs;
    }
    /**
     * One unread-first, newest-first page of the user's inbox (§19 #1).
     * Soft-deleted rows are excluded by the repo. Fetches `limit + 1` to derive
     * `has_more` without an extra round-trip; the total count runs concurrently
     * and feeds `total_estimate`.
     */
    async feed(input) {
        const limit = clampLimit(input.limit);
        // A malformed cursor throws AppError 400 from `decodeCursor`.
        const after = input.cursor ? decodeCursor(input.cursor) : undefined;
        const [rows, total] = await Promise.all([
            this.notifications.listForUser({
                userId: input.userId,
                after,
                limit: limit + 1,
            }),
            this.notifications.countForUser(input.userId),
        ]);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const data = page.map(notificationSerializer_1.toWireNotification);
        const last = page[page.length - 1];
        const nextCursor = hasMore && last
            ? encodeCursor({
                isRead: last.isRead,
                internalId: last.internalId.toString(),
            })
            : null;
        return { data, nextCursor, hasMore, total };
    }
    /** Unread, non-deleted count for the bell badge (§19 #2). */
    async unreadCount(userId) {
        return this.notifications.countUnreadForUser(userId);
    }
    /** Mark one notification read (§19 #3). Idempotent — already-read is a no-op. */
    async markRead(input) {
        const row = await this.loadOwned(input.id, input.userId);
        if (!row.isRead) {
            await this.notifications.update(input.id, { isRead: true });
            row.isRead = true;
        }
        return (0, notificationSerializer_1.toWireNotification)(row);
    }
    /**
     * Mark one notification unread (§19 #4). Also clears any snooze — explicitly
     * pulling it back into the unread inbox is the inverse of snoozing. Idempotent.
     */
    async markUnread(input) {
        const row = await this.loadOwned(input.id, input.userId);
        if (row.isRead || row.snoozedUntil !== null) {
            await this.notifications.update(input.id, {
                isRead: false,
                snoozedUntil: null,
            });
            row.isRead = false;
            row.snoozedUntil = null;
        }
        return (0, notificationSerializer_1.toWireNotification)(row);
    }
    /** Bulk mark every unread notification read (§19 #5). Returns the count flipped. */
    async markAllRead(userId) {
        return this.notifications.markAllReadForUser(userId);
    }
    /**
     * Snooze one notification until a future instant (§19 #6). Sets
     * `snoozed_until` AND marks it read, so it leaves the unread badge until the
     * §28 snooze worker flips it back to unread once `snoozed_until` passes.
     */
    async snooze(input) {
        const row = await this.loadOwned(input.id, input.userId);
        await this.notifications.update(input.id, {
            snoozedUntil: input.snoozedUntil,
            isRead: true,
        });
        row.snoozedUntil = input.snoozedUntil;
        row.isRead = true;
        return (0, notificationSerializer_1.toWireNotification)(row);
    }
    /** Soft-delete one notification (§19 #7) — hides it from the feed and counts. */
    async softDelete(input) {
        await this.loadOwned(input.id, input.userId);
        await this.notifications.update(input.id, { deletedAt: new Date() });
    }
    /**
     * Read the user's per-type delivery preferences (§19 #8). Always returns the
     * full set of notification types; any the user never customised come back at
     * the default (all channels on).
     */
    async getPreferences(userId) {
        const stored = await this.prefs.findByUser(userId);
        return (0, notificationSerializer_1.toWirePrefs)(stored);
    }
    /**
     * Upsert the user's preferences for the supplied types (§19 #9), then return
     * the full, freshly-read preferences map. The upsert runs in one transaction
     * (all-or-nothing across the per-type rows).
     */
    async updatePreferences(input) {
        await this.db.transaction(async (tx) => {
            await this.prefs.upsertMany(input.userId, input.prefs, tx);
        });
        const stored = await this.prefs.findByUser(input.userId);
        return (0, notificationSerializer_1.toWirePrefs)(stored);
    }
    /**
     * Load a notification by id and assert the caller owns it. Order matters and
     * follows the spec: a missing row is 404 `notification.not_found`; another
     * user's row is 403 `notification.not_owner`; the caller's own soft-deleted
     * row reads as gone (404). IDs are unguessable, so the 403-vs-404 distinction
     * the spec mandates is not a meaningful enumeration oracle.
     */
    async loadOwned(id, userId) {
        const row = await this.notifications.findById(id);
        if (!row) {
            throw errors_1.AppError.notFound("notification.not_found", `Notification ${id} does not exist`);
        }
        if (row.userId !== userId) {
            throw errors_1.AppError.forbidden("notification.not_owner", "You can only modify your own notifications");
        }
        if (row.deletedAt !== null) {
            throw errors_1.AppError.notFound("notification.not_found", `Notification ${id} does not exist`);
        }
        return row;
    }
}
exports.NotificationsService = NotificationsService;
/** Inbox page window: default 50, max 200, min 1 (API_DESIGN.md §1). */
const clampLimit = (raw) => {
    if (raw === undefined)
        return DEFAULT_LIMIT;
    if (raw < 1)
        return 1;
    if (raw > MAX_LIMIT)
        return MAX_LIMIT;
    return Math.floor(raw);
};
/**
 * Opaque compound cursor over `(is_read, internal_id)` — the feed's sort keyset.
 * Encodes `"<0|1>.<internalId>"` (read flag + monotonic id) as base64url.
 * Mirrors the per-service codec pattern; the codebase has no shared helper yet.
 */
const encodeCursor = (c) => Buffer.from(`${c.isRead ? 1 : 0}.${c.internalId}`, "utf8").toString("base64url");
/**
 * Decode an opaque inbox cursor to its `(is_read, internal_id)` keyset. A
 * malformed cursor is a bad request *parameter* (400 `pagination.invalid_cursor`),
 * not a 422 — the client cannot "fix" an opaque token, only drop it and restart.
 */
const decodeCursor = (cursor) => {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = /^([01])\.(\d+)$/.exec(decoded);
    if (!match) {
        throw errors_1.AppError.badRequest("pagination.invalid_cursor", "The pagination cursor is malformed.");
    }
    return { isRead: match[1] === "1", internalId: match[2] };
};
