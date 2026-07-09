// =============================================================================
// Notifications — per-user inbox (1 table)
//   Mirrors `database/schema.sql §29`.
// =============================================================================
import {
    foreignKey,
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
    NOW_MS,
    notificationEntityTypes,
    notificationTypes,
    timestampMs,
} from "./_shared";
import { users } from "./auth";

export const notifications = sqliteTable(
    "notifications",
    {
        // conv: AUTO_INCREMENT flip — SQLite only auto-increments INTEGER
        // PRIMARY KEY, so `internal_id` became the PK and the public varchar
        // `id` was demoted to NOT NULL UNIQUE.
        id: text("id").notNull().unique(),
        internalId: integer("internal_id", { mode: "number" }).primaryKey({
            autoIncrement: true,
        }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: text("type", { enum: notificationTypes }).notNull(),
        entityType: text("entity_type", {
            enum: notificationEntityTypes,
        }).notNull(),
        entityId: text("entity_id").notNull(),
        actorId: text("actor_id"),
        title: text("title").notNull(),
        body: text("body"),
        isRead: integer("is_read", { mode: "boolean" })
            .notNull()
            .default(false),
        snoozedUntil: timestampMs("snoozed_until"),
        // Soft-delete tombstone (§19 #7 — DELETE hides the row from feed/count).
        deletedAt: timestampMs("deleted_at"),
        emailSentAt: timestampMs("email_sent_at"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
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
export const userNotificationPrefs = sqliteTable(
    "user_notification_prefs",
    {
        userId: text("user_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: text("type", { enum: notificationTypes }).notNull(),
        inAppEnabled: integer("in_app_enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        emailEnabled: integer("email_enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.userId, t.type] }),
    }),
);

export type UserNotificationPref = typeof userNotificationPrefs.$inferSelect;
export type NewUserNotificationPref =
    typeof userNotificationPrefs.$inferInsert;
