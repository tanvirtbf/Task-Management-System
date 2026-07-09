// =============================================================================
// Custom fields domain — 3 tables
//   custom_fields, custom_field_options, task_custom_field_values
//   Mirrors `database/schema.sql §25-27`.
//
// `task_custom_field_values.option_id_generated` (VIRTUAL generated column on
// the JSON value) is included so the index `idx_tcfv_option` works for
// "filter tasks where Source = Facebook" queries.
// =============================================================================
import { sql } from "drizzle-orm";
import {
    foreignKey,
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
    NOW_MS,
    customFieldScopeTypes,
    customFieldTypes,
    timestampMs,
} from "./_shared";
import { workspaces, users } from "./auth";
import { tasks } from "./tasks";

export const customFields = sqliteTable(
    "custom_fields",
    {
        id: text("id").primaryKey(),
        workspaceId: text("workspace_id")
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        scopeType: text("scope_type", { enum: customFieldScopeTypes }).notNull(),
        scopeId: text("scope_id"),
        name: text("name").notNull(),
        type: text("type", { enum: customFieldTypes }).notNull(),
        config: text("config", { mode: "json" }).notNull().default({}),
        isRequired: integer("is_required", { mode: "boolean" })
            .notNull()
            .default(false),
        defaultValue: text("default_value", { mode: "json" }),
        position: integer("position").notNull().default(0),
        hiddenFromGuests: integer("hidden_from_guests", { mode: "boolean" })
            .notNull()
            .default(false),
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
            name: "fk_custom_fields_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        scopeIdx: index("idx_custom_fields_scope").on(
            t.scopeType,
            t.scopeId,
            t.position,
        ),
        workspaceIdx: index("idx_custom_fields_workspace").on(t.workspaceId),
    }),
);

export const customFieldOptions = sqliteTable(
    "custom_field_options",
    {
        id: text("id").primaryKey(),
        customFieldId: text("custom_field_id")
            .notNull()
            .references(() => customFields.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        label: text("label").notNull(),
        color: text("color")
            .notNull()
            .default("#94A3B8"),
        position: integer("position").notNull().default(0),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
    },
    (t) => ({
        fieldLabelUq: uniqueIndex("uq_cf_options_field_label").on(
            t.customFieldId,
            t.label,
        ),
        fieldIdx: index("idx_cf_options_field").on(t.customFieldId, t.position),
    }),
);

export const taskCustomFieldValues = sqliteTable(
    "task_custom_field_values",
    {
        taskId: text("task_id")
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        customFieldId: text("custom_field_id")
            .notNull()
            .references(() => customFields.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        value: text("value", { mode: "json" }).notNull(),
        updatedAt: timestampMs("updated_at")
            .notNull()
            .default(NOW_MS)
            .$onUpdate(() => new Date()),
        updatedBy: text("updated_by"),
        // Generated VIRTUAL column — lets the dropdown-filter index work.
        optionIdGenerated: text("option_id_generated")
            .generatedAlwaysAs(
                sql`json_extract(value, '$.option_id')`,
                { mode: "virtual" },
            ),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.taskId, t.customFieldId] }),
        updatedByFk: foreignKey({
            columns: [t.updatedBy],
            foreignColumns: [users.id],
            name: "fk_tcfv_updated_by",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        fieldIdx: index("idx_tcfv_field").on(t.customFieldId),
        optionIdx: index("idx_tcfv_option").on(
            t.customFieldId,
            t.optionIdGenerated,
        ),
    }),
);

export type CustomField = typeof customFields.$inferSelect;
export type NewCustomField = typeof customFields.$inferInsert;
export type CustomFieldOption = typeof customFieldOptions.$inferSelect;
export type NewCustomFieldOption = typeof customFieldOptions.$inferInsert;
export type TaskCustomFieldValue = typeof taskCustomFieldValues.$inferSelect;
export type NewTaskCustomFieldValue = typeof taskCustomFieldValues.$inferInsert;
