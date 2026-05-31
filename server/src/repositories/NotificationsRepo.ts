import {
    and,
    asc,
    count,
    desc,
    eq,
    gt,
    isNotNull,
    isNull,
    lt,
    lte,
    or,
} from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { notifications } from "../db/schema";
import type { Notification } from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for the per-user inbox (`notifications`, §19).
 *
 * Two roles:
 *   - WRITE-side fanout (`createMany`) used by other endpoints (assigning a
 *     task, a form submission, …) to append rows in the same transaction as the
 *     change that triggered them.
 *   - READ + state-management for §19 itself (feed page, counts, mark
 *     read/unread, snooze, soft-delete). Every read filters `deleted_at IS NULL`
 *     — a soft-deleted row is invisible to the feed, the counts, and by-id
 *     reads, exactly like a hard delete from the user's perspective.
 *
 * All §19 methods are addressed by the notification's own primary key; the
 * OWNERSHIP check (`user_id === req.auth.sub`) lives in the service so it can
 * distinguish 404 (no such row) from 403 (someone else's row) per the spec.
 */

export interface NewNotification {
    userId: string;
    type: Notification["type"];
    entityType: Notification["entityType"];
    entityId: string;
    actorId: string | null;
    title: string;
    body?: string | null;
}

/**
 * Full read projection of one `notifications` row for §19. `internalId` is the
 * monotonic keyset / cursor value; `email_sent_at` is intentionally omitted —
 * it is delivery bookkeeping, never part of the §19 wire shape.
 */
export interface NotificationRow {
    id: string;
    internalId: bigint;
    userId: string;
    type: Notification["type"];
    entityType: Notification["entityType"];
    entityId: string;
    actorId: string | null;
    title: string;
    body: string | null;
    isRead: boolean;
    snoozedUntil: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
}

/** The columns every §19 read returns — shared by the feed page and by-id read. */
const READ_COLUMNS = {
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

/** Keyset cursor position: a notification's `(is_read, internal_id)` pair. */
export interface NotificationCursor {
    isRead: boolean;
    internalId: string;
}

export interface FeedParams {
    userId: string;
    /** Keyset position of the last row of the previous page (absent on page 1). */
    after?: NotificationCursor;
}

/** Whitelisted state fields a §19 mutation may set on a single notification. */
export interface NotificationPatch {
    isRead?: boolean;
    snoozedUntil?: Date | null;
    deletedAt?: Date | null;
}

export class NotificationsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Insert one or more notification rows (write-side fanout). */
    async createMany(
        rows: NewNotification[],
        exec: DbExecutor = this.db,
    ): Promise<void> {
        if (rows.length === 0) return;
        await exec.insert(notifications).values(
            rows.map((r) => ({
                id: fakeId("ntf"),
                userId: r.userId,
                type: r.type,
                entityType: r.entityType,
                entityId: r.entityId,
                actorId: r.actorId,
                title: r.title,
                body: r.body ?? null,
            })),
        );
    }

    /**
     * One page of a user's inbox, ordered UNREAD-FIRST then newest-first
     * (`is_read ASC, internal_id DESC`). Soft-deleted rows are excluded. The
     * caller passes `limit + 1` and uses the extra row to derive `has_more`.
     *
     * The keyset predicate after a cursor `(r, i)` selects every row that comes
     * later in that ordering: `is_read > r OR (is_read = r AND internal_id < i)`
     * — i.e. the rest of the same read-group (older ids) plus the whole read
     * group that sorts after it. `internal_id` (monotonic) is the stable
     * tie-break; `created_at` is only second-granular.
     */
    async listForUser(
        params: FeedParams & { limit: number },
    ): Promise<NotificationRow[]> {
        return this.db
            .select(READ_COLUMNS)
            .from(notifications)
            .where(this.feedWhere(params))
            .orderBy(asc(notifications.isRead), desc(notifications.internalId))
            .limit(params.limit);
    }

    /** Total non-deleted notifications for the user — feeds `total_estimate`. */
    async countForUser(userId: string): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    isNull(notifications.deletedAt),
                ),
            );
        return row?.value ?? 0;
    }

    /** Unread, non-deleted notifications for the user (the bell badge, §19 #2). */
    async countUnreadForUser(userId: string): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.isRead, false),
                    isNull(notifications.deletedAt),
                ),
            );
        return row?.value ?? 0;
    }

    /**
     * Look up a single notification by primary key, REGARDLESS of owner. The
     * service compares `row.userId` to `req.auth.sub` so it can return 404 for a
     * non-existent id and 403 `notification.not_owner` for someone else's — the
     * one place §19 deliberately distinguishes the two (per the spec). A
     * soft-deleted row is still returned here; the service maps `deletedAt` to a
     * 404 so a tombstone reads as "gone".
     */
    async findById(id: string): Promise<NotificationRow | null> {
        const [row] = await this.db
            .select(READ_COLUMNS)
            .from(notifications)
            .where(eq(notifications.id, id))
            .limit(1);
        return row ?? null;
    }

    /**
     * Patch a single notification's state by primary key with a whitelisted
     * field set (never a spread of client input). Used for mark read/unread,
     * snooze, and soft-delete. Takes an optional `exec` for transactional use.
     */
    async update(
        id: string,
        patch: NotificationPatch,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.update(notifications).set(patch).where(eq(notifications.id, id));
    }

    /**
     * Bulk mark every unread, non-deleted notification of the user as read
     * (§19 #5). Returns the number of rows flipped (the count the client sees).
     */
    async markAllReadForUser(
        userId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const result = await exec
            .update(notifications)
            .set({ isRead: true })
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.isRead, false),
                    isNull(notifications.deletedAt),
                ),
            );
        return result[0].affectedRows;
    }

    /**
     * §28 #6 snooze-wake: flip every notification whose snooze has elapsed back
     * to unread — `is_read=false, snoozed_until=NULL` WHERE `snoozed_until IS NOT
     * NULL AND snoozed_until <= NOW() AND deleted_at IS NULL`. One conditional
     * UPDATE, inherently idempotent: after waking, `snoozed_until` is NULL so the
     * rows no longer match — a re-run in the same window flips 0 (no
     * double-delivery). Returns the affected-row count.
     */
    async wakeSnoozed(
        now: Date = new Date(),
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const result = await exec
            .update(notifications)
            .set({ isRead: false, snoozedUntil: null })
            .where(
                and(
                    isNotNull(notifications.snoozedUntil),
                    lte(notifications.snoozedUntil, now),
                    isNull(notifications.deletedAt),
                ),
            );
        return result[0].affectedRows;
    }

    /**
     * Count notifications currently due to wake — dry-run companion to
     * `wakeSnoozed`. `now` is passed as a bound parameter (not SQL `NOW()`) so it
     * goes through the same mysql2 timezone conversion as the stored
     * `snoozed_until`, keeping the comparison consistent.
     */
    async countSnoozedDue(
        now: Date = new Date(),
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({ value: count() })
            .from(notifications)
            .where(
                and(
                    isNotNull(notifications.snoozedUntil),
                    lte(notifications.snoozedUntil, now),
                    isNull(notifications.deletedAt),
                ),
            );
        return row?.value ?? 0;
    }

    /**
     * Shared WHERE for the feed page. `user_id` and the soft-delete filter are
     * always present; the keyset cursor is appended only when supplied (Drizzle's
     * `and()` drops `undefined` entries).
     */
    private feedWhere(params: FeedParams) {
        const after = params.after;
        return and(
            eq(notifications.userId, params.userId),
            isNull(notifications.deletedAt),
            after
                ? or(
                      gt(notifications.isRead, after.isRead),
                      and(
                          eq(notifications.isRead, after.isRead),
                          lt(
                              notifications.internalId,
                              BigInt(after.internalId),
                          ),
                      ),
                  )
                : undefined,
        );
    }
}
