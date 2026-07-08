import { MySql2Database } from "drizzle-orm/mysql2";
import type { Logger } from "winston";
import * as schema from "../db/schema";
import type { Form, FormField, NewForm, NewFormField } from "../db/schema";
import { AppError, type ErrorDetail } from "../errors";
import { fakeId, randomToken } from "../utils";
import { encryptJSON } from "../utils/encryption";
import { Roles } from "../constants";
import type { FormsRepo } from "../repositories/FormsRepo";
import type { FormFieldsRepo } from "../repositories/FormFieldsRepo";
import type { FormSubmissionsRepo } from "../repositories/FormSubmissionsRepo";
import type { CustomFieldsRepo } from "../repositories/CustomFieldsRepo";
import type { ListsRepo } from "../repositories/ListsRepo";
import type { NotificationsRepo } from "../repositories/NotificationsRepo";
import type { TaskWriteService } from "./TaskWriteService";
import {
    toWireForm,
    toWireFormField,
    toWireFormSubmission,
    toPublicForm,
    type WireForm,
    type WireFormField,
    type WireFormSubmission,
    type PublicForm,
} from "../serializers/formSerializer";

/**
 * §18 Forms domain logic. Owns workspace isolation (forms have no
 * `workspace_id` — scoped via the list→space join in the repo), slug
 * generation, the field CRUD/reorder, and the public submit (validate → create
 * a task via `TaskWriteService` → record the submission + fire the
 * `form_submitted` notification). Forms CRUD does NOT write `workspace_activity`
 * — the enum has no `form` entity type (a deliberate skip, not an omission).
 */

const SUBMISSIONS_DEFAULT_LIMIT = 50;
const SUBMISSIONS_MAX_LIMIT = 100;
const SLUG_MAX_RETRIES = 5;

/** Task columns a `task_attr` form field may target (§18 Q-I whitelist). */
const TASK_ATTR_KEYS = new Set([
    "name",
    "description",
    "priority",
    "due_date",
    "start_date",
]);

const isDuplicateKeyError = (err: unknown): boolean => {
    const e = err as { code?: string; errno?: number } | null;
    return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
};

const slugify = (title: string): string => {
    const base = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return base.length > 0 ? base : "form";
};

/** A real `YYYY-MM-DD` calendar date — correct format AND no month/day overflow. */
const isValidYmd = (s: string): boolean => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(y, mo - 1, d);
    return (
        dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
    );
};

/**
 * Validate (and coerce) a submitted `task_attr` value against the same rules the
 * HTTP task validator enforces — which the PUBLIC submit path bypasses, so
 * without this an out-of-range priority trips the `ck_tasks_priority` CHECK
 * (raw 500) and a malformed date is silently stored corrupt. Returns the
 * normalised value, or an `issue` string for a 422. `name`/`description` are
 * free text.
 */
const normalizeTaskAttr = (
    key: string,
    value: unknown,
): { value: unknown; issue?: string } => {
    switch (key) {
        case "priority": {
            const n =
                typeof value === "number"
                    ? value
                    : typeof value === "string"
                      ? Number(value.trim())
                      : NaN;
            return Number.isInteger(n) && n >= 0 && n <= 4
                ? { value: n }
                : { value, issue: "priority must be an integer 0–4" };
        }
        case "due_date":
        case "start_date":
            return typeof value === "string" && isValidYmd(value)
                ? { value }
                : { value, issue: "must be a YYYY-MM-DD date" };
        case "name":
            // tasks.name is VARCHAR(500); a longer value 500s on insert.
            return typeof value !== "string" || value.length <= 500
                ? { value }
                : { value, issue: "name must be at most 500 characters" };
        default:
            return { value };
    }
};

export interface CreateFormInput {
    workspaceId: string;
    actorId: string;
    listId: string;
    title: string;
    description?: string | null;
    isPublic?: boolean;
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
    publicSlug?: string;
}

export interface UpdateFormInput {
    workspaceId: string;
    formId: string;
    fields: string[];
    title?: string;
    description?: string | null;
    isPublic?: boolean;
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
    publicSlug?: string;
}

export interface AddFieldInput {
    workspaceId: string;
    formId: string;
    fieldKind: FormField["fieldKind"];
    fieldKey: string;
    label: string;
    isRequired?: boolean;
    isHidden?: boolean;
    position?: number;
    placeholder?: string | null;
    helpText?: string | null;
    defaultValue?: unknown;
}

export interface UpdateFieldInput {
    workspaceId: string;
    fieldId: string;
    label?: string;
    isRequired?: boolean;
    isHidden?: boolean;
    placeholder?: string | null;
    helpText?: string | null;
    defaultValue?: unknown;
}

export interface ReorderInput {
    workspaceId: string;
    formId: string;
    items: { id: string; position: number }[];
}

export interface ListSubmissionsInput {
    workspaceId: string;
    formId: string;
    cursor?: string;
    limit?: number;
}

export interface SubmitInput {
    slug: string;
    data: Record<string, unknown>;
    ip: string | null;
}

export interface SubmitResult {
    submission_id: string;
    task_id: string;
    message: string;
}

export class FormsService {
    constructor(
        private db: MySql2Database<typeof schema>,
        private forms: FormsRepo,
        private fields: FormFieldsRepo,
        private submissions: FormSubmissionsRepo,
        private customFields: CustomFieldsRepo,
        private lists: ListsRepo,
        private taskWrites: TaskWriteService,
        private notifications: NotificationsRepo,
        private logger: Logger,
    ) {}

    // ─── reads ────────────────────────────────────────────────────────────────

    async list(workspaceId: string): Promise<WireForm[]> {
        const rows = await this.forms.listByWorkspace(workspaceId);
        return Promise.all(rows.map((f) => this.hydrate(f)));
    }

    async listByList(listId: string, workspaceId: string): Promise<WireForm[]> {
        const list = await this.lists.findByIdInWorkspace(listId, workspaceId);
        if (!list) {
            throw AppError.notFound(
                "list.not_found",
                `List ${listId} does not exist`,
            );
        }
        const rows = await this.forms.listByList(listId, workspaceId);
        return Promise.all(rows.map((f) => this.hydrate(f)));
    }

    async get(formId: string, workspaceId: string): Promise<WireForm> {
        const form = await this.requireForm(formId, workspaceId);
        return this.hydrate(form);
    }

    // ─── form CRUD ──────────────────────────────────────────────────────────────

    async create(input: CreateFormInput): Promise<WireForm> {
        const list = await this.lists.findRecordByIdInWorkspace(
            input.listId,
            input.workspaceId,
        );
        if (!list) {
            throw AppError.notFound(
                "list.not_found",
                `List ${input.listId} does not exist`,
            );
        }
        if (list.archivedAt) {
            throw AppError.conflict(
                "list.archived",
                "Cannot create a form on an archived list",
            );
        }

        const id = fakeId("frm");
        const explicitSlug = input.publicSlug?.trim();
        if (explicitSlug && (await this.forms.slugExists(explicitSlug))) {
            throw AppError.conflict(
                "form.slug_taken",
                "That public slug is already in use",
            );
        }

        for (let attempt = 1; ; attempt += 1) {
            const slug =
                explicitSlug ?? `${slugify(input.title)}-${randomToken(6)}`;
            const row: NewForm = {
                id,
                listId: input.listId,
                title: input.title,
                description: input.description ?? null,
                publicSlug: slug,
                branding: input.branding ?? {},
                settings: input.settings ?? {},
                createdBy: input.actorId,
                // Omitted → DB default TRUE (forms are public intake by default).
                ...(input.isPublic !== undefined
                    ? { isPublic: input.isPublic }
                    : {}),
            };
            try {
                await this.forms.insert(row);
                break;
            } catch (err) {
                // An explicit slug collision is a 409; a generated-slug collision
                // is retried with a fresh suffix.
                if (isDuplicateKeyError(err)) {
                    if (explicitSlug) {
                        throw AppError.conflict(
                            "form.slug_taken",
                            "That public slug is already in use",
                        );
                    }
                    if (attempt < SLUG_MAX_RETRIES) continue;
                }
                throw err;
            }
        }

        const created = await this.forms.findByIdInWorkspace(
            id,
            input.workspaceId,
        );
        if (!created) throw AppError.internal("Form could not be loaded");
        return this.hydrate(created);
    }

    async update(input: UpdateFormInput): Promise<WireForm> {
        await this.requireForm(input.formId, input.workspaceId);

        if (input.publicSlug !== undefined) {
            const slug = input.publicSlug.trim();
            if (await this.forms.slugExists(slug)) {
                const owner = await this.forms.resolveBySlug(slug);
                if (owner && owner.form.id !== input.formId) {
                    throw AppError.conflict(
                        "form.slug_taken",
                        "That public slug is already in use",
                    );
                }
            }
        }

        const patch: Partial<Omit<NewForm, "id" | "submissionCount">> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined)
            patch.description = input.description;
        if (input.isPublic !== undefined) patch.isPublic = input.isPublic;
        if (input.settings !== undefined) patch.settings = input.settings;
        if (input.branding !== undefined) patch.branding = input.branding;
        if (input.publicSlug !== undefined)
            patch.publicSlug = input.publicSlug.trim();

        try {
            await this.forms.update(input.formId, patch);
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "form.slug_taken",
                    "That public slug is already in use",
                );
            }
            throw err;
        }

        const updated = await this.forms.findByIdInWorkspace(
            input.formId,
            input.workspaceId,
        );
        if (!updated) {
            throw AppError.notFound(
                "form.not_found",
                `Form ${input.formId} does not exist`,
            );
        }
        return this.hydrate(updated);
    }

    async delete(formId: string, workspaceId: string): Promise<void> {
        await this.requireForm(formId, workspaceId);
        // FK cascade tears down form_fields + form_submissions; created tasks
        // survive (submission→task FK is SET NULL the other way).
        await this.forms.hardDelete(formId);
    }

    // ─── field CRUD + reorder ────────────────────────────────────────────────────

    async addField(input: AddFieldInput): Promise<WireFormField> {
        await this.requireForm(input.formId, input.workspaceId);
        await this.validateFieldKey(
            input.fieldKind,
            input.fieldKey,
            input.workspaceId,
        );

        const id = fakeId("ffld");
        const position =
            input.position ?? (await this.fields.nextPosition(input.formId));
        const row: NewFormField = {
            id,
            formId: input.formId,
            fieldKind: input.fieldKind,
            fieldKey: input.fieldKey,
            label: input.label,
            helpText: input.helpText ?? null,
            placeholder: input.placeholder ?? null,
            isRequired: input.isRequired ?? false,
            isHidden: input.isHidden ?? false,
            defaultValue: input.defaultValue ?? null,
            position,
        };
        try {
            await this.fields.insert(row);
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw AppError.conflict(
                    "form_field.duplicate",
                    "This field is already on the form",
                );
            }
            throw err;
        }

        const field = await this.fields.findByIdInWorkspace(
            id,
            input.workspaceId,
        );
        if (!field) throw AppError.internal("Field could not be loaded");
        return toWireFormField(field);
    }

    async updateField(input: UpdateFieldInput): Promise<WireFormField> {
        const existing = await this.fields.findByIdInWorkspace(
            input.fieldId,
            input.workspaceId,
        );
        if (!existing) {
            throw AppError.notFound(
                "form_field.not_found",
                `Field ${input.fieldId} does not exist`,
            );
        }

        const patch: Partial<Omit<NewFormField, "id" | "formId">> = {};
        if (input.label !== undefined) patch.label = input.label;
        if (input.isRequired !== undefined) patch.isRequired = input.isRequired;
        if (input.isHidden !== undefined) patch.isHidden = input.isHidden;
        if (input.placeholder !== undefined)
            patch.placeholder = input.placeholder;
        if (input.helpText !== undefined) patch.helpText = input.helpText;
        if (input.defaultValue !== undefined)
            patch.defaultValue = input.defaultValue;

        await this.fields.update(input.fieldId, patch);

        const updated = await this.fields.findByIdInWorkspace(
            input.fieldId,
            input.workspaceId,
        );
        if (!updated) {
            throw AppError.notFound(
                "form_field.not_found",
                `Field ${input.fieldId} does not exist`,
            );
        }
        return toWireFormField(updated);
    }

    async deleteField(fieldId: string, workspaceId: string): Promise<void> {
        const existing = await this.fields.findByIdInWorkspace(
            fieldId,
            workspaceId,
        );
        if (!existing) {
            throw AppError.notFound(
                "form_field.not_found",
                `Field ${fieldId} does not exist`,
            );
        }
        await this.fields.deleteById(fieldId);
    }

    async reorderFields(input: ReorderInput): Promise<WireForm> {
        const form = await this.requireForm(input.formId, input.workspaceId);
        const owned = await this.fields.idSetForForm(input.formId);
        const foreign = input.items.filter((i) => !owned.has(i.id));
        if (foreign.length > 0) {
            throw AppError.unprocessable(
                "form_field.not_in_form",
                "One or more fields do not belong to this form",
                foreign.map((i) => ({
                    field: "id",
                    issue: `${i.id} is not a field of this form`,
                })),
            );
        }

        await this.db.transaction(async (tx) => {
            for (const item of input.items) {
                await this.fields.updatePosition(item.id, item.position, tx);
            }
        });

        return this.hydrate(form);
    }

    // ─── submissions ──────────────────────────────────────────────────────────

    async listSubmissions(input: ListSubmissionsInput): Promise<{
        data: WireFormSubmission[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
    }> {
        await this.requireForm(input.formId, input.workspaceId);
        const limit = clampLimit(input.limit);
        const before = input.cursor ? decodeCursor(input.cursor) : undefined;

        const [rows, total] = await Promise.all([
            this.submissions.listByForm({
                formId: input.formId,
                beforeInternalId: before,
                limit: limit + 1,
            }),
            this.submissions.countByForm(input.formId),
        ]);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        const nextCursor =
            hasMore && last ? encodeCursor(last.internalId) : null;
        return {
            data: page.map(toWireFormSubmission),
            nextCursor,
            hasMore,
            total,
        };
    }

    // ─── public ───────────────────────────────────────────────────────────────

    async publicView(slug: string): Promise<PublicForm> {
        const resolved = await this.forms.resolveBySlug(slug);
        if (!resolved) {
            throw AppError.notFound("form.not_found", "Form not found");
        }
        const { form, workspaceId } = resolved;
        const fields = await this.fields.listByForm(form.id);

        // Enrich custom_field fields with their type / config / dropdown options
        // so the anonymous page renders the right control and submits the
        // matching value envelope (text→{text}, date→{date}, dropdown→
        // {option_id}, money→{amount,currency}). task_attr fields stay plain.
        const typeByKey = new Map<string, string>();
        const configByKey = new Map<string, Record<string, unknown>>();
        const cfKeys = [
            ...new Set(
                fields
                    .filter((f) => f.fieldKind === "custom_field" && !f.isHidden)
                    .map((f) => f.fieldKey),
            ),
        ];
        for (const key of cfKeys) {
            const cf = await this.customFields.findByIdInWorkspace(
                key,
                workspaceId,
            );
            if (cf) {
                typeByKey.set(key, cf.type);
                configByKey.set(
                    key,
                    (cf.config ?? {}) as Record<string, unknown>,
                );
            }
        }
        const dropdownKeys = cfKeys.filter(
            (k) => typeByKey.get(k) === "dropdown",
        );
        const rawOptions =
            await this.customFields.optionsByFieldIds(dropdownKeys);
        const optionsByKey = new Map<
            string,
            { id: string; label: string; color: string }[]
        >();
        for (const [k, opts] of rawOptions) {
            optionsByKey.set(
                k,
                opts.map((o) => ({ id: o.id, label: o.label, color: o.color })),
            );
        }

        return toPublicForm(form, fields, {
            typeByKey,
            configByKey,
            optionsByKey,
        });
    }

    /**
     * Public submit: validate `data` against the form's fields, create a task
     * (via TaskWriteService, on the form's list with its default status/type),
     * then record the submission + fire the `form_submitted` notification.
     * The task is created in its own transaction; the submission + custom-field
     * values + notification commit together afterward (the task survives even if
     * that second step fails — it is the standing intake record).
     */
    async submit(input: SubmitInput): Promise<SubmitResult> {
        const resolved = await this.forms.resolveBySlug(input.slug);
        if (!resolved) {
            throw AppError.notFound("form.not_found", "Form not found");
        }
        const { form, workspaceId } = resolved;
        const settings = (form.settings ?? {}) as {
            submission_open?: unknown;
            success_message?: unknown;
        };
        if (!form.isPublic || settings.submission_open === false) {
            throw AppError.forbidden(
                "form.submission_closed",
                "This form is not accepting submissions",
            );
        }

        const fields = await this.fields.listByForm(form.id);
        const details: ErrorDetail[] = [];
        const taskAttrs: Record<string, unknown> = {};
        const cfValues: { customFieldId: string; value: unknown }[] = [];

        for (const field of fields) {
            const provided = input.data[field.fieldKey];
            const value =
                provided !== undefined && provided !== null
                    ? provided
                    : (field.defaultValue ?? null);

            if (
                field.isRequired &&
                (value === null || value === undefined || value === "")
            ) {
                details.push({
                    field: field.fieldKey,
                    issue: `${field.label} is required`,
                });
                continue;
            }
            if (value === null || value === undefined) continue;

            if (field.fieldKind === "task_attr") {
                const norm = normalizeTaskAttr(field.fieldKey, value);
                if (norm.issue) {
                    details.push({ field: field.fieldKey, issue: norm.issue });
                    continue;
                }
                taskAttrs[field.fieldKey] = norm.value;
            } else {
                const cf = await this.customFields.findByIdInWorkspace(
                    field.fieldKey,
                    workspaceId,
                );
                if (!cf) {
                    details.push({
                        field: field.fieldKey,
                        issue: "is not a valid custom field",
                    });
                    continue;
                }
                const issue = await this.validateCustomValue(cf, value);
                if (issue) {
                    details.push({ field: field.fieldKey, issue });
                    continue;
                }
                cfValues.push({ customFieldId: cf.id, value });
            }
        }

        if (details.length > 0) {
            throw AppError.validationFailed(details);
        }

        // 1. Create the task on the form's list (own transaction).
        const task = await this.taskWrites.create({
            workspaceId,
            actorId: form.createdBy,
            role: Roles.MEMBER,
            primaryListId: form.listId,
            name:
                typeof taskAttrs.name === "string" && taskAttrs.name.length > 0
                    ? (taskAttrs.name as string)
                    : `${form.title} submission`,
            description:
                typeof taskAttrs.description === "string"
                    ? (taskAttrs.description as string)
                    : undefined,
            priority:
                typeof taskAttrs.priority === "number"
                    ? (taskAttrs.priority as number)
                    : undefined,
            dueDate:
                typeof taskAttrs.due_date === "string"
                    ? (taskAttrs.due_date as string)
                    : undefined,
            startDate:
                typeof taskAttrs.start_date === "string"
                    ? (taskAttrs.start_date as string)
                    : undefined,
        });

        // 2. Custom-field values + submission row + notification (one tx).
        const submissionId = fakeId("fsub");
        const submitterEmail =
            typeof input.data.email === "string" ? input.data.email : null;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days
        const encryptedData = encryptJSON(input.data);
        await this.db.transaction(async (tx) => {
            for (const cv of cfValues) {
                await this.customFields.upsertValue(
                    task.id,
                    cv.customFieldId,
                    cv.value,
                    form.createdBy,
                    tx,
                );
            }
            await this.submissions.insert(
                {
                    id: submissionId,
                    formId: form.id,
                    taskId: task.id,
                    submitterEmail,
                    submitterIp: input.ip,
                    data: encryptedData as any,
                    encryptedAt: now,
                    expiresAt,
                },
                tx,
            );
            // form_submitted → the form owner (recipient config is not modeled
            // relationally; default to the creator).
            await this.notifications.createMany(
                [
                    {
                        userId: form.createdBy,
                        type: "form_submitted",
                        entityType: "form",
                        entityId: form.id,
                        actorId: null,
                        title: this.submittedTitle(form.title),
                    },
                ],
                tx,
            );
        });

        return {
            submission_id: submissionId,
            task_id: task.id,
            message:
                typeof settings.success_message === "string"
                    ? settings.success_message
                    : "Thank you",
        };
    }

    // ─── helpers ─────────────────────────────────────────────────────────────

    private async requireForm(
        formId: string,
        workspaceId: string,
    ): Promise<Form> {
        const form = await this.forms.findByIdInWorkspace(formId, workspaceId);
        if (!form) {
            throw AppError.notFound(
                "form.not_found",
                `Form ${formId} does not exist`,
            );
        }
        return form;
    }

    private async hydrate(form: Form): Promise<WireForm> {
        const fields = await this.fields.listByForm(form.id);
        return toWireForm(form, fields);
    }

    /** Reject a field whose key cannot target a task attr / custom field. */
    private async validateFieldKey(
        fieldKind: FormField["fieldKind"],
        fieldKey: string,
        workspaceId: string,
    ): Promise<void> {
        if (fieldKind === "task_attr") {
            if (!TASK_ATTR_KEYS.has(fieldKey)) {
                throw AppError.unprocessable(
                    "form.invalid_field_key",
                    `task_attr field_key must be one of: ${[...TASK_ATTR_KEYS].join(", ")}`,
                    [{ field: "field_key", issue: "is not a task attribute" }],
                );
            }
            return;
        }
        const cf = await this.customFields.findByIdInWorkspace(
            fieldKey,
            workspaceId,
        );
        if (!cf) {
            throw AppError.unprocessable(
                "form.invalid_field_key",
                `${fieldKey} is not a custom field in this workspace`,
                [{ field: "field_key", issue: "is not a custom field" }],
            );
        }
    }

    /** Validate a submitted custom-field value envelope per type. Returns an issue string or null. */
    private async validateCustomValue(
        cf: { id: string; type: string },
        value: unknown,
    ): Promise<string | null> {
        const v = value as Record<string, unknown> | null;
        if (v === null || typeof v !== "object") {
            return "value must be a JSON object";
        }
        switch (cf.type) {
            case "text":
            case "phone":
                return typeof v.text === "string" ? null : "expects { text }";
            case "money":
                return typeof v.amount === "number" &&
                    typeof v.currency === "string"
                    ? null
                    : "expects { amount, currency }";
            case "date":
                return typeof v.date === "string"
                    ? null
                    : "expects { date }";
            case "files":
                return Array.isArray(v.file_ids)
                    ? null
                    : "expects { file_ids: [] }";
            case "dropdown": {
                if (typeof v.option_id !== "string") {
                    return "expects { option_id }";
                }
                const ok = await this.customFields.optionExists(
                    cf.id,
                    v.option_id,
                );
                return ok ? null : "option_id is not a valid option";
            }
            default:
                return "unsupported custom-field type";
        }
    }

    private submittedTitle(formTitle: string): string {
        const prefix = "New form submission: ";
        const room = 300 - prefix.length;
        const t =
            formTitle.length > room
                ? `${formTitle.slice(0, room - 1)}…`
                : formTitle;
        return `${prefix}${t}`;
    }
}

const clampLimit = (raw?: number): number => {
    if (raw === undefined) return SUBMISSIONS_DEFAULT_LIMIT;
    if (raw < 1) return 1;
    if (raw > SUBMISSIONS_MAX_LIMIT) return SUBMISSIONS_MAX_LIMIT;
    return Math.floor(raw);
};

const encodeCursor = (value: bigint): string =>
    Buffer.from(value.toString(), "utf8").toString("base64url");

const decodeCursor = (cursor: string): bigint => {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^\d+$/.test(decoded)) {
        throw AppError.badRequest(
            "pagination.invalid_cursor",
            "The pagination cursor is malformed.",
        );
    }
    return BigInt(decoded);
};
