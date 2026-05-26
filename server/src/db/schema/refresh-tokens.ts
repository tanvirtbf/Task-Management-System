import { relations } from "drizzle-orm";
import { int, mysqlTable, timestamp } from "drizzle-orm/mysql-core";
import { users } from "./users";

export const refreshTokens = mysqlTable("refresh_tokens", {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
    user: one(users, {
        fields: [refreshTokens.userId],
        references: [users.id],
    }),
}));

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
