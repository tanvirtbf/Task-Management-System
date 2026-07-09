// =============================================================================
// Templates domain — 1 table
//   templates — reusable task structures for "Apply template" feature
//
// Mirrors `database/schema.sql §32` 1:1. Per FINAL_REQUIREMENTS.md §5.18 any
// team can save reusable task templates with pre-built checklists.
// =============================================================================
import {
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
    templateTypes,
    timestampMs,
} from "./_shared";
import { workspaces, users } from "./auth";

export const templates = sqliteTable(
    "templates",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        type: text("type", { enum: templateTypes }).notNull().default("task"),
        name: ciText("name").notNull(),
        description: text("description"),
        icon: text("icon"),
        color: text("color"),
        // Structure is JSON — flexible per the type field. Holds checklist
        // items, default task type, tags, description, etc.
        structure: text("structure", { mode: "json" }).notNull(),
        usageCount: integer("usage_count")
            .notNull()
            .default(0),
        createdBy: text("created_by").notNull(),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
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
