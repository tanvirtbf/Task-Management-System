// =============================================================================
// Task content — comments, checklists, checklist_items, attachments (4 tables)
//   Mirrors `database/schema.sql §21-24`.
// =============================================================================
import {
    foreignKey,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { NOW_MS, timestampMs, uploadStatuses } from "./_shared";
import { users } from "./auth";
import { tasks } from "./tasks";

// ─── comments ─ 1-level threading via parent_comment_id ───────────────────────
export const comments = sqliteTable(
    "comments",
    {
        id: text("id").notNull().unique(),
        internalId: integer("internal_id", { mode: "number" }).primaryKey({
            autoIncrement: true,
        }),
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        parentCommentId: text("parent_comment_id"),
        authorId: text("author_id")
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        body: text("body").notNull(),
        editedAt: timestampMs("edited_at"),
        deletedAt: timestampMs("deleted_at"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_comments_internal_id").on(t.internalId),
        parentFk: foreignKey({
            columns: [t.parentCommentId],
            foreignColumns: [t.id],
            name: "fk_comments_parent",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        taskTimeIdx: index("idx_comments_task_time").on(t.taskId, t.createdAt),
        parentIdx: index("idx_comments_parent").on(t.parentCommentId),
    }),
);

// ─── checklists ───────────────────────────────────────────────────────────────
export const checklists = sqliteTable(
    "checklists",
    {
        id: text("id").primaryKey(),
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: text("name").notNull(),
        position: integer("position").notNull().default(0),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
    },
    (t) => ({
        taskIdx: index("idx_checklists_task").on(t.taskId, t.position),
    }),
);

// ─── checklist_items ──────────────────────────────────────────────────────────
export const checklistItems = sqliteTable(
    "checklist_items",
    {
        id: text("id").primaryKey(),
        checklistId: text("checklist_id")
            .notNull()
            .references(() => checklists.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        parentItemId: text("parent_item_id"),
        text: text("text").notNull(),
        isCompleted: integer("is_completed", { mode: "boolean" })
            .notNull()
            .default(false),
        completedAt: timestampMs("completed_at"),
        completedBy: text("completed_by"),
        assigneeId: text("assignee_id"),
        position: integer("position").notNull().default(0),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
    },
    (t) => ({
        parentFk: foreignKey({
            columns: [t.parentItemId],
            foreignColumns: [t.id],
            name: "fk_checklist_items_parent",
        })
            .onDelete("cascade")
            .onUpdate("cascade"),
        assigneeFk: foreignKey({
            columns: [t.assigneeId],
            foreignColumns: [users.id],
            name: "fk_checklist_items_assignee",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        completedByFk: foreignKey({
            columns: [t.completedBy],
            foreignColumns: [users.id],
            name: "fk_checklist_items_completed_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        checklistIdx: index("idx_checklist_items_checklist").on(
            t.checklistId,
            t.position,
        ),
        assigneeIdx: index("idx_checklist_items_assignee").on(t.assigneeId),
    }),
);

// ─── attachments ──────────────────────────────────────────────────────────────
export const attachments = sqliteTable(
    "attachments",
    {
        id: text("id").primaryKey(),
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: text("name").notNull(),
        storageKey: text("storage_key").notNull(),
        mimeType: text("mime_type")
            .notNull()
            .default("application/octet-stream"),
        sizeBytes: integer("size_bytes", {
            mode: "number",
        }).notNull(),
        thumbnailKey: text("thumbnail_key"),
        uploadedBy: text("uploaded_by")
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        uploadedAt: timestampMs("uploaded_at").notNull().default(NOW_MS),
        deletedAt: timestampMs("deleted_at"),
        uploadStatus: text("upload_status", { enum: uploadStatuses })
            .notNull()
            .default("pending"),
    },
    (t) => ({
        taskIdx: index("idx_attachments_task").on(t.taskId, t.uploadedAt),
    }),
);

// ─── task_postmortems ─ §22 postmortem checklist on a resolved Incident ───────
// One row per Incident task (PK = task_id). `items` is the checklist
// label → checked map submitted at POST /eng/incidents/:id/postmortem; "submit"
// is an upsert. Mirrors `database/schema.sql §33`.
export const taskPostmortems = sqliteTable("task_postmortems", {
    taskId: text("task_id")
        .primaryKey()
        .references(() => tasks.id, {
            onDelete: "cascade",
            onUpdate: "cascade",
        }),
    items: text("items", { mode: "json" }).notNull(),
    updatedBy: text("updated_by").references(
        () => users.id,
        { onDelete: "set null", onUpdate: "cascade" },
    ),
    createdAt: timestampMs("created_at").notNull().default(NOW_MS),
    updatedAt: timestampMs("updated_at")
        .notNull()
        .default(NOW_MS)
        .$onUpdate(() => new Date()),
});

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type TaskPostmortem = typeof taskPostmortems.$inferSelect;
export type NewTaskPostmortem = typeof taskPostmortems.$inferInsert;
export type Checklist = typeof checklists.$inferSelect;
export type NewChecklist = typeof checklists.$inferInsert;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
