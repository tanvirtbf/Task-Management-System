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

/** A dropdown option exposed on a public form (no internal field id). */
export interface PublicFormFieldOption {
    id: string;
    label: string;
    color: string;
}

/** Curated, public-safe slice of a custom field's `config` (no secrets). */
export interface PublicFormFieldConfig {
    currency?: string;
    precision?: number;
    include_time?: boolean;
}

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
    /**
     * Enrichment so the ANONYMOUS page can render the right control and submit
     * the right value envelope. `null` for `task_attr` fields (rendered as plain
     * text). For `custom_field`: the field's type (text/phone/money/date/
     * dropdown/files), its dropdown `options`, and a curated `config`.
     */
    value_type: string | null;
    options: PublicFormFieldOption[] | null;
    config: PublicFormFieldConfig | null;
}

/** Per-field-key enrichment the service passes into `toPublicForm`. */
export interface PublicFormEnrichment {
    typeByKey: Map<string, string>;
    configByKey: Map<string, Record<string, unknown>>;
    optionsByKey: Map<string, PublicFormFieldOption[]>;
}

export interface PublicForm {
    title: string;
    description: string | null;
    public_slug: string;
    branding: unknown;
    success_message: string | null;
    fields: PublicFormField[];
}

const curateConfig = (
    raw: Record<string, unknown> | undefined,
): PublicFormFieldConfig | null => {
    if (!raw) return null;
    const c: PublicFormFieldConfig = {};
    if (typeof raw.currency === "string") c.currency = raw.currency;
    if (typeof raw.precision === "number") c.precision = raw.precision;
    if (typeof raw.include_time === "boolean") c.include_time = raw.include_time;
    return Object.keys(c).length > 0 ? c : null;
};

/**
 * Public-safe projection (§18 GET /public/forms/:slug): omits internal ids
 * (form id, list id, field ids), `is_public`, `submission_count`, and all of
 * `settings` except `success_message`. Hidden fields are dropped entirely.
 * `enrich` (optional) carries per-custom-field type/options/config so the
 * anonymous page can render typed controls (dropdown, date, money) and submit
 * the matching value envelope.
 */
export const toPublicForm = (
    f: FormRow,
    fields: FormFieldRow[],
    enrich?: PublicFormEnrichment,
): PublicForm => {
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
            .map((x) => {
                const isCustom = x.fieldKind === "custom_field";
                const valueType = isCustom
                    ? (enrich?.typeByKey.get(x.fieldKey) ?? null)
                    : null;
                const options =
                    valueType === "dropdown"
                        ? (enrich?.optionsByKey.get(x.fieldKey) ?? [])
                        : null;
                const config = isCustom
                    ? curateConfig(enrich?.configByKey.get(x.fieldKey))
                    : null;
                return {
                    field_kind: x.fieldKind,
                    field_key: x.fieldKey,
                    label: x.label,
                    help_text: x.helpText,
                    placeholder: x.placeholder,
                    is_required: x.isRequired,
                    default_value: x.defaultValue ?? null,
                    position: x.position,
                    value_type: valueType,
                    options,
                    config,
                };
            }),
    };
};
