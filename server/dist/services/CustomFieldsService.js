"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomFieldsService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const errors_1 = require("../errors");
const schema_1 = require("../db/schema");
const constants_1 = require("../constants");
/** The exactly-6 supported field types (FINAL_REQUIREMENTS §5.11 / DB ENUM). */
const SUPPORTED_TYPES = [
    "text",
    "phone",
    "money",
    "date",
    "dropdown",
    "files",
];
/** Bangladesh mobile number — 11 digits, `01[3-9]` prefix. */
const BD_PHONE = /^01[3-9][0-9]{8}$/;
/**
 * F29 (ISS-043): ISO-4217 codes via ICU — Node ships full ICU, so
 * `Intl.supportedValuesOf("currency")` is the canonical list (BDT included)
 * with no dependency. Cached once. The null fallback (ancient/small-ICU
 * runtimes) degrades to the format-only check rather than refusing everything.
 */
const KNOWN_CURRENCIES = (() => {
    try {
        const intl = Intl;
        const list = intl.supportedValuesOf?.("currency");
        return list && list.length > 0 ? new Set(list) : null;
    }
    catch {
        return null;
    }
})();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
/**
 * Team-access P3: bound what a value may occupy inside an audit row — a long
 * text field must not turn one activity row into an essay. Objects (dropdown
 * envelopes, date envelopes, …) pass through when compact, else clip their
 * JSON form.
 */
const AUDIT_VALUE_LIMIT = 280;
const clipAuditValue = (v) => {
    if (typeof v === "string" && v.length > AUDIT_VALUE_LIMIT) {
        return `${v.slice(0, AUDIT_VALUE_LIMIT)}…`;
    }
    if (typeof v === "object" && v !== null) {
        const s = JSON.stringify(v);
        return s.length > AUDIT_VALUE_LIMIT
            ? `${s.slice(0, AUDIT_VALUE_LIMIT)}…`
            : v;
    }
    return v;
};
/**
 * §17 Custom Fields business logic. Field DEFINITION CRUD (#1–#5) is
 * workspace-admin work (👑) that pairs each write with a `workspace_activity`
 * audit row; per-task VALUE writes (#6/#7) are member work (🔐) that lock the
 * task, write the value, append a `task_activity` row, and bump the task ETag —
 * mirroring §11 task-membership.
 */
class CustomFieldsService {
    db;
    fields;
    spaces;
    lists;
    tasksRepo;
    workspaceActivity;
    taskActivity;
    tasksService;
    constructor(db, fields, spaces, lists, tasksRepo, workspaceActivity, taskActivity, tasksService) {
        this.db = db;
        this.fields = fields;
        this.spaces = spaces;
        this.lists = lists;
        this.tasksRepo = tasksRepo;
        this.workspaceActivity = workspaceActivity;
        this.taskActivity = taskActivity;
        this.tasksService = tasksService;
    }
    // ─── #1 list all ──────────────────────────────────────────────────────────
    async listAll(input) {
        const opts = {};
        if (input.scopeType !== undefined)
            opts.scopeType = input.scopeType;
        if (input.scopeId !== undefined)
            opts.scopeId = input.scopeId;
        const rows = await this.fields.listByWorkspace(input.workspaceId, opts);
        return this.hydrateOptions(rows);
    }
    // ─── #2 list for a list (workspace + space + list scope) ───────────────────
    async listForList(input) {
        const list = await this.lists.findRecordByIdInWorkspace(input.listId, input.workspaceId);
        if (!list) {
            throw errors_1.AppError.notFound("list.not_found", `List ${input.listId} does not exist`);
        }
        const rows = await this.fields.listForList(input.workspaceId, list.spaceId, input.listId);
        return this.hydrateOptions(rows);
    }
    // ─── #3 create ──────────────────────────────────────────────────────────────
    async create(input) {
        // Marquee rule: type must be one of the 6 supported values.
        if (!SUPPORTED_TYPES.includes(input.type)) {
            throw errors_1.AppError.unprocessable("custom_field.unsupported_type", `Unsupported custom field type "${input.type}". Allowed: ${SUPPORTED_TYPES.join(", ")}`);
        }
        const type = input.type;
        const scopeId = await this.resolveScope(input.scopeType, input.scopeId, input.workspaceId);
        if (type !== "dropdown" && input.options.length > 0) {
            throw errors_1.AppError.validationFailed([
                {
                    field: "options",
                    issue: "options are only valid for a dropdown field",
                },
            ]);
        }
        const newId = await this.db.transaction(async (tx) => {
            const id = await this.fields.insert({
                workspaceId: input.workspaceId,
                scopeType: input.scopeType,
                scopeId,
                name: input.name,
                type,
                config: input.config,
                isRequired: input.isRequired,
                defaultValue: input.defaultValue,
                position: input.position,
                // F26 (ISS-042): settable now — it was pinned to false,
                // which is why the redaction feature could not be used.
                hiddenFromGuests: input.hiddenFromGuests ?? false,
                createdBy: input.actorId,
            }, tx);
            if (type === "dropdown" && input.options.length > 0) {
                await this.fields.insertOptions(id, input.options, tx);
            }
            await this.workspaceActivity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "custom_field",
                entityId: id,
                action: "created",
                context: { name: input.name, type },
            }, tx);
            return id;
        });
        return this.getHydratedOrThrow(newId, input.workspaceId);
    }
    // ─── #4 update ──────────────────────────────────────────────────────────────
    async update(input) {
        const existing = await this.fields.findByIdInWorkspace(input.fieldId, input.workspaceId);
        if (!existing) {
            throw errors_1.AppError.notFound("custom_field.not_found", `Custom field ${input.fieldId} does not exist`);
        }
        const changed = Object.keys(input.fields);
        if (changed.length === 0) {
            return this.getHydratedOrThrow(input.fieldId, input.workspaceId);
        }
        await this.db.transaction(async (tx) => {
            await this.fields.lockByIdInWorkspace(input.fieldId, input.workspaceId, tx);
            await this.fields.updateFields(input.fieldId, input.fields, tx);
            await this.workspaceActivity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "custom_field",
                entityId: input.fieldId,
                action: "updated",
                context: { fields: changed },
            }, tx);
        });
        return this.getHydratedOrThrow(input.fieldId, input.workspaceId);
    }
    // ─── #5 delete ──────────────────────────────────────────────────────────────
    async remove(input) {
        const existing = await this.fields.findByIdInWorkspace(input.fieldId, input.workspaceId);
        if (!existing) {
            throw errors_1.AppError.notFound("custom_field.not_found", `Custom field ${input.fieldId} does not exist`);
        }
        await this.db.transaction(async (tx) => {
            await this.fields.lockByIdInWorkspace(input.fieldId, input.workspaceId, tx);
            // Record BEFORE delete (entity still readable). The DB cascades
            // options + all task values via ON DELETE CASCADE.
            await this.workspaceActivity.record({
                workspaceId: input.workspaceId,
                actorId: input.actorId,
                entityType: "custom_field",
                entityId: input.fieldId,
                action: "deleted",
                context: { name: existing.name, type: existing.type },
            }, tx);
            await this.fields.deleteById(input.fieldId, tx);
        });
    }
    // ─── #6 set value on a task ────────────────────────────────────────────────
    async setValue(input) {
        const task = await this.tasksRepo.findByIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        const field = await this.fields.findByIdInWorkspace(input.fieldId, input.workspaceId);
        if (!field) {
            throw errors_1.AppError.notFound("custom_field.not_found", `Custom field ${input.fieldId} does not exist`);
        }
        // Extra guard: if the field is list-scoped, ensure the task belongs to that list
        if (field.scopeType === "list") {
            const [row] = await this.db
                .select({ primaryListId: schema_1.tasks.primaryListId })
                .from(schema_1.tasks)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.id, task.id), (0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, field.scopeId)))
                .limit(1);
            if (!row) {
                throw errors_1.AppError.notFound("custom_field.not_found", `Custom field ${input.fieldId} is not applicable to this task`);
            }
        }
        // Validate the value envelope against the field's type (incl. dropdown
        // option existence + files attachment ownership). Throws 422 on mismatch.
        const normalized = await this.normalizeValue(field, input.value, input.workspaceId);
        await this.db.transaction(async (tx) => {
            await this.tasksRepo.lockById(task.id, tx);
            await this.fields.upsertValue(task.id, field.id, normalized, input.actorId, tx);
            await this.taskActivity.recordMany([
                {
                    taskId: task.id,
                    actorId: input.actorId,
                    action: "custom_field_value_set",
                    // Team-access P3 (plan G13): record WHICH field by
                    // name (denormalised — a later rename must not blank
                    // the history) and WHAT value landed, clipped.
                    context: {
                        field_id: field.id,
                        field_name: field.name,
                        value: clipAuditValue(normalized),
                    },
                },
            ], tx);
            await this.tasksRepo.touchUpdatedAt(task.id, tx);
        });
        return this.tasksService.getById({
            idOrKey: task.id,
            workspaceId: input.workspaceId,
            role: input.role,
        });
    }
    // ─── #7 clear value ─────────────────────────────────────────────────────────
    async clearValue(input) {
        const task = await this.tasksRepo.findByIdInWorkspace(input.taskId, input.workspaceId);
        if (!task) {
            throw errors_1.AppError.notFound("task.not_found", `Task ${input.taskId} does not exist`);
        }
        if (task.archivedAt) {
            throw errors_1.AppError.conflict("task.archived", "Cannot modify an archived task");
        }
        const field = await this.fields.findByIdInWorkspace(input.fieldId, input.workspaceId);
        if (!field) {
            throw errors_1.AppError.notFound("custom_field.not_found", `Custom field ${input.fieldId} does not exist`);
        }
        // Extra guard: if the field is list-scoped, ensure the task belongs to that list
        if (field.scopeType === "list") {
            const [row] = await this.db
                .select({ primaryListId: schema_1.tasks.primaryListId })
                .from(schema_1.tasks)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tasks.id, task.id), (0, drizzle_orm_1.eq)(schema_1.tasks.primaryListId, field.scopeId)))
                .limit(1);
            if (!row) {
                throw errors_1.AppError.notFound("custom_field.not_found", `Custom field ${input.fieldId} is not applicable to this task`);
            }
        }
        await this.db.transaction(async (tx) => {
            await this.tasksRepo.lockById(task.id, tx);
            const removed = await this.fields.deleteValue(task.id, field.id, tx);
            if (!removed) {
                return; // idempotent no-op — no value was set
            }
            await this.taskActivity.recordMany([
                {
                    taskId: task.id,
                    actorId: input.actorId,
                    action: "custom_field_value_cleared",
                    // Team-access P3: name denormalised, like `set`.
                    context: {
                        field_id: field.id,
                        field_name: field.name,
                    },
                },
            ], tx);
            await this.tasksRepo.touchUpdatedAt(task.id, tx);
        });
    }
    // ─── helpers ────────────────────────────────────────────────────────────────
    /** Resolve + validate the scope_id for a scope_type (422 on mismatch). */
    async resolveScope(scopeType, scopeId, workspaceId) {
        if (scopeType === "workspace") {
            if (scopeId != null) {
                throw errors_1.AppError.validationFailed([
                    {
                        field: "scope_id",
                        issue: "must be null for a workspace-scoped field",
                    },
                ]);
            }
            return null;
        }
        if (scopeId == null) {
            throw errors_1.AppError.validationFailed([
                {
                    field: "scope_id",
                    issue: `scope_id is required for a ${scopeType}-scoped field`,
                },
            ]);
        }
        if (scopeType === "space") {
            const space = await this.spaces.findByIdInWorkspace(scopeId, workspaceId);
            if (!space) {
                throw errors_1.AppError.unprocessable("custom_field.invalid_scope", `scope_id ${scopeId} is not a space in this workspace`);
            }
        }
        else {
            const list = await this.lists.findByIdInWorkspace(scopeId, workspaceId);
            if (!list) {
                throw errors_1.AppError.unprocessable("custom_field.invalid_scope", `scope_id ${scopeId} is not a list in this workspace`);
            }
        }
        return scopeId;
    }
    /**
     * Validate a value envelope against the field's type and return the
     * normalized JSON to store. Throws `422 validation.failed` (with details) on
     * any shape / option / attachment mismatch.
     */
    async normalizeValue(field, raw, workspaceId) {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            throw this.valueError("value must be a JSON object envelope");
        }
        const v = raw;
        const config = field.config ?? {};
        switch (field.type) {
            case "text": {
                if (typeof v.text !== "string") {
                    throw this.valueError("text value must be { text: string }");
                }
                const max = config.max_length;
                if (typeof max === "number" &&
                    Number.isFinite(max) &&
                    v.text.length > max) {
                    throw this.valueError(`text exceeds max_length of ${max}`);
                }
                return { text: v.text };
            }
            case "phone": {
                if (typeof v.text !== "string") {
                    throw this.valueError("phone value must be { text: string }");
                }
                /**
                 * F29 (ISS-043): the BD check used to run only when
                 * `config.default_country === "BD"` — and nothing ever set
                 * that, so a "Customer phone" field was free text and the
                 * regex below never fired once. BD is the DEFAULT now (this is
                 * a Bangladesh business; a field can still opt out by naming
                 * another country), and the two real-world spellings both
                 * pass: local `01XXXXXXXXX` and `+880`/`880`-prefixed. Stored
                 * verbatim — validation, not normalisation.
                 */
                const country = typeof config.default_country === "string"
                    ? config.default_country
                    : "BD";
                if (country === "BD") {
                    const local = v.text.startsWith("+880")
                        ? `0${v.text.slice(4)}`
                        : v.text.startsWith("880")
                            ? `0${v.text.slice(3)}`
                            : v.text;
                    if (!BD_PHONE.test(local)) {
                        throw this.valueError("phone must be a valid BD mobile (01XXXXXXXXX, optionally +880-prefixed)");
                    }
                }
                return { text: v.text };
            }
            case "money": {
                if (typeof v.amount !== "number" ||
                    !Number.isInteger(v.amount) ||
                    typeof v.currency !== "string" ||
                    v.currency.length === 0) {
                    throw this.valueError("money value must be { amount: integer, currency: string }");
                }
                // F29 (ISS-043): an "Order value" could hold −500
                // NOTACURRENCY. Negative amounts are refused (this field
                // feeds reports and the public-form intake; a refund is its
                // own record, not a negative order), and the currency must be
                // a real ISO-4217 code — uppercase three letters, checked
                // against ICU's list when available.
                if (v.amount < 0) {
                    throw this.valueError("money amount must not be negative");
                }
                if (!/^[A-Z]{3}$/.test(v.currency) ||
                    (KNOWN_CURRENCIES !== null &&
                        !KNOWN_CURRENCIES.has(v.currency))) {
                    throw this.valueError("currency must be a 3-letter ISO-4217 code (e.g. BDT)");
                }
                return { amount: v.amount, currency: v.currency };
            }
            case "date": {
                if (typeof v.date !== "string" || !ISO_DATE.test(v.date)) {
                    throw this.valueError("date value must be { date: 'YYYY-MM-DD', include_time?: boolean }");
                }
                if (v.include_time !== undefined &&
                    typeof v.include_time !== "boolean") {
                    throw this.valueError("include_time must be a boolean");
                }
                return { date: v.date, include_time: v.include_time ?? false };
            }
            case "dropdown": {
                if (typeof v.option_id !== "string") {
                    throw this.valueError("dropdown value must be { option_id: string }");
                }
                const exists = await this.fields.optionExists(field.id, v.option_id);
                if (!exists) {
                    throw this.valueError(`option_id ${v.option_id} is not an option of this field`);
                }
                return { option_id: v.option_id };
            }
            case "files": {
                const fileIds = v.file_ids;
                if (!Array.isArray(fileIds) ||
                    !fileIds.every((id) => typeof id === "string")) {
                    throw this.valueError("files value must be { file_ids: string[] }");
                }
                if (fileIds.length > 0) {
                    const valid = await this.fields.findAttachmentIdsInWorkspace(fileIds, workspaceId);
                    const missing = fileIds.filter((id) => !valid.has(id));
                    if (missing.length > 0) {
                        throw this.valueError(`attachment(s) not found in this workspace: ${missing.join(", ")}`);
                    }
                }
                return { file_ids: fileIds };
            }
            default:
                // Unreachable — the field type is constrained to the 6-value
                // enum by the DB + create-time validation; this is a defensive
                // fallback only.
                throw this.valueError("unsupported field type");
        }
    }
    valueError(issue) {
        const details = [{ field: "value", issue }];
        return errors_1.AppError.validationFailed(details);
    }
    /** Attach dropdown options to a batch of field rows. */
    async hydrateOptions(rows) {
        const dropdownIds = rows
            .filter((r) => r.type === "dropdown")
            .map((r) => r.id);
        const optionMap = await this.fields.optionsByFieldIds(dropdownIds);
        return rows.map((field) => ({
            field,
            options: optionMap.get(field.id) ?? [],
        }));
    }
    /** Re-read a field + its options after a write (authoritative wire shape). */
    async getHydratedOrThrow(id, workspaceId) {
        const field = await this.fields.findByIdInWorkspace(id, workspaceId);
        if (!field) {
            throw errors_1.AppError.internal();
        }
        const optionMap = await this.fields.optionsByFieldIds([id]);
        return { field, options: optionMap.get(id) ?? [] };
    }
    /** Guests never see custom-field values flagged hidden — referenced by reads. */
    static redactsForGuests(role) {
        return role === constants_1.Roles.GUEST;
    }
}
exports.CustomFieldsService = CustomFieldsService;
