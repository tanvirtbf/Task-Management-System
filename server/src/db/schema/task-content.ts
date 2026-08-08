// =============================================================================
// Task content — comments, checklists, checklist_items, attachments (4 tables)
//   Mirrors `database/schema.sql §21-24`.
// =============================================================================
import {
    bigint,
    boolean,
    foreignKey,
    index,
    int,
    json,
    mysqlEnum,
    mysqlTable,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import { ID_LENGTH, URL_LENGTH, uploadStatuses } from "./_shared";
import { users } from "./auth";
import { tasks } from "./tasks";

// ─── comments ─ 1-level threading via parent_comment_id ───────────────────────
export const comments = mysqlTable(
    "comments",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        parentCommentId: varchar("parent_comment_id", { length: ID_LENGTH }),
        authorId: varchar("author_id", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        body: text("body").notNull(),
        editedAt: timestamp("edited_at"),
        deletedAt: timestamp("deleted_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
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
        // F30 (ISS-088): `listByTask` orders by (created_at, internal_id) —
        // the tie-break column is what pushed MySQL off `idx_comments_task_time`
        // into a filesort. This index carries the FULL order.
        taskCreatedInternalIdx: index("idx_comments_task_created_internal").on(
            t.taskId,
            t.createdAt,
            t.internalId,
        ),
    }),
);

// ─── checklists ───────────────────────────────────────────────────────────────
export const checklists = mysqlTable(
    "checklists",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: varchar("name", { length: 200 }).notNull(),
        position: int("position", { unsigned: true }).notNull().default(0),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        taskIdx: index("idx_checklists_task").on(t.taskId, t.position),
    }),
);

// ─── checklist_items ──────────────────────────────────────────────────────────
export const checklistItems = mysqlTable(
    "checklist_items",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        checklistId: varchar("checklist_id", { length: ID_LENGTH })
            .notNull()
            .references(() => checklists.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        parentItemId: varchar("parent_item_id", { length: ID_LENGTH }),
        text: varchar("text", { length: 500 }).notNull(),
        isCompleted: boolean("is_completed").notNull().default(false),
        completedAt: timestamp("completed_at"),
        completedBy: varchar("completed_by", { length: ID_LENGTH }),
        assigneeId: varchar("assignee_id", { length: ID_LENGTH }),
        position: int("position", { unsigned: true }).notNull().default(0),
        createdAt: timestamp("created_at").notNull().defaultNow(),
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
export const attachments = mysqlTable(
    "attachments",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: varchar("name", { length: 255 }).notNull(),
        storageKey: varchar("storage_key", { length: URL_LENGTH }).notNull(),
        mimeType: varchar("mime_type", { length: 120 })
            .notNull()
            .default("application/octet-stream"),
        sizeBytes: bigint("size_bytes", {
            mode: "bigint",
            unsigned: true,
        }).notNull(),
        thumbnailKey: varchar("thumbnail_key", { length: URL_LENGTH }),
        uploadedBy: varchar("uploaded_by", { length: ID_LENGTH })
            .notNull()
            .references(() => users.id, {
                onDelete: "restrict",
                onUpdate: "cascade",
            }),
        uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
        deletedAt: timestamp("deleted_at"),
        uploadStatus: mysqlEnum("upload_status", uploadStatuses)
            .notNull()
            .default("pending"),
    },
    (t) => ({
        taskIdx: index("idx_attachments_task").on(t.taskId, t.uploadedAt),
    }),
);

// ─── r2_purge_queue ─ F16 (ISS-022) ──────────────────────────────────────────
// R2 object keys awaiting deletion, for the ONE case the soft-delete flow
// cannot see: a task hard delete. `attachments.task_id` is ON DELETE CASCADE,
// so the rows vanish with the task — and the r2-purge job, which finds objects
// by reading soft-deleted attachment rows, never learns those objects exist.
// The bytes stayed in the bucket forever (P4 proved it with four stranded
// objects). The hard-delete transaction now copies the subtree's keys here
// BEFORE deleting the task row; the same job drains the queue. Grace period
// does not apply — the task is already permanently gone, so its files are too.
export const r2PurgeQueue = mysqlTable(
    "r2_purge_queue",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        storageKey: varchar("storage_key", { length: URL_LENGTH }).notNull(),
        thumbnailKey: varchar("thumbnail_key", { length: URL_LENGTH }),
        queuedAt: timestamp("queued_at").notNull().defaultNow(),
    },
    (t) => ({
        queuedIdx: index("idx_r2_purge_queued").on(t.queuedAt),
    }),
);

// ─── task_postmortems ─ §22 postmortem checklist on a resolved Incident ───────
// One row per Incident task (PK = task_id). `items` is the checklist
// label → checked map submitted at POST /eng/incidents/:id/postmortem; "submit"
// is an upsert. Mirrors `database/schema.sql §33`.
export const taskPostmortems = mysqlTable("task_postmortems", {
    taskId: varchar("task_id", { length: ID_LENGTH })
        .primaryKey()
        .references(() => tasks.id, {
            onDelete: "cascade",
            onUpdate: "cascade",
        }),
    items: json("items").notNull(),
    updatedBy: varchar("updated_by", { length: ID_LENGTH }).references(
        () => users.id,
        { onDelete: "set null", onUpdate: "cascade" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
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
