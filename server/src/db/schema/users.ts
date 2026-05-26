import { relations } from "drizzle-orm";
import {
    boolean,
    int,
    mysqlEnum,
    mysqlTable,
    timestamp,
    varchar,
} from "drizzle-orm/mysql-core";
import { tasks } from "./tasks";

export const users = mysqlTable("users", {
    id: int("id").primaryKey().autoincrement(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password_hash: varchar("password_hash", { length: 255 }).notNull(),
    first_name: varchar("first_name", { length: 100 }).notNull(),
    last_name: varchar("last_name", { length: 100 }),
    avatar_url: varchar("avatar_url", { length: 500 }),
    role: mysqlEnum("role", ["admin", "member"]).notNull().default("member"),
    is_active: boolean("is_active").notNull().default(true),
    last_login_at: timestamp("last_login_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    deleted_at: timestamp("deleted_at"),
});

export const refresh_tokens = mysqlTable("refresh_tokens", {
    id: int("id").primaryKey().autoincrement(),
    user_id: int("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    token_hash: varchar("token_hash", { length: 255 }).notNull().unique(),
    user_agent: varchar("user_agent", { length: 500 }),
    ip_address: varchar("ip_address", { length: 45 }),
    is_revoked: boolean("is_revoked").notNull().default(false),
    revoked_at: timestamp("revoked_at"),
    expires_at: timestamp("expires_at").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
    refresh_tokens: many(refresh_tokens),
    created_tasks: many(tasks, { relationName: "creator" }),
    assigned_tasks: many(tasks, { relationName: "assignee" }),
}));

export const refreshTokensRelations = relations(refresh_tokens, ({ one }) => ({
    user: one(users, {
        fields: [refresh_tokens.user_id],
        references: [users.id],
    }),
}));
