"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formSubmissions = exports.formFields = exports.forms = void 0;
// =============================================================================
// Forms — public intake + submissions (3 tables)
//   forms, form_fields, form_submissions
//   Mirrors `database/schema.sql §26-28`.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const hierarchy_1 = require("./hierarchy");
const tasks_1 = require("./tasks");
exports.forms = (0, mysql_core_1.mysqlTable)("forms", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    listId: (0, mysql_core_1.varchar)("list_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => hierarchy_1.lists.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    title: (0, mysql_core_1.varchar)("title", { length: 200 }).notNull(),
    description: (0, mysql_core_1.varchar)("description", { length: 2000 }),
    isPublic: (0, mysql_core_1.boolean)("is_public").notNull().default(true),
    publicSlug: (0, mysql_core_1.varchar)("public_slug", { length: _shared_1.NAME_LENGTH }).notNull(),
    branding: (0, mysql_core_1.json)("branding").notNull().default({}),
    settings: (0, mysql_core_1.json)("settings").notNull().default({}),
    submissionCount: (0, mysql_core_1.int)("submission_count", { unsigned: true })
        .notNull()
        .default(0),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    publicSlugUq: (0, mysql_core_1.uniqueIndex)("uq_forms_public_slug").on(t.publicSlug),
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_forms_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    listIdx: (0, mysql_core_1.index)("idx_forms_list").on(t.listId),
}));
exports.formFields = (0, mysql_core_1.mysqlTable)("form_fields", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    formId: (0, mysql_core_1.varchar)("form_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.forms.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    fieldKind: (0, mysql_core_1.mysqlEnum)("field_kind", _shared_1.formFieldKinds).notNull(),
    fieldKey: (0, mysql_core_1.varchar)("field_key", { length: _shared_1.NAME_LENGTH }).notNull(),
    label: (0, mysql_core_1.varchar)("label", { length: 200 }).notNull(),
    helpText: (0, mysql_core_1.varchar)("help_text", { length: 500 }),
    placeholder: (0, mysql_core_1.varchar)("placeholder", { length: 200 }),
    isRequired: (0, mysql_core_1.boolean)("is_required").notNull().default(false),
    isHidden: (0, mysql_core_1.boolean)("is_hidden").notNull().default(false),
    defaultValue: (0, mysql_core_1.json)("default_value"),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    formKeyUq: (0, mysql_core_1.uniqueIndex)("uq_form_fields_form_key").on(t.formId, t.fieldKind, t.fieldKey),
    formIdx: (0, mysql_core_1.index)("idx_form_fields_form").on(t.formId, t.position),
}));
exports.formSubmissions = (0, mysql_core_1.mysqlTable)("form_submissions", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    internalId: (0, mysql_core_1.bigint)("internal_id", { mode: "bigint", unsigned: true })
        .notNull()
        .autoincrement(),
    formId: (0, mysql_core_1.varchar)("form_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.forms.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH }),
    submitterEmail: (0, mysql_core_1.varchar)("submitter_email", { length: _shared_1.EMAIL_LENGTH }),
    submitterIp: (0, mysql_core_1.varchar)("submitter_ip", { length: _shared_1.IP_LENGTH }),
    data: (0, mysql_core_1.json)("data").notNull(),
    encryptedAt: (0, mysql_core_1.timestamp)("encrypted_at"),
    expiresAt: (0, mysql_core_1.timestamp)("expires_at"),
    submittedAt: (0, mysql_core_1.timestamp)("submitted_at").notNull().defaultNow(),
}, (t) => ({
    internalIdUq: (0, mysql_core_1.uniqueIndex)("uq_form_submissions_internal_id").on(t.internalId),
    taskFk: (0, mysql_core_1.foreignKey)({
        columns: [t.taskId],
        foreignColumns: [tasks_1.tasks.id],
        name: "fk_form_submissions_task",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    formTimeIdx: (0, mysql_core_1.index)("idx_form_submissions_form_time").on(t.formId, t.submittedAt),
    expiresAtIdx: (0, mysql_core_1.index)("idx_form_submissions_expires_at").on(t.expiresAt),
}));
