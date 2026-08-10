// =============================================================================
// Notifications — per-user inbox + delivery prefs + Web Push devices (3 tables)
//   Mirrors `database/schema.sql §29 / §29b / §29c`.
// =============================================================================
import {
    bigint,
    boolean,
    char,
    foreignKey,
    index,
    mysqlEnum,
    mysqlTable,
    primaryKey,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    ID_LENGTH,
    notificationEntityTypes,
    notificationTypes,
} from "./_shared";
import { users } from "./auth";

export const notifications = mysqlTable(
    "notifications",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: mysqlEnum("type", notificationTypes).notNull(),
        entityType: mysqlEnum("entity_type", notificationEntityTypes).notNull(),
        entityId: varchar("entity_id", { length: ID_LENGTH }).notNull(),
        actorId: varchar("actor_id", { length: ID_LENGTH }),
        title: varchar("title", { length: 300 }).notNull(),
        body: varchar("body", { length: 1000 }),
        isRead: boolean("is_read").notNull().default(false),
        snoozedUntil: timestamp("snoozed_until"),
        // Soft-delete tombstone (§19 #7 — DELETE hides the row from feed/count).
        deletedAt: timestamp("deleted_at"),
        emailSentAt: timestamp("email_sent_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_notifications_internal_id").on(
            t.internalId,
        ),
        actorFk: foreignKey({
            columns: [t.actorId],
            foreignColumns: [users.id],
            name: "fk_notifications_actor",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        userStateIdx: index("idx_notifications_user_state").on(
            t.userId,
            t.isRead,
            t.createdAt,
        ),
        snoozedIdx: index("idx_notifications_snoozed").on(t.snoozedUntil),
    }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

/**
 * Per-user, per-type notification delivery preferences (§19 #8/#9).
 *
 * One row per (user, notification type). A MISSING row means "all channels on"
 * — the spec default — so the read endpoint lazily fills defaults for any type
 * without a row and the write endpoint upserts only the types the client sends.
 * Composite PK `(user_id, type)` mirrors the junction-table style elsewhere in
 * the schema (e.g. `task_assignees`). Mirrors `database/schema.sql §29b`.
 */
export const userNotificationPrefs = mysqlTable(
    "user_notification_prefs",
    {
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: mysqlEnum("type", notificationTypes).notNull(),
        inAppEnabled: boolean("in_app_enabled").notNull().default(true),
        // F19 (D8): email_enabled is GONE — it promised a channel with no
        // implementation (MailService sends exactly two transactional mails).
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.userId, t.type] }),
    }),
);

export type UserNotificationPref = typeof userNotificationPrefs.$inferSelect;
export type NewUserNotificationPref =
    typeof userNotificationPrefs.$inferInsert;

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
export const pushSubscriptions = mysqlTable(
    "push_subscriptions",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        userId: varchar("user_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        endpointHash: char("endpoint_hash", { length: 64 }).notNull(),
        endpoint: varchar("endpoint", { length: 1000 }).notNull(),
        // Browser-generated encryption material (base64url): P-256 public key
        // + auth secret. Required by the Web Push message encryption.
        p256dh: varchar("p256dh", { length: 255 }).notNull(),
        auth: varchar("auth", { length: 191 }).notNull(),
        // Device label, for answering "which browser is this?" in support.
        userAgent: varchar("user_agent", { length: 255 }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        endpointUq: uniqueIndex("uq_push_subscriptions_endpoint").on(
            t.endpointHash,
        ),
        userIdx: index("idx_push_subscriptions_user").on(t.userId),
    }),
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
