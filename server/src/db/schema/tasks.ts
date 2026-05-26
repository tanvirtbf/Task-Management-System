import { relations } from "drizzle-orm";
import {
    boolean,
    int,
    mysqlEnum,
    mysqlTable,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users";

export const tasks = mysqlTable("tasks", {
    id: int("id").primaryKey().autoincrement(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["todo", "in_progress", "done", "archived"])
        .notNull()
        .default("todo"),
    priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"])
        .notNull()
        .default("medium"),
    due_date: timestamp("due_date"),
    creator_id: int("creator_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    assignee_id: int("assignee_id").references(() => users.id, { onDelete: "set null" }),
    is_archived: boolean("is_archived").notNull().default(false),
    completed_at: timestamp("completed_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    deleted_at: timestamp("deleted_at"),
});

export const task_comments = mysqlTable("task_comments", {
    id: int("id").primaryKey().autoincrement(),
    task_id: int("task_id")
        .notNull()
        .references(() => tasks.id, { onDelete: "cascade" }),
    user_id: int("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const tasksRelations = relations(tasks, ({ one, many }) => ({
    creator: one(users, {
        fields: [tasks.creator_id],
        references: [users.id],
        relationName: "creator",
    }),
    assignee: one(users, {
        fields: [tasks.assignee_id],
        references: [users.id],
        relationName: "assignee",
    }),
    comments: many(task_comments),
}));

export const taskCommentsRelations = relations(task_comments, ({ one }) => ({
    task: one(tasks, {
        fields: [task_comments.task_id],
        references: [tasks.id],
    }),
    user: one(users, {
        fields: [task_comments.user_id],
        references: [users.id],
    }),
}));
