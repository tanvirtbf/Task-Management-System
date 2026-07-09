// =============================================================================
// Forms — public intake + submissions (3 tables)
//   forms, form_fields, form_submissions
//   Mirrors `database/schema.sql §26-28`.
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
    formFieldKinds,
    timestampMs,
} from "./_shared";
import { users } from "./auth";
import { lists } from "./hierarchy";
import { tasks } from "./tasks";

export const forms = sqliteTable(
    "forms",
    {
        id: text("id").primaryKey(),
        listId: text("list_id")
            .notNull()
            .references(() => lists.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        title: text("title").notNull(),
        description: text("description"),
        isPublic: integer("is_public", { mode: "boolean" })
            .notNull()
            .default(true),
        publicSlug: ciText("public_slug").notNull(),
        branding: text("branding", { mode: "json" }).notNull().default({}),
        settings: text("settings", { mode: "json" }).notNull().default({}),
        submissionCount: integer("submission_count")
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

export const formFields = sqliteTable(
    "form_fields",
    {
        id: text("id").primaryKey(),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        fieldKind: text("field_kind", { enum: formFieldKinds }).notNull(),
        fieldKey: text("field_key").notNull(),
        label: text("label").notNull(),
        helpText: text("help_text"),
        placeholder: text("placeholder"),
        isRequired: integer("is_required", { mode: "boolean" })
            .notNull()
            .default(false),
        isHidden: integer("is_hidden", { mode: "boolean" })
            .notNull()
            .default(false),
        defaultValue: text("default_value", { mode: "json" }),
        position: integer("position").notNull().default(0),
        createdAt: timestampMs("created_at").notNull().default(NOW_MS),
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

export const formSubmissions = sqliteTable(
    "form_submissions",
    {
        id: text("id").notNull().unique(),
        internalId: integer("internal_id", { mode: "number" }).primaryKey({
            autoIncrement: true,
        }),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, {
                onDelete: "cascade",
                onUpdate: "cascade",
            }),
        taskId: text("task_id"),
        submitterEmail: text("submitter_email"),
        submitterIp: text("submitter_ip"),
        data: text("data", { mode: "json" }).notNull(),
        encryptedAt: timestampMs("encrypted_at"),
        expiresAt: timestampMs("expires_at"),
        submittedAt: timestampMs("submitted_at").notNull().default(NOW_MS),
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
        expiresAtIdx: index("idx_form_submissions_expires_at").on(t.expiresAt),
    }),
);

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;
export type FormField = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;
export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
