import { relations } from "drizzle-orm";
import {
    int,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import { tenants } from "./tenants";

export const users = mysqlTable(
    "users",
    {
        id: int("id").autoincrement().primaryKey(),
        firstName: varchar("first_name", { length: 100 }).notNull(),
        lastName: varchar("last_name", { length: 100 }).notNull(),
        email: varchar("email", { length: 320 }).notNull(),
        password: varchar("password", { length: 255 }).notNull(),
        role: varchar("role", { length: 32 }).notNull(),
        tenantId: int("tenant_id").references(() => tenants.id, {
            onDelete: "set null",
        }),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (table) => ({
        emailIdx: uniqueIndex("users_email_unique").on(table.email),
    }),
);

export const usersRelations = relations(users, ({ one }) => ({
    tenant: one(tenants, {
        fields: [users.tenantId],
        references: [tenants.id],
    }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
