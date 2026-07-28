"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationStreamRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/**
 * Read-only data access for the §27 SSE stream. Owns ONLY the forward, ascending
 * `internal_id > N` queries the live/resume poll needs — deliberately separate
 * from §19's `NotificationsRepo` (whose feed reads descending / unread-first)
 * so §27 never edits the concurrently-built §19 files. Reuses §19's
 * `NotificationRow` projection so the rows feed `toWireNotification` directly.
 */
/** Same column set as §19's READ_COLUMNS → rows are `NotificationRow`-shaped. */
const STREAM_COLUMNS = {
    id: schema_1.notifications.id,
    internalId: schema_1.notifications.internalId,
    userId: schema_1.notifications.userId,
    type: schema_1.notifications.type,
    entityType: schema_1.notifications.entityType,
    entityId: schema_1.notifications.entityId,
    actorId: schema_1.notifications.actorId,
    title: schema_1.notifications.title,
    body: schema_1.notifications.body,
    isRead: schema_1.notifications.isRead,
    snoozedUntil: schema_1.notifications.snoozedUntil,
    deletedAt: schema_1.notifications.deletedAt,
    createdAt: schema_1.notifications.createdAt,
};
class NotificationStreamRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * The user's highest existing notification `internal_id` (0n if none) — the
     * "go live" cursor for a fresh connect (no Last-Event-Id), so the stream
     * delivers only notifications created AFTER the connection opens, never the
     * historical backlog (the client lazy-loads that via the §19 REST list).
     */
    async maxInternalIdForUser(userId, exec = this.db) {
        const [row] = await exec
            .select({ value: (0, drizzle_orm_1.max)(schema_1.notifications.internalId) })
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.eq)(schema_1.notifications.userId, userId));
        return row?.value != null ? BigInt(row.value) : 0n;
    }
    /**
     * The user's non-deleted notifications with `internal_id` strictly greater
     * than `afterInternalId`, ASCENDING (oldest-missed first) — the unified query
     * that serves BOTH Last-Event-Id resume (the first poll replays the missed
     * backlog) AND the live feed (each subsequent poll picks up new rows). Capped
     * by `limit`; the controller advances its cursor per emitted row, so a backlog
     * larger than `limit` is still delivered across successive polls, never dropped.
     *
     * KNOWN V1 LIMITATION (a consequence of the deferred publish-on-commit, see
     * the class doc): the cursor is an `internal_id` keyset, and InnoDB COMMIT
     * order is not guaranteed to match AUTO_INCREMENT order. If id=101 commits
     * before id=100, a poll can deliver 101 and advance past it, after which 100
     * (committing later) is skipped by the live stream. The notification is NOT
     * lost — it persists and surfaces on the next REST inbox/unread-count fetch
     * (which the bell already polls) — only its real-time push can be missed under
     * concurrent interleaved commits. The EventEmitter/Redis publish-on-commit
     * upgrade removes this class of gap entirely.
     *
     * PERF NOTE: at scale a dedicated INDEX (user_id, internal_id) on
     * `notifications` would make this a tight range scan; today the existing
     * `idx_notifications_user_state (user_id, …)` prefix scopes the scan to the
     * (small) per-user row set, which is adequate for V1. The index is left to the
     * §19 schema owners (this module never edits §19 / the schema).
     */
    async notificationsAfter(userId, afterInternalId, limit, exec = this.db) {
        return exec
            .select(STREAM_COLUMNS)
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.userId, userId), (0, drizzle_orm_1.gt)(schema_1.notifications.internalId, afterInternalId), (0, drizzle_orm_1.isNull)(schema_1.notifications.deletedAt)))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.notifications.internalId))
            .limit(limit);
    }
}
exports.NotificationStreamRepo = NotificationStreamRepo;
