"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templates = void 0;
// =============================================================================
// Templates domain — 1 table
//   templates — reusable task structures for "Apply template" feature
//
// Mirrors `database/schema.sql §32` 1:1. Per FINAL_REQUIREMENTS.md §5.18 any
// team can save reusable task templates with pre-built checklists.
// =============================================================================
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
exports.templates = (0, mysql_core_1.mysqlTable)("templates", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    type: (0, mysql_core_1.mysqlEnum)("type", _shared_1.templateTypes).notNull().default("task"),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.NAME_LENGTH }).notNull(),
    description: (0, mysql_core_1.text)("description"),
    icon: (0, mysql_core_1.varchar)("icon", { length: 60 }),
    color: (0, mysql_core_1.char)("color", { length: _shared_1.HEX_COLOR_LENGTH }),
    // Structure is JSON — flexible per the type field. Holds checklist
    // items, default task type, tags, description, etc.
    structure: (0, mysql_core_1.json)("structure").notNull(),
    usageCount: (0, mysql_core_1.int)("usage_count", { unsigned: true })
        .notNull()
        .default(0),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at")
        .notNull()
        .defaultNow()
        .onUpdateNow(),
}, (t) => ({
    workspaceNameUq: (0, mysql_core_1.uniqueIndex)("uq_templates_workspace_name").on(t.workspaceId, t.name),
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_templates_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    workspaceTypeIdx: (0, mysql_core_1.index)("idx_templates_workspace_type").on(t.workspaceId, t.type),
}));
