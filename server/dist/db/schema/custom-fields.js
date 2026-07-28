"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskCustomFieldValues = exports.customFieldOptions = exports.customFields = void 0;
// =============================================================================
// Custom fields domain — 3 tables
//   custom_fields, custom_field_options, task_custom_field_values
//   Mirrors `database/schema.sql §25-27`.
//
// `task_custom_field_values.option_id_generated` (VIRTUAL generated column on
// the JSON value) is included so the index `idx_tcfv_option` works for
// "filter tasks where Source = Facebook" queries.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const mysql_core_2 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
const tasks_1 = require("./tasks");
exports.customFields = (0, mysql_core_1.mysqlTable)("custom_fields", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    scopeType: (0, mysql_core_1.mysqlEnum)("scope_type", _shared_1.customFieldScopeTypes).notNull(),
    scopeId: (0, mysql_core_1.varchar)("scope_id", { length: _shared_1.ID_LENGTH }),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.NAME_LENGTH }).notNull(),
    type: (0, mysql_core_1.mysqlEnum)("type", _shared_1.customFieldTypes).notNull(),
    config: (0, mysql_core_1.json)("config").notNull().default({}),
    isRequired: (0, mysql_core_1.boolean)("is_required").notNull().default(false),
    defaultValue: (0, mysql_core_1.json)("default_value"),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    hiddenFromGuests: (0, mysql_core_1.boolean)("hidden_from_guests").notNull().default(false),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_custom_fields_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    scopeIdx: (0, mysql_core_1.index)("idx_custom_fields_scope").on(t.scopeType, t.scopeId, t.position),
    workspaceIdx: (0, mysql_core_1.index)("idx_custom_fields_workspace").on(t.workspaceId),
}));
exports.customFieldOptions = (0, mysql_core_1.mysqlTable)("custom_field_options", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    customFieldId: (0, mysql_core_1.varchar)("custom_field_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.customFields.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    label: (0, mysql_core_1.varchar)("label", { length: _shared_1.NAME_LENGTH }).notNull(),
    color: (0, mysql_core_2.char)("color", { length: _shared_1.HEX_COLOR_LENGTH })
        .notNull()
        .default("#94A3B8"),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (t) => ({
    fieldLabelUq: (0, mysql_core_1.uniqueIndex)("uq_cf_options_field_label").on(t.customFieldId, t.label),
    fieldIdx: (0, mysql_core_1.index)("idx_cf_options_field").on(t.customFieldId, t.position),
}));
exports.taskCustomFieldValues = (0, mysql_core_1.mysqlTable)("task_custom_field_values", {
    taskId: (0, mysql_core_1.varchar)("task_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => tasks_1.tasks.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    customFieldId: (0, mysql_core_1.varchar)("custom_field_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.customFields.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    value: (0, mysql_core_1.json)("value").notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
    updatedBy: (0, mysql_core_1.varchar)("updated_by", { length: _shared_1.ID_LENGTH }),
    // Generated VIRTUAL column — lets the dropdown-filter index work.
    optionIdGenerated: (0, mysql_core_1.varchar)("option_id_generated", { length: 64 })
        .generatedAlwaysAs((0, drizzle_orm_1.sql) `JSON_UNQUOTE(JSON_EXTRACT(value, '$.option_id'))`, { mode: "virtual" }),
}, (t) => ({
    pk: (0, mysql_core_1.primaryKey)({ columns: [t.taskId, t.customFieldId] }),
    updatedByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.updatedBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_tcfv_updated_by",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    fieldIdx: (0, mysql_core_1.index)("idx_tcfv_field").on(t.customFieldId),
    optionIdx: (0, mysql_core_1.index)("idx_tcfv_option").on(t.customFieldId, t.optionIdGenerated),
}));
