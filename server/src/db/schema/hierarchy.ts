// =============================================================================
// Hierarchy domain — 5 tables
//   spaces, lists, task_types, statuses, tags
//
// Mirrors `database/schema.sql §6-10` 1:1.
// =============================================================================
import { sql } from "drizzle-orm";
import {
    boolean,
    char,
    check,
    foreignKey,
    index,
    int,
    mysqlEnum,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    HEX_COLOR_LENGTH,
    ID_LENGTH,
    NAME_LENGTH,
    SHORT_NAME_LENGTH,
    scopeTypes,
    statusGroups,
} from "./_shared";
import { workspaces, users } from "./auth";

// ─── spaces ───────────────────────────────────────────────────────────────────
export const spaces = mysqlTable(
    "spaces",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: varchar("name", { length: NAME_LENGTH }).notNull(),
        description: varchar("description", { length: 500 }),
        icon: varchar("icon", { length: 64 }).notNull().default("Folder"),
        color: char("color", { length: HEX_COLOR_LENGTH })
            .notNull()
            .default("#4F46E5"),
        isPrivate: boolean("is_private").notNull().default(false),
        /** Department head (Dept Review V1) — nullable; app clears it on user deactivation. */
        headUserId: varchar("head_user_id", { length: ID_LENGTH }),
        position: int("position", { unsigned: true }).notNull().default(0),
        archivedAt: timestamp("archived_at"),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_spaces_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        headFk: foreignKey({
            columns: [t.headUserId],
            foreignColumns: [users.id],
            name: "fk_spaces_head",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        /** F27 (ISS-033): two spaces called "Marketing" rendered identically
         *  in the sidebar. Case-insensitive via the column collation, like the
         *  catalog resources that already got this right. */
        workspaceNameUq: uniqueIndex("uq_spaces_workspace_name").on(
            t.workspaceId,
            t.name,
        ),
        headIdx: index("idx_spaces_head").on(t.headUserId),
        workspaceArchivedIdx: index("idx_spaces_workspace_archived").on(
            t.workspaceId,
            t.archivedAt,
            t.position,
        ),
        colorCk: check("ck_spaces_color", sql`${t.color} REGEXP '^#[0-9A-Fa-f]{6}$'`),
    }),
);

// ─── task_types ───────────────────────────────────────────────────────────────
// Declared before `lists` because lists.default_task_type_id references it.
export const taskTypes = mysqlTable(
    "task_types",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: varchar("name", { length: SHORT_NAME_LENGTH }).notNull(),
        description: varchar("description", { length: 300 }),
        icon: varchar("icon", { length: 64 }).notNull().default("CheckSquare"),
        color: char("color", { length: HEX_COLOR_LENGTH })
            .notNull()
            .default("#6B7280"),
        isMilestoneType: boolean("is_milestone_type").notNull().default(false),
        isSystem: boolean("is_system").notNull().default(false),
        isDevType: boolean("is_dev_type").notNull().default(false),
        position: int("position", { unsigned: true }).notNull().default(0),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        workspaceNameUq: uniqueIndex("uq_task_types_workspace_name").on(
            t.workspaceId,
            t.name,
        ),
        workspaceIdx: index("idx_task_types_workspace").on(t.workspaceId, t.position),
    }),
);

// ─── lists ────────────────────────────────────────────────────────────────────
export const lists = mysqlTable(
    "lists",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        spaceId: varchar("space_id", { length: ID_LENGTH })
            .notNull()
            .references(() => spaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: varchar("name", { length: NAME_LENGTH }).notNull(),
        description: varchar("description", { length: 500 }),
        icon: varchar("icon", { length: 64 }).notNull().default("ListChecks"),
        color: char("color", { length: HEX_COLOR_LENGTH })
            .notNull()
            .default("#4F46E5"),
        position: int("position", { unsigned: true }).notNull().default(0),
        defaultTaskTypeId: varchar("default_task_type_id", { length: ID_LENGTH }),
        isPrivate: boolean("is_private").notNull().default(false),
        archivedAt: timestamp("archived_at"),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_lists_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        defaultTaskTypeFk: foreignKey({
            columns: [t.defaultTaskTypeId],
            foreignColumns: [taskTypes.id],
            name: "fk_lists_default_task_type",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        /** F27 (ISS-035): the same trap one level deeper in the tree. */
        spaceNameUq: uniqueIndex("uq_lists_space_name").on(t.spaceId, t.name),
        spaceArchivedIdx: index("idx_lists_space_archived").on(
            t.spaceId,
            t.archivedAt,
            t.position,
        ),
        defaultTaskTypeIdx: index("idx_lists_default_task_type").on(
            t.defaultTaskTypeId,
        ),
    }),
);

// ─── statuses ─ polymorphic scope (list or space); app validates ──────────────
export const statuses = mysqlTable(
    "statuses",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        scopeType: mysqlEnum("scope_type", scopeTypes).notNull().default("list"),
        scopeId: varchar("scope_id", { length: ID_LENGTH }).notNull(),
        name: varchar("name", { length: SHORT_NAME_LENGTH }).notNull(),
        color: char("color", { length: HEX_COLOR_LENGTH })
            .notNull()
            .default("#94A3B8"),
        statusGroup: mysqlEnum("status_group", statusGroups).notNull(),
        position: int("position", { unsigned: true }).notNull().default(0),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        scopeNameUq: uniqueIndex("uq_statuses_scope_name").on(
            t.scopeType,
            t.scopeId,
            t.name,
        ),
        scopeIdx: index("idx_statuses_scope").on(
            t.scopeType,
            t.scopeId,
            t.position,
        ),
        groupIdx: index("idx_statuses_group").on(t.statusGroup),
    }),
);

// ─── tags ─ workspace-wide ────────────────────────────────────────────────────
export const tags = mysqlTable(
    "tags",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: varchar("name", { length: 60 }).notNull(),
        color: char("color", { length: HEX_COLOR_LENGTH })
            .notNull()
            .default("#94A3B8"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        workspaceNameUq: uniqueIndex("uq_tags_workspace_name").on(
            t.workspaceId,
            t.name,
        ),
    }),
);


export type Space = typeof spaces.$inferSelect;
export type NewSpace = typeof spaces.$inferInsert;
export type TaskType = typeof taskTypes.$inferSelect;
export type NewTaskType = typeof taskTypes.$inferInsert;
export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;
export type Status = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
