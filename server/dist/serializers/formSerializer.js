"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPublicForm = exports.toWireFormSubmission = exports.toWireForm = exports.toWireFormField = void 0;
const toWireFormField = (f) => ({
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
exports.toWireFormField = toWireFormField;
const toWireForm = (f, fields) => ({
    id: f.id,
    list_id: f.listId,
    title: f.title,
    description: f.description,
    public_slug: f.publicSlug,
    is_public: f.isPublic,
    branding: f.branding,
    settings: f.settings,
    submission_count: f.submissionCount,
    fields: fields.map(exports.toWireFormField),
    created_at: f.createdAt.toISOString(),
});
exports.toWireForm = toWireForm;
const toWireFormSubmission = (s) => ({
    id: s.id,
    form_id: s.formId,
    task_id: s.taskId,
    submitter_email: s.submitterEmail,
    data: s.data,
    submitted_at: s.submittedAt.toISOString(),
});
exports.toWireFormSubmission = toWireFormSubmission;
const curateConfig = (raw) => {
    if (!raw)
        return null;
    const c = {};
    if (typeof raw.currency === "string")
        c.currency = raw.currency;
    if (typeof raw.precision === "number")
        c.precision = raw.precision;
    if (typeof raw.include_time === "boolean")
        c.include_time = raw.include_time;
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
const toPublicForm = (f, fields, enrich) => {
    const settings = (f.settings ?? {});
    const successMessage = typeof settings.success_message === "string"
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
            const options = valueType === "dropdown"
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
exports.toPublicForm = toPublicForm;
