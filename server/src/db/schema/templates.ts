// =============================================================================
// Templates domain — 1 table
//   templates — reusable task structures for "Apply template" feature
//
// Mirrors `database/schema.sql §32` 1:1. Per FINAL_REQUIREMENTS.md §5.18 any
// team can save reusable task templates with pre-built checklists.
// =============================================================================
import {
    char,
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
import {
    HEX_COLOR_LENGTH,
    ID_LENGTH,
    NAME_LENGTH,
    templateTypes,
} from "./_shared";
import { workspaces, users } from "./auth";

export const templates = mysqlTable(
    "templates",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: mysqlEnum("type", templateTypes).notNull().default("task"),
        name: varchar("name", { length: NAME_LENGTH }).notNull(),
        description: text("description"),
        icon: varchar("icon", { length: 60 }),
        color: char("color", { length: HEX_COLOR_LENGTH }),
        // Structure is JSON — flexible per the type field. Holds checklist
        // items, default task type, tags, description, etc.
        structure: json("structure").notNull(),
        usageCount: int("usage_count", { unsigned: true })
            .notNull()
            .default(0),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at")
            .notNull()
            .defaultNow()
            .onUpdateNow(),
    },
    (t) => ({
        workspaceNameUq: uniqueIndex("uq_templates_workspace_name").on(
            t.workspaceId,
            t.name,
        ),
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_templates_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        workspaceTypeIdx: index("idx_templates_workspace_type").on(
            t.workspaceId,
            t.type,
        ),
    }),
);

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
