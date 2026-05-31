// =============================================================================
// Notifications — per-user inbox (1 table)
//   Mirrors `database/schema.sql §29`.
// =============================================================================
import {
    bigint,
    boolean,
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
        emailEnabled: boolean("email_enabled").notNull().default(true),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.userId, t.type] }),
    }),
);

export type UserNotificationPref = typeof userNotificationPrefs.$inferSelect;
export type NewUserNotificationPref =
    typeof userNotificationPrefs.$inferInsert;
