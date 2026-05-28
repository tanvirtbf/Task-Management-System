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
