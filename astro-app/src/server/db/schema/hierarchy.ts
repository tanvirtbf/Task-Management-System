// =============================================================================
// Hierarchy domain — 5 tables
//   spaces, lists, task_types, statuses, tags
//
// Mirrors `database/schema.sql §6-10` 1:1.
// =============================================================================
import { sql } from "drizzle-orm";
import {
    check,
    foreignKey,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
    NOW_MS,
    ciText,
    scopeTypes,
    statusGroups,
    timestampMs,
} from "./_shared";
import { workspaces, users } from "./auth";

// ─── spaces ───────────────────────────────────────────────────────────────────
export const spaces = sqliteTable(
    "spaces",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: ciText("name").notNull(),
        description: text("description"),
        icon: text("icon").notNull().default("Folder"),
        color: text("color")
            .notNull()
            .default("#4F46E5"),
        isPrivate: integer("is_private", { mode: "boolean" })
            .notNull()
            .default(false),
        position: integer("position").notNull().default(0),
        archivedAt: timestampMs("archived_at"),
        createdBy: text("created_by").notNull(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
    },
    (t) => ({
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_spaces_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        workspaceArchivedIdx: index("idx_spaces_workspace_archived").on(
            t.workspaceId,
            t.archivedAt,
            t.position,
        ),
        // conv: MySQL REGEXP '^#[0-9A-Fa-f]{6}$' → SQLite GLOB (whole-string match)
        colorCk: check(
            "ck_spaces_color",
            sql`${t.color} GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'`,
        ),
    }),
);

// ─── task_types ───────────────────────────────────────────────────────────────
// Declared before `lists` because lists.default_task_type_id references it.
export const taskTypes = sqliteTable(
    "task_types",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: ciText("name").notNull(),
        description: text("description"),
        icon: text("icon").notNull().default("CheckSquare"),
        color: text("color")
            .notNull()
            .default("#6B7280"),
        isMilestoneType: integer("is_milestone_type", { mode: "boolean" })
            .notNull()
            .default(false),
        isSystem: integer("is_system", { mode: "boolean" })
            .notNull()
            .default(false),
        isDevType: integer("is_dev_type", { mode: "boolean" })
            .notNull()
            .default(false),
        position: integer("position").notNull().default(0),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
export const lists = sqliteTable(
    "lists",
    {
        id: text("id").primaryKey(),
        spaceId: text("space_id")
            .notNull()
            .references(() => spaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: ciText("name").notNull(),
        description: text("description"),
        icon: text("icon").notNull().default("ListChecks"),
        color: text("color")
            .notNull()
            .default("#4F46E5"),
        position: integer("position").notNull().default(0),
        defaultTaskTypeId: text("default_task_type_id"),
        isPrivate: integer("is_private", { mode: "boolean" })
            .notNull()
            .default(false),
        archivedAt: timestampMs("archived_at"),
        createdBy: text("created_by").notNull(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
export const statuses = sqliteTable(
    "statuses",
    {
        id: text("id").primaryKey(),
        scopeType: text("scope_type", { enum: scopeTypes })
            .notNull()
            .default("list"),
        scopeId: text("scope_id").notNull(),
        name: ciText("name").notNull(),
        color: text("color")
            .notNull()
            .default("#94A3B8"),
        statusGroup: text("status_group", { enum: statusGroups }).notNull(),
        position: integer("position").notNull().default(0),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
export const tags = sqliteTable(
    "tags",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        name: ciText("name").notNull(),
        color: text("color")
            .notNull()
            .default("#94A3B8"),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
