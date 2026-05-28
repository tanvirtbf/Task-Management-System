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
    boolean,
    foreignKey,
    index,
    int,
    json,
    mysqlEnum,
    mysqlTable,
    primaryKey,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import { char } from "drizzle-orm/mysql-core";
import {
    HEX_COLOR_LENGTH,
    ID_LENGTH,
    NAME_LENGTH,
    customFieldScopeTypes,
    customFieldTypes,
} from "./_shared";
import { workspaces, users } from "./auth";
import { tasks } from "./tasks";

export const customFields = mysqlTable(
    "custom_fields",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        workspaceId: varchar("workspace_id", { length: ID_LENGTH })
            .notNull()
            .references(() => workspaces.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        scopeType: mysqlEnum("scope_type", customFieldScopeTypes).notNull(),
        scopeId: varchar("scope_id", { length: ID_LENGTH }),
        name: varchar("name", { length: NAME_LENGTH }).notNull(),
        type: mysqlEnum("type", customFieldTypes).notNull(),
        config: json("config").notNull().default({}),
        isRequired: boolean("is_required").notNull().default(false),
        defaultValue: json("default_value"),
        position: int("position", { unsigned: true }).notNull().default(0),
        hiddenFromGuests: boolean("hidden_from_guests").notNull().default(false),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
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

export const customFieldOptions = mysqlTable(
    "custom_field_options",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        customFieldId: varchar("custom_field_id", { length: ID_LENGTH })
            .notNull()
            .references(() => customFields.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        label: varchar("label", { length: NAME_LENGTH }).notNull(),
        color: char("color", { length: HEX_COLOR_LENGTH })
            .notNull()
            .default("#94A3B8"),
        position: int("position", { unsigned: true }).notNull().default(0),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        fieldLabelUq: uniqueIndex("uq_cf_options_field_label").on(
            t.customFieldId,
            t.label,
        ),
        fieldIdx: index("idx_cf_options_field").on(t.customFieldId, t.position),
    }),
);

export const taskCustomFieldValues = mysqlTable(
    "task_custom_field_values",
    {
        taskId: varchar("task_id", { length: ID_LENGTH })
            .notNull()
            .references(() => tasks.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        customFieldId: varchar("custom_field_id", { length: ID_LENGTH })
            .notNull()
            .references(() => customFields.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        value: json("value").notNull(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
        updatedBy: varchar("updated_by", { length: ID_LENGTH }),
        // Generated VIRTUAL column — lets the dropdown-filter index work.
        optionIdGenerated: varchar("option_id_generated", { length: 64 })
            .generatedAlwaysAs(
                sql`JSON_UNQUOTE(JSON_EXTRACT(value, '$.option_id'))`,
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
