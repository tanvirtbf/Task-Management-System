// =============================================================================
// Forms — public intake + submissions (3 tables)
//   forms, form_fields, form_submissions
//   Mirrors `database/schema.sql §26-28`.
// =============================================================================
import {
    bigint,
    boolean,
    foreignKey,
    index,
    int,
    json,
    mysqlEnum,
    mysqlTable,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/mysql-core";
import {
    ID_LENGTH,
    IP_LENGTH,
    NAME_LENGTH,
    EMAIL_LENGTH,
    formFieldKinds,
} from "./_shared";
import { users } from "./auth";
import { lists } from "./hierarchy";
import { tasks } from "./tasks";

export const forms = mysqlTable(
    "forms",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        listId: varchar("list_id", { length: ID_LENGTH })
            .notNull()
            .references(() => lists.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        title: varchar("title", { length: 200 }).notNull(),
        description: varchar("description", { length: 2000 }),
        isPublic: boolean("is_public").notNull().default(true),
        publicSlug: varchar("public_slug", { length: NAME_LENGTH }).notNull(),
        branding: json("branding").notNull().default({}),
        settings: json("settings").notNull().default({}),
        submissionCount: int("submission_count", { unsigned: true })
            .notNull()
            .default(0),
        createdBy: varchar("created_by", { length: ID_LENGTH }).notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    },
    (t) => ({
        publicSlugUq: uniqueIndex("uq_forms_public_slug").on(t.publicSlug),
        createdByFk: foreignKey({
            columns: [t.createdBy],
            foreignColumns: [users.id],
            name: "fk_forms_created_by",
        })
            .onDelete("restrict")
            .onUpdate("cascade"),
        listIdx: index("idx_forms_list").on(t.listId),
    }),
);

export const formFields = mysqlTable(
    "form_fields",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        formId: varchar("form_id", { length: ID_LENGTH })
            .notNull()
            .references(() => forms.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        fieldKind: mysqlEnum("field_kind", formFieldKinds).notNull(),
        fieldKey: varchar("field_key", { length: NAME_LENGTH }).notNull(),
        label: varchar("label", { length: 200 }).notNull(),
        helpText: varchar("help_text", { length: 500 }),
        placeholder: varchar("placeholder", { length: 200 }),
        isRequired: boolean("is_required").notNull().default(false),
        isHidden: boolean("is_hidden").notNull().default(false),
        defaultValue: json("default_value"),
        position: int("position", { unsigned: true }).notNull().default(0),
        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        formKeyUq: uniqueIndex("uq_form_fields_form_key").on(
            t.formId,
            t.fieldKind,
            t.fieldKey,
        ),
        formIdx: index("idx_form_fields_form").on(t.formId, t.position),
    }),
);

export const formSubmissions = mysqlTable(
    "form_submissions",
    {
        id: varchar("id", { length: ID_LENGTH }).primaryKey(),
        internalId: bigint("internal_id", { mode: "bigint", unsigned: true })
            .notNull()
            .autoincrement(),
        formId: varchar("form_id", { length: ID_LENGTH })
            .notNull()
            .references(() => forms.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        taskId: varchar("task_id", { length: ID_LENGTH }),
        submitterEmail: varchar("submitter_email", { length: EMAIL_LENGTH }),
        submitterIp: varchar("submitter_ip", { length: IP_LENGTH }),
        data: json("data").notNull(),
        submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    },
    (t) => ({
        internalIdUq: uniqueIndex("uq_form_submissions_internal_id").on(
            t.internalId,
        ),
        taskFk: foreignKey({
            columns: [t.taskId],
            foreignColumns: [tasks.id],
            name: "fk_form_submissions_task",
        })
            .onDelete("set null")
            .onUpdate("cascade"),
        formTimeIdx: index("idx_form_submissions_form_time").on(
            t.formId,
            t.submittedAt,
        ),
    }),
);

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;
export type FormField = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;
export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
