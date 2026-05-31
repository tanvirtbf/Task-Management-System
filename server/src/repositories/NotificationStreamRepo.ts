import { and, asc, eq, gt, isNull, max } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { notifications } from "../db/schema";
import type { NotificationRow } from "./NotificationsRepo";
import type { DbExecutor } from "./types";

/**
 * Read-only data access for the §27 SSE stream. Owns ONLY the forward, ascending
 * `internal_id > N` queries the live/resume poll needs — deliberately separate
 * from §19's `NotificationsRepo` (whose feed reads descending / unread-first)
 * so §27 never edits the concurrently-built §19 files. Reuses §19's
 * `NotificationRow` projection so the rows feed `toWireNotification` directly.
 */

/** Same column set as §19's READ_COLUMNS → rows are `NotificationRow`-shaped. */
const STREAM_COLUMNS = {
    id: notifications.id,
    internalId: notifications.internalId,
    userId: notifications.userId,
    type: notifications.type,
    entityType: notifications.entityType,
    entityId: notifications.entityId,
    actorId: notifications.actorId,
    title: notifications.title,
    body: notifications.body,
    isRead: notifications.isRead,
    snoozedUntil: notifications.snoozedUntil,
    deletedAt: notifications.deletedAt,
    createdAt: notifications.createdAt,
} as const;

export class NotificationStreamRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * The user's highest existing notification `internal_id` (0n if none) — the
     * "go live" cursor for a fresh connect (no Last-Event-Id), so the stream
     * delivers only notifications created AFTER the connection opens, never the
     * historical backlog (the client lazy-loads that via the §19 REST list).
     */
    async maxInternalIdForUser(
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<bigint> {
        const [row] = await exec
            .select({ value: max(notifications.internalId) })
            .from(notifications)
            .where(eq(notifications.userId, userId));
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
    async notificationsAfter(
        userId: string,
        afterInternalId: bigint,
        limit: number,
        exec: DbExecutor = this.db,
    ): Promise<NotificationRow[]> {
        return exec
            .select(STREAM_COLUMNS)
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    gt(notifications.internalId, afterInternalId),
                    isNull(notifications.deletedAt),
                ),
            )
            .orderBy(asc(notifications.internalId))
            .limit(limit);
    }
}
