import type {
    Form as FormRow,
    FormField as FormFieldRow,
    FormSubmission as FormSubmissionRow,
} from "../db/schema";

/**
 * Wire serializers for §18 Forms (snake_case per the contract). `branding` /
 * `settings` are opaque JSON blobs emitted as-is. `Form` carries its `fields`
 * inline (the §18 #3 / admin shape). The public projection strips internal ids
 * and exposes only what an anonymous submitter needs.
 *
 * Single source for the Form/FormField/FormSubmission response shapes — the same
 * role `taskSerializer` plays for tasks.
 */

export interface WireFormField {
    id: string;
    field_kind: FormFieldRow["fieldKind"];
    field_key: string;
    label: string;
    help_text: string | null;
    placeholder: string | null;
    is_required: boolean;
    is_hidden: boolean;
    default_value: unknown;
    position: number;
}

export const toWireFormField = (f: FormFieldRow): WireFormField => ({
    id: f.id,
    field_kind: f.fieldKind,
    field_key: f.fieldKey,
    label: f.label,
    help_text: f.helpText,
    placeholder: f.placeholder,
    is_required: f.isRequired,
    is_hidden: f.isHidden,
    default_value: f.defaultValue ?? null,
    position: f.position,
});

export interface WireForm {
    id: string;
    list_id: string;
    title: string;
    description: string | null;
    public_slug: string;
    is_public: boolean;
    branding: unknown;
    settings: unknown;
    submission_count: number;
    fields: WireFormField[];
    created_at: string;
}

export const toWireForm = (f: FormRow, fields: FormFieldRow[]): WireForm => ({
    id: f.id,
    list_id: f.listId,
    title: f.title,
    description: f.description,
    public_slug: f.publicSlug,
    is_public: f.isPublic,
    branding: f.branding,
    settings: f.settings,
    submission_count: f.submissionCount,
    fields: fields.map(toWireFormField),
    created_at: f.createdAt.toISOString(),
});

export interface WireFormSubmission {
    id: string;
    form_id: string;
    task_id: string | null;
    submitter_email: string | null;
    data: unknown;
    submitted_at: string;
}

export const toWireFormSubmission = (
    s: FormSubmissionRow,
): WireFormSubmission => ({
    id: s.id,
    form_id: s.formId,
    task_id: s.taskId,
    submitter_email: s.submitterEmail,
    data: s.data,
    submitted_at: s.submittedAt.toISOString(),
});

/** A public-form field — no internal `id`, hidden fields are omitted upstream. */
export interface PublicFormField {
    field_kind: FormFieldRow["fieldKind"];
    field_key: string;
    label: string;
    help_text: string | null;
    placeholder: string | null;
    is_required: boolean;
    default_value: unknown;
    position: number;
}

export interface PublicForm {
    title: string;
    description: string | null;
    public_slug: string;
    branding: unknown;
    success_message: string | null;
    fields: PublicFormField[];
}

/**
 * Public-safe projection (§18 GET /public/forms/:slug): omits internal ids
 * (form id, list id, field ids), `is_public`, `submission_count`, and all of
 * `settings` except `success_message`. Hidden fields are dropped entirely.
 */
export const toPublicForm = (f: FormRow, fields: FormFieldRow[]): PublicForm => {
    const settings = (f.settings ?? {}) as { success_message?: unknown };
    const successMessage =
        typeof settings.success_message === "string"
            ? settings.success_message
            : null;
    return {
        title: f.title,
        description: f.description,
        public_slug: f.publicSlug,
        branding: f.branding,
        success_message: successMessage,
        fields: fields
            .filter((x) => !x.isHidden)
            .map((x) => ({
                field_kind: x.fieldKind,
                field_key: x.fieldKey,
                label: x.label,
                help_text: x.helpText,
                placeholder: x.placeholder,
                is_required: x.isRequired,
                default_value: x.defaultValue ?? null,
                position: x.position,
            })),
    };
};
