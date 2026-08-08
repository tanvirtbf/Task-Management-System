import { MySql2Database } from "drizzle-orm/mysql2";
import { strictDecodeCursor } from "../utils/pagination";
import * as schema from "../db/schema";
import { AppError } from "../errors";
import {
    toWireNotification,
    toWirePrefs,
    type WireNotification,
    type WireNotificationPrefs,
} from "../serializers/notificationSerializer";
import type {
    NotificationsRepo,
    NotificationRow,
    NotificationCursor,
} from "../repositories/NotificationsRepo";
import type {
    NotificationPrefsRepo,
    PrefUpsert,
} from "../repositories/NotificationPrefsRepo";

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

export interface FeedInput {
    userId: string;
    cursor?: string;
    limit?: number;
}

export interface FeedResult {
    data: WireNotification[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
}

export interface NotificationActionInput {
    userId: string;
    id: string;
}

export interface SnoozeInput extends NotificationActionInput {
    /** Already validated to be an ISO-8601 instant strictly in the future. */
    snoozedUntil: Date;
}

export interface UpdatePreferencesInput {
    userId: string;
    prefs: PrefUpsert[];
}

export class NotificationsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private notifications: NotificationsRepo,
        private prefs: NotificationPrefsRepo,
    ) {}

    /**
     * One unread-first, newest-first page of the user's inbox (§19 #1).
     * Soft-deleted rows are excluded by the repo. Fetches `limit + 1` to derive
     * `has_more` without an extra round-trip; the total count runs concurrently
     * and feeds `total_estimate`.
     */
    async feed(input: FeedInput): Promise<FeedResult> {
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
        const data = page.map(toWireNotification);

        const last = page[page.length - 1];
        const nextCursor =
            hasMore && last
                ? encodeCursor({
                      isRead: last.isRead,
                      internalId: last.internalId.toString(),
                  })
                : null;

        return { data, nextCursor, hasMore, total };
    }

    /** Unread, non-deleted count for the bell badge (§19 #2). */
    async unreadCount(userId: string): Promise<number> {
        return this.notifications.countUnreadForUser(userId);
    }

    /** Mark one notification read (§19 #3). Idempotent — already-read is a no-op. */
    async markRead(input: NotificationActionInput): Promise<WireNotification> {
        const row = await this.loadOwned(input.id, input.userId);
        if (!row.isRead) {
            await this.notifications.update(input.id, { isRead: true });
            row.isRead = true;
        }
        return toWireNotification(row);
    }

    /**
     * Mark one notification unread (§19 #4). Also clears any snooze — explicitly
     * pulling it back into the unread inbox is the inverse of snoozing. Idempotent.
     */
    async markUnread(input: NotificationActionInput): Promise<WireNotification> {
        const row = await this.loadOwned(input.id, input.userId);
        if (row.isRead || row.snoozedUntil !== null) {
            await this.notifications.update(input.id, {
                isRead: false,
                snoozedUntil: null,
            });
            row.isRead = false;
            row.snoozedUntil = null;
        }
        return toWireNotification(row);
    }

    /** Bulk mark every unread notification read (§19 #5). Returns the count flipped. */
    async markAllRead(userId: string): Promise<number> {
        return this.notifications.markAllReadForUser(userId);
    }

    /**
     * Snooze one notification until a future instant (§19 #6). Sets
     * `snoozed_until` AND marks it read, so it leaves the unread badge until the
     * §28 snooze worker flips it back to unread once `snoozed_until` passes.
     */
    async snooze(input: SnoozeInput): Promise<WireNotification> {
        const row = await this.loadOwned(input.id, input.userId);
        await this.notifications.update(input.id, {
            snoozedUntil: input.snoozedUntil,
            isRead: true,
        });
        row.snoozedUntil = input.snoozedUntil;
        row.isRead = true;
        return toWireNotification(row);
    }

    /** Soft-delete one notification (§19 #7) — hides it from the feed and counts. */
    async softDelete(input: NotificationActionInput): Promise<void> {
        await this.loadOwned(input.id, input.userId);
        await this.notifications.update(input.id, { deletedAt: new Date() });
    }

    /**
     * Read the user's per-type delivery preferences (§19 #8). Always returns the
     * full set of notification types; any the user never customised come back at
     * the default (all channels on).
     */
    async getPreferences(userId: string): Promise<WireNotificationPrefs> {
        const stored = await this.prefs.findByUser(userId);
        return toWirePrefs(stored);
    }

    /**
     * Upsert the user's preferences for the supplied types (§19 #9), then return
     * the full, freshly-read preferences map. The upsert runs in one transaction
     * (all-or-nothing across the per-type rows).
     */
    async updatePreferences(
        input: UpdatePreferencesInput,
    ): Promise<WireNotificationPrefs> {
        await this.db.transaction(async (tx) => {
            await this.prefs.upsertMany(input.userId, input.prefs, tx);
        });
        const stored = await this.prefs.findByUser(input.userId);
        return toWirePrefs(stored);
    }

    /**
     * Load a notification by id and assert the caller owns it. Order matters and
     * follows the spec: a missing row is 404 `notification.not_found`; another
     * user's row is 403 `notification.not_owner`; the caller's own soft-deleted
     * row reads as gone (404). IDs are unguessable, so the 403-vs-404 distinction
     * the spec mandates is not a meaningful enumeration oracle.
     */
    private async loadOwned(
        id: string,
        userId: string,
    ): Promise<NotificationRow> {
        const row = await this.notifications.findById(id);
        if (!row) {
            throw AppError.notFound(
                "notification.not_found",
                `Notification ${id} does not exist`,
            );
        }
        if (row.userId !== userId) {
            throw AppError.forbidden(
                "notification.not_owner",
                "You can only modify your own notifications",
            );
        }
        if (row.deletedAt !== null) {
            throw AppError.notFound(
                "notification.not_found",
                `Notification ${id} does not exist`,
            );
        }
        return row;
    }
}

/** Inbox page window: default 50, max 200, min 1 (API_DESIGN.md §1). */
const clampLimit = (raw?: number): number => {
    if (raw === undefined) return DEFAULT_LIMIT;
    if (raw < 1) return 1;
    if (raw > MAX_LIMIT) return MAX_LIMIT;
    return Math.floor(raw);
};

/**
 * Opaque compound cursor over `(is_read, internal_id)` — the feed's sort keyset.
 * Encodes `"<0|1>.<internalId>"` (read flag + monotonic id) as base64url.
 * Mirrors the per-service codec pattern; the codebase has no shared helper yet.
 */
const encodeCursor = (c: NotificationCursor): string =>
    Buffer.from(`${c.isRead ? 1 : 0}.${c.internalId}`, "utf8").toString(
        "base64url",
    );

/**
 * Decode an opaque inbox cursor to its `(is_read, internal_id)` keyset. A
 * malformed cursor is a bad request *parameter* (400 `pagination.invalid_cursor`),
 * not a 422 — the client cannot "fix" an opaque token, only drop it and restart.
 */
const decodeCursor = (cursor: string): NotificationCursor => {
    // F23 (ISS-008): refuse any cursor that does not round-trip byte-exact.
    strictDecodeCursor(cursor);
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = /^([01])\.(\d+)$/.exec(decoded);
    if (!match) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    return { isRead: match[1] === "1", internalId: match[2] };
};
