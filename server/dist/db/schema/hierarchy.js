"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tags = exports.statuses = exports.lists = exports.taskTypes = exports.spaces = void 0;
// =============================================================================
// Hierarchy domain — 5 tables
//   spaces, lists, task_types, statuses, tags
//
// Mirrors `database/schema.sql §6-10` 1:1.
// =============================================================================
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const _shared_1 = require("./_shared");
const auth_1 = require("./auth");
// ─── spaces ───────────────────────────────────────────────────────────────────
exports.spaces = (0, mysql_core_1.mysqlTable)("spaces", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.NAME_LENGTH }).notNull(),
    description: (0, mysql_core_1.varchar)("description", { length: 500 }),
    icon: (0, mysql_core_1.varchar)("icon", { length: 64 }).notNull().default("Folder"),
    color: (0, mysql_core_1.char)("color", { length: _shared_1.HEX_COLOR_LENGTH })
        .notNull()
        .default("#4F46E5"),
    isPrivate: (0, mysql_core_1.boolean)("is_private").notNull().default(false),
    /** Department head (Dept Review V1) — nullable; app clears it on user deactivation. */
    headUserId: (0, mysql_core_1.varchar)("head_user_id", { length: _shared_1.ID_LENGTH }),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    archivedAt: (0, mysql_core_1.timestamp)("archived_at"),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_spaces_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    headFk: (0, mysql_core_1.foreignKey)({
        columns: [t.headUserId],
        foreignColumns: [auth_1.users.id],
        name: "fk_spaces_head",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    headIdx: (0, mysql_core_1.index)("idx_spaces_head").on(t.headUserId),
    workspaceArchivedIdx: (0, mysql_core_1.index)("idx_spaces_workspace_archived").on(t.workspaceId, t.archivedAt, t.position),
    colorCk: (0, mysql_core_1.check)("ck_spaces_color", (0, drizzle_orm_1.sql) `${t.color} REGEXP '^#[0-9A-Fa-f]{6}$'`),
}));
// ─── task_types ───────────────────────────────────────────────────────────────
// Declared before `lists` because lists.default_task_type_id references it.
exports.taskTypes = (0, mysql_core_1.mysqlTable)("task_types", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.SHORT_NAME_LENGTH }).notNull(),
    description: (0, mysql_core_1.varchar)("description", { length: 300 }),
    icon: (0, mysql_core_1.varchar)("icon", { length: 64 }).notNull().default("CheckSquare"),
    color: (0, mysql_core_1.char)("color", { length: _shared_1.HEX_COLOR_LENGTH })
        .notNull()
        .default("#6B7280"),
    isMilestoneType: (0, mysql_core_1.boolean)("is_milestone_type").notNull().default(false),
    isSystem: (0, mysql_core_1.boolean)("is_system").notNull().default(false),
    isDevType: (0, mysql_core_1.boolean)("is_dev_type").notNull().default(false),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    workspaceNameUq: (0, mysql_core_1.uniqueIndex)("uq_task_types_workspace_name").on(t.workspaceId, t.name),
    workspaceIdx: (0, mysql_core_1.index)("idx_task_types_workspace").on(t.workspaceId, t.position),
}));
// ─── lists ────────────────────────────────────────────────────────────────────
exports.lists = (0, mysql_core_1.mysqlTable)("lists", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    spaceId: (0, mysql_core_1.varchar)("space_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => exports.spaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.NAME_LENGTH }).notNull(),
    description: (0, mysql_core_1.varchar)("description", { length: 500 }),
    icon: (0, mysql_core_1.varchar)("icon", { length: 64 }).notNull().default("ListChecks"),
    color: (0, mysql_core_1.char)("color", { length: _shared_1.HEX_COLOR_LENGTH })
        .notNull()
        .default("#4F46E5"),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    defaultTaskTypeId: (0, mysql_core_1.varchar)("default_task_type_id", { length: _shared_1.ID_LENGTH }),
    isPrivate: (0, mysql_core_1.boolean)("is_private").notNull().default(false),
    archivedAt: (0, mysql_core_1.timestamp)("archived_at"),
    createdBy: (0, mysql_core_1.varchar)("created_by", { length: _shared_1.ID_LENGTH }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    createdByFk: (0, mysql_core_1.foreignKey)({
        columns: [t.createdBy],
        foreignColumns: [auth_1.users.id],
        name: "fk_lists_created_by",
    })
        .onDelete("restrict")
        .onUpdate("cascade"),
    defaultTaskTypeFk: (0, mysql_core_1.foreignKey)({
        columns: [t.defaultTaskTypeId],
        foreignColumns: [exports.taskTypes.id],
        name: "fk_lists_default_task_type",
    })
        .onDelete("set null")
        .onUpdate("cascade"),
    spaceArchivedIdx: (0, mysql_core_1.index)("idx_lists_space_archived").on(t.spaceId, t.archivedAt, t.position),
    defaultTaskTypeIdx: (0, mysql_core_1.index)("idx_lists_default_task_type").on(t.defaultTaskTypeId),
}));
// ─── statuses ─ polymorphic scope (list or space); app validates ──────────────
exports.statuses = (0, mysql_core_1.mysqlTable)("statuses", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    scopeType: (0, mysql_core_1.mysqlEnum)("scope_type", _shared_1.scopeTypes).notNull().default("list"),
    scopeId: (0, mysql_core_1.varchar)("scope_id", { length: _shared_1.ID_LENGTH }).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: _shared_1.SHORT_NAME_LENGTH }).notNull(),
    color: (0, mysql_core_1.char)("color", { length: _shared_1.HEX_COLOR_LENGTH })
        .notNull()
        .default("#94A3B8"),
    statusGroup: (0, mysql_core_1.mysqlEnum)("status_group", _shared_1.statusGroups).notNull(),
    position: (0, mysql_core_1.int)("position", { unsigned: true }).notNull().default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    scopeNameUq: (0, mysql_core_1.uniqueIndex)("uq_statuses_scope_name").on(t.scopeType, t.scopeId, t.name),
    scopeIdx: (0, mysql_core_1.index)("idx_statuses_scope").on(t.scopeType, t.scopeId, t.position),
    groupIdx: (0, mysql_core_1.index)("idx_statuses_group").on(t.statusGroup),
}));
// ─── tags ─ workspace-wide ────────────────────────────────────────────────────
exports.tags = (0, mysql_core_1.mysqlTable)("tags", {
    id: (0, mysql_core_1.varchar)("id", { length: _shared_1.ID_LENGTH }).primaryKey(),
    workspaceId: (0, mysql_core_1.varchar)("workspace_id", { length: _shared_1.ID_LENGTH })
        .notNull()
        .references(() => auth_1.workspaces.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
    }),
    name: (0, mysql_core_1.varchar)("name", { length: 60 }).notNull(),
    color: (0, mysql_core_1.char)("color", { length: _shared_1.HEX_COLOR_LENGTH })
        .notNull()
        .default("#94A3B8"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => ({
    workspaceNameUq: (0, mysql_core_1.uniqueIndex)("uq_tags_workspace_name").on(t.workspaceId, t.name),
}));
