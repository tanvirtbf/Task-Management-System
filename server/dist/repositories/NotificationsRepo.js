"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
/** The columns every §19 read returns — shared by the feed page and by-id read. */
const READ_COLUMNS = {
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
class NotificationsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Insert one or more notification rows (write-side fanout). */
    async createMany(rows, exec = this.db) {
        if (rows.length === 0)
            return;
        await exec.insert(schema_1.notifications).values(rows.map((r) => ({
            id: (0, utils_1.fakeId)("ntf"),
            userId: r.userId,
            type: r.type,
            entityType: r.entityType,
            entityId: r.entityId,
            actorId: r.actorId,
            title: r.title,
            body: r.body ?? null,
        })));
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
    async listForUser(params) {
        return this.db
            .select(READ_COLUMNS)
            .from(schema_1.notifications)
            .where(this.feedWhere(params))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.notifications.isRead), (0, drizzle_orm_1.desc)(schema_1.notifications.internalId))
            .limit(params.limit);
    }
    /** Total non-deleted notifications for the user — feeds `total_estimate`. */
    async countForUser(userId) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.notifications.deletedAt)));
        return row?.value ?? 0;
    }
    /** Unread, non-deleted notifications for the user (the bell badge, §19 #2). */
    async countUnreadForUser(userId) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.userId, userId), (0, drizzle_orm_1.eq)(schema_1.notifications.isRead, false), (0, drizzle_orm_1.isNull)(schema_1.notifications.deletedAt)));
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
    async findById(id) {
        const [row] = await this.db
            .select(READ_COLUMNS)
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.eq)(schema_1.notifications.id, id))
            .limit(1);
        return row ?? null;
    }
    /**
     * Patch a single notification's state by primary key with a whitelisted
     * field set (never a spread of client input). Used for mark read/unread,
     * snooze, and soft-delete. Takes an optional `exec` for transactional use.
     */
    async update(id, patch, exec = this.db) {
        await exec.update(schema_1.notifications).set(patch).where((0, drizzle_orm_1.eq)(schema_1.notifications.id, id));
    }
    /**
     * Bulk mark every unread, non-deleted notification of the user as read
     * (§19 #5). Returns the number of rows flipped (the count the client sees).
     */
    async markAllReadForUser(userId, exec = this.db) {
        const result = await exec
            .update(schema_1.notifications)
            .set({ isRead: true })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.userId, userId), (0, drizzle_orm_1.eq)(schema_1.notifications.isRead, false), (0, drizzle_orm_1.isNull)(schema_1.notifications.deletedAt)));
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
    async wakeSnoozed(now = new Date(), exec = this.db) {
        const result = await exec
            .update(schema_1.notifications)
            .set({ isRead: false, snoozedUntil: null })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNotNull)(schema_1.notifications.snoozedUntil), (0, drizzle_orm_1.lte)(schema_1.notifications.snoozedUntil, now), (0, drizzle_orm_1.isNull)(schema_1.notifications.deletedAt)));
        return result[0].affectedRows;
    }
    /**
     * Count notifications currently due to wake — dry-run companion to
     * `wakeSnoozed`. `now` is passed as a bound parameter (not SQL `NOW()`) so it
     * goes through the same mysql2 timezone conversion as the stored
     * `snoozed_until`, keeping the comparison consistent.
     */
    async countSnoozedDue(now = new Date(), exec = this.db) {
        const [row] = await exec
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNotNull)(schema_1.notifications.snoozedUntil), (0, drizzle_orm_1.lte)(schema_1.notifications.snoozedUntil, now), (0, drizzle_orm_1.isNull)(schema_1.notifications.deletedAt)));
        return row?.value ?? 0;
    }
    /**
     * Shared WHERE for the feed page. `user_id` and the soft-delete filter are
     * always present; the keyset cursor is appended only when supplied (Drizzle's
     * `and()` drops `undefined` entries).
     */
    feedWhere(params) {
        const after = params.after;
        return (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.userId, params.userId), (0, drizzle_orm_1.isNull)(schema_1.notifications.deletedAt), after
            ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.gt)(schema_1.notifications.isRead, after.isRead), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.isRead, after.isRead), (0, drizzle_orm_1.lt)(schema_1.notifications.internalId, BigInt(after.internalId))))
            : undefined);
    }
}
exports.NotificationsRepo = NotificationsRepo;
