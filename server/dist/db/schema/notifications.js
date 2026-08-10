"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushSubscriptions = exports.userNotificationPrefs = exports.notifications = void 0;
// =============================================================================
// Notifications — per-user inbox + delivery prefs + Web Push devices (3 tables)
//   Mirrors `database/schema.sql §29 / §29b / §29c`.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
exports.notifications = (0, mysql_core_1.mysqlTable)("notifications", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    type: (0, mysql_core_1.mysqlEnum)("type", _shared_1.notificationTypes).notNull(),
    entityType: (0, mysql_core_1.mysqlEnum)("entity_type", _shared_1.notificationEntityTypes).notNull(),
    entityId: (0, mysql_core_1.varchar)("entity_id", { length: _shared_1.ID_LENGTH }).notNull(),
    actorId: (0, mysql_core_1.varchar)("actor_id", { length: _shared_1.ID_LENGTH }),
    title: (0, mysql_core_1.varchar)("title", { length: 300 }).notNull(),
    body: (0, mysql_core_1.varchar)("body", { length: 1000 }),
    isRead: (0, mysql_core_1.boolean)("is_read").notNull().default(false),
    snoozedUntil: (0, mysql_core_1.timestamp)("snoozed_until"),
    // Soft-delete tombstone (§19 #7 — DELETE hides the row from feed/count).
    deletedAt: (0, mysql_core_1.timestamp)("deleted_at"),
    emailSentAt: (0, mysql_core_1.timestamp)("email_sent_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_notifications_internal_id").on(t.internalId),
    actorFk: (0, mysql_core_1.foreignKey)({
        columns: [t.actorId],
        foreignColumns: [auth_1.users.id],
        name: "fk_notifications_actor",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    userStateIdx: (0, mysql_core_1.index)("idx_notifications_user_state").on(t.userId, t.isRead, t.createdAt),
    snoozedIdx: (0, mysql_core_1.index)("idx_notifications_snoozed").on(t.snoozedUntil),
}));
/**
 * Per-user, per-type notification delivery preferences (§19 #8/#9).
 *
 * One row per (user, notification type). A MISSING row means "all channels on"
 * — the spec default — so the read endpoint lazily fills defaults for any type
 * without a row and the write endpoint upserts only the types the client sends.
 * Composite PK `(user_id, type)` mirrors the junction-table style elsewhere in
 * the schema (e.g. `task_assignees`). Mirrors `database/schema.sql §29b`.
 */
exports.userNotificationPrefs = (0, mysql_core_1.mysqlTable)("user_notification_prefs", {
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    type: (0, mysql_core_1.mysqlEnum)("type", _shared_1.notificationTypes).notNull(),
    inAppEnabled: (0, mysql_core_1.boolean)("in_app_enabled").notNull().default(true),
    // F19 (D8): email_enabled is GONE — it promised a channel with no
    // implementation (MailService sends exactly two transactional mails).
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    pk: (0, mysql_core_1.primaryKey)({ columns: [t.userId, t.type] }),
}));
/**
 * Web Push subscriptions — one row per (user, browser/device) pair
 * (§29c, upgrades/015, 2026-08-08). A row is a standing permission slip: "this
 * browser agreed to receive pushes for this user". Written by
 * `POST /push/subscriptions` once the device grants the browser Notification
 * permission, deleted on sign-out (`DELETE /push/subscriptions`) or when the
 * push service answers 404/410 — the browser revoked or expired it, and
 * `PushService` prunes the row inline so dead devices never accumulate.
 *
 * `endpoint` is the push-service URL and is far too long for a utf8mb4 unique
 * index, so uniqueness rides on `endpoint_hash` = SHA-256 hex of the endpoint.
 * An endpoint that re-subscribes under a DIFFERENT user (a shared computer) is
 * REASSIGNED by the upsert: a device always delivers to whoever is signed in
 * on it, never to the previous occupant.
 */
exports.pushSubscriptions = (0, mysql_core_1.mysqlTable)("push_subscriptions", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    userId: (0, mysql_core_1.varchar)("user_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    endpointHash: (0, mysql_core_1.char)("endpoint_hash", { length: 64 }).notNull(),
    endpoint: (0, mysql_core_1.varchar)("endpoint", { length: 1000 }).notNull(),
    // Browser-generated encryption material (base64url): P-256 public key
    // + auth secret. Required by the Web Push message encryption.
    p256dh: (0, mysql_core_1.varchar)("p256dh", { length: 255 }).notNull(),
    auth: (0, mysql_core_1.varchar)("auth", { length: 191 }).notNull(),
    // Device label, for answering "which browser is this?" in support.
    userAgent: (0, mysql_core_1.varchar)("user_agent", { length: 255 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    endpointUq: (0, mysql_core_1.uniqueIndex)("uq_push_subscriptions_endpoint").on(t.endpointHash),
    userIdx: (0, mysql_core_1.index)("idx_push_subscriptions_user").on(t.userId),
}));
