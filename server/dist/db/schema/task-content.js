"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskPostmortems = exports.attachments = exports.checklistItems = exports.checklists = exports.comments = void 0;
// =============================================================================
// Task content — comments, checklists, checklist_items, attachments (4 tables)
//   Mirrors `database/schema.sql §21-24`.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const tasks_1 = require("./tasks");
// ─── comments ─ 1-level threading via parent_comment_id ───────────────────────
exports.comments = (0, mysql_core_1.mysqlTable)("comments", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => tasks_1.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    parentCommentId: (0, mysql_core_1.varchar)("parent_comment_id", { length: _shared_1.ID_LENGTH }),
    authorId: (0, mysql_core_1.varchar)("author_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
    }),
    body: (0, mysql_core_1.text)("body").notNull(),
    editedAt: (0, mysql_core_1.timestamp)("edited_at"),
    deletedAt: (0, mysql_core_1.timestamp)("deleted_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_comments_internal_id").on(t.internalId),
    parentFk: (0, mysql_core_1.foreignKey)({
        columns: [t.parentCommentId],
        foreignColumns: [t.id],
        name: "fk_comments_parent",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    taskTimeIdx: (0, mysql_core_1.index)("idx_comments_task_time").on(t.taskId, t.createdAt),
    parentIdx: (0, mysql_core_1.index)("idx_comments_parent").on(t.parentCommentId),
}));
// ─── checklists ───────────────────────────────────────────────────────────────
exports.checklists = (0, mysql_core_1.mysqlTable)("checklists", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => tasks_1.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    name: (0, mysql_core_1.varchar)("name", { length: 200 }).notNull(),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    taskIdx: (0, mysql_core_1.index)("idx_checklists_task").on(t.taskId, t.position),
}));
// ─── checklist_items ──────────────────────────────────────────────────────────
exports.checklistItems = (0, mysql_core_1.mysqlTable)("checklist_items", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    checklistId: (0, mysql_core_1.varchar)("checklist_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.checklists.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    parentItemId: (0, mysql_core_1.varchar)("parent_item_id", { length: _shared_1.ID_LENGTH }),
    text: (0, mysql_core_1.varchar)("text", { length: 500 }).notNull(),
    isCompleted: (0, mysql_core_1.boolean)("is_completed").notNull().default(false),
    completedAt: (0, mysql_core_1.timestamp)("completed_at"),
    completedBy: (0, mysql_core_1.varchar)("completed_by", { length: _shared_1.ID_LENGTH }),
    assigneeId: (0, mysql_core_1.varchar)("assignee_id", { length: _shared_1.ID_LENGTH }),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    parentFk: (0, mysql_core_1.foreignKey)({
        columns: [t.parentItemId],
        foreignColumns: [t.id],
        name: "fk_checklist_items_parent",
    })
        .onDelete("cascade")
        .onUpdate("cascade"),
    assigneeFk: (0, mysql_core_1.foreignKey)({
        columns: [t.assigneeId],
        foreignColumns: [auth_1.users.id],
        name: "fk_checklist_items_assignee",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    completedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.completedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_checklist_items_completed_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    checklistIdx: (0, mysql_core_1.index)("idx_checklist_items_checklist").on(t.checklistId, t.position),
    assigneeIdx: (0, mysql_core_1.index)("idx_checklist_items_assignee").on(t.assigneeId),
}));
// ─── attachments ──────────────────────────────────────────────────────────────
exports.attachments = (0, mysql_core_1.mysqlTable)("attachments", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => tasks_1.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    storageKey: (0, mysql_core_1.varchar)("storage_key", { length: _shared_1.URL_LENGTH }).notNull(),
    mimeType: (0, mysql_core_1.varchar)("mime_type", { length: 120 })
        .notNull()
        .default("application/octet-stream"),
    sizeBytes: (0, mysql_core_1.bigint)("size_bytes", {
        mode: "bigint",
        unsigned: true,
    }).notNull(),
    thumbnailKey: (0, mysql_core_1.varchar)("thumbnail_key", { length: _shared_1.URL_LENGTH }),
    uploadedBy: (0, mysql_core_1.varchar)("uploaded_by", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
    }),
    uploadedAt: (0, mysql_core_1.timestamp)("uploaded_at").notNull().defaultNow(),
    deletedAt: (0, mysql_core_1.timestamp)("deleted_at"),
    uploadStatus: (0, mysql_core_1.mysqlEnum)("upload_status", _shared_1.uploadStatuses)
        .notNull()
        .default("pending"),
}, (t) => ({
    taskIdx: (0, mysql_core_1.index)("idx_attachments_task").on(t.taskId, t.uploadedAt),
}));
// ─── task_postmortems ─ §22 postmortem checklist on a resolved Incident ───────
// One row per Incident task (PK = task_id). `items` is the checklist
// label → checked map submitted at POST /eng/incidents/:id/postmortem; "submit"
// is an upsert. Mirrors `database/schema.sql §33`.
exports.taskPostmortems = (0, mysql_core_1.mysqlTable)("task_postmortems", {
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .primaryKey()
        .references(() => tasks_1.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    items: (0, mysql_core_1.json)("items").notNull(),
    updatedBy: (0, mysql_core_1.varchar)("updated_by", { length: _shared_1.ID_LENGTH }).references(() => auth_1.users.id, { onDelete: "set null", onUpdate: "cascade" }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
});
