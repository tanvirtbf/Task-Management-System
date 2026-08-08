"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomFieldsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
const FIELD_COLUMNS = {
    id: schema_1.customFields.id,
    scopeType: schema_1.customFields.scopeType,
    scopeId: schema_1.customFields.scopeId,
    name: schema_1.customFields.name,
    type: schema_1.customFields.type,
    config: schema_1.customFields.config,
    isRequired: schema_1.customFields.isRequired,
    hiddenFromGuests: schema_1.customFields.hiddenFromGuests,
    defaultValue: schema_1.customFields.defaultValue,
    position: schema_1.customFields.position,
};
class CustomFieldsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    // ─── field definitions ──────────────────────────────────────────────────
    /**
     * All custom fields in a workspace, ordered by scope then position then id
     * (deterministic). Optionally narrow to one `scopeType` (+ `scopeId`).
     * Backed by `idx_custom_fields_workspace` / `idx_custom_fields_scope`.
     */
    async listByWorkspace(workspaceId, opts = {}) {
        const where = [(0, drizzle_orm_1.eq)(schema_1.customFields.workspaceId, workspaceId)];
        if (opts.scopeType !== undefined) {
            where.push((0, drizzle_orm_1.eq)(schema_1.customFields.scopeType, opts.scopeType));
        }
        if (opts.scopeId !== undefined) {
            where.push((0, drizzle_orm_1.eq)(schema_1.customFields.scopeId, opts.scopeId));
        }
        const rows = await this.db
            .select(FIELD_COLUMNS)
            .from(schema_1.customFields)
            .where((0, drizzle_orm_1.and)(...where))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.customFields.scopeType), (0, drizzle_orm_1.asc)(schema_1.customFields.position), (0, drizzle_orm_1.asc)(schema_1.customFields.id));
        return rows;
    }
    /**
     * The fields that APPLY to a list: the union of (a) workspace-scoped fields,
     * (b) space-scoped fields for the list's parent space, and (c) list-scoped
     * fields for the list itself — all within the workspace. Ordered by scope,
     * position, id.
     */
    async listForList(workspaceId, spaceId, listId) {
        const rows = await this.db
            .select(FIELD_COLUMNS)
            .from(schema_1.customFields)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customFields.workspaceId, workspaceId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customFields.scopeType, "workspace"), (0, drizzle_orm_1.isNull)(schema_1.customFields.scopeId)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customFields.scopeType, "space"), (0, drizzle_orm_1.eq)(schema_1.customFields.scopeId, spaceId)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customFields.scopeType, "list"), (0, drizzle_orm_1.eq)(schema_1.customFields.scopeId, listId)))))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.customFields.scopeType), (0, drizzle_orm_1.asc)(schema_1.customFields.position), (0, drizzle_orm_1.asc)(schema_1.customFields.id));
        return rows;
    }
    /**
     * Resolve one field by id within a workspace. Returns `null` when the id
     * does not exist OR belongs to another workspace (callers map both to `404
     * custom_field.not_found` — no cross-workspace existence oracle). Pass `exec`
     * to read inside a transaction.
     */
    async findByIdInWorkspace(id, workspaceId, exec = this.db) {
        const [row] = await exec
            .select(FIELD_COLUMNS)
            .from(schema_1.customFields)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customFields.id, id), (0, drizzle_orm_1.eq)(schema_1.customFields.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }
    /**
     * Lock a field row (`SELECT … FOR UPDATE`) scoped to the workspace, for the
     * update/delete read-modify-write. Must run inside a transaction.
     */
    async lockByIdInWorkspace(id, workspaceId, exec) {
        const [row] = await exec
            .select(FIELD_COLUMNS)
            .from(schema_1.customFields)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customFields.id, id), (0, drizzle_orm_1.eq)(schema_1.customFields.workspaceId, workspaceId)))
            .for("update");
        return row ?? null;
    }
    /**
     * Insert a field definition and return its generated id. `created_at` /
     * `updated_at` default in the DB. Pass `exec` to run inside the create tx so
     * the option rows + activity row are atomic with this insert.
     */
    async insert(input, exec = this.db) {
        const id = (0, utils_1.fakeId)("cf");
        await exec.insert(schema_1.customFields).values({
            id,
            workspaceId: input.workspaceId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            name: input.name,
            type: input.type,
            config: input.config,
            isRequired: input.isRequired,
            defaultValue: input.defaultValue,
            position: input.position,
            hiddenFromGuests: input.hiddenFromGuests,
            createdBy: input.createdBy,
        });
        return id;
    }
    /** Apply a partial update to a field (name/config/is_required/position). */
    async updateFields(id, fields, exec = this.db) {
        await exec
            .update(schema_1.customFields)
            .set(fields)
            .where((0, drizzle_orm_1.eq)(schema_1.customFields.id, id));
    }
    /**
     * Hard-delete a field by id. The DB cascades `custom_field_options` and
     * `task_custom_field_values` via their `ON DELETE CASCADE` FKs, so no manual
     * child cleanup is needed. Returns rows removed (0 if a concurrent delete
     * already won). Pass `exec` to run inside the delete tx.
     */
    async deleteById(id, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.customFields)
            .where((0, drizzle_orm_1.eq)(schema_1.customFields.id, id));
        return result.affectedRows;
    }
    // ─── dropdown options ────────────────────────────────────────────────────
    /**
     * Insert dropdown option rows for a field. Each gets a generated id; the
     * `(custom_field_id, label)` UNIQUE index rejects duplicate labels.
     */
    async insertOptions(customFieldId, options, exec = this.db) {
        if (options.length === 0)
            return;
        await exec.insert(schema_1.customFieldOptions).values(options.map((o, i) => ({
            id: (0, utils_1.fakeId)("cfo"),
            customFieldId,
            label: o.label,
            ...(o.color !== undefined ? { color: o.color } : {}),
            position: o.position ?? i,
        })));
    }
    /** Options for a set of fields, grouped by field id, ordered by position. */
    async optionsByFieldIds(fieldIds) {
        const map = new Map();
        if (fieldIds.length === 0)
            return map;
        const rows = await this.db
            .select({
            id: schema_1.customFieldOptions.id,
            customFieldId: schema_1.customFieldOptions.customFieldId,
            label: schema_1.customFieldOptions.label,
            color: schema_1.customFieldOptions.color,
            position: schema_1.customFieldOptions.position,
        })
            .from(schema_1.customFieldOptions)
            .where((0, drizzle_orm_1.inArray)(schema_1.customFieldOptions.customFieldId, fieldIds))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.customFieldOptions.customFieldId), (0, drizzle_orm_1.asc)(schema_1.customFieldOptions.position), (0, drizzle_orm_1.asc)(schema_1.customFieldOptions.id));
        for (const row of rows) {
            const arr = map.get(row.customFieldId) ?? [];
            arr.push(row);
            map.set(row.customFieldId, arr);
        }
        return map;
    }
    /** True when `optionId` is an option of `customFieldId` (dropdown validate). */
    async optionExists(customFieldId, optionId, exec = this.db) {
        const [row] = await exec
            .select({ id: schema_1.customFieldOptions.id })
            .from(schema_1.customFieldOptions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.customFieldOptions.id, optionId), (0, drizzle_orm_1.eq)(schema_1.customFieldOptions.customFieldId, customFieldId)))
            .limit(1);
        return row !== undefined;
    }
    // ─── per-task values ──────────────────────────────────────────────────────
    /**
     * Upsert a single task's value for a field (PK `(task_id, custom_field_id)`).
     * Stores the typed JSON envelope verbatim — the value's `$.option_id` powers
     * the VIRTUAL `option_id_generated` column for dropdown filters. Pass `exec`
     * to run inside the set-value tx.
     */
    async upsertValue(taskId, customFieldId, value, updatedBy, exec = this.db) {
        await exec
            .insert(schema_1.taskCustomFieldValues)
            .values({ taskId, customFieldId, value, updatedBy })
            .onDuplicateKeyUpdate({ set: { value, updatedBy } });
    }
    /**
     * Delete a single task's value for a field. Returns `true` when a row was
     * removed, `false` on an idempotent no-op (no value was set).
     */
    async deleteValue(taskId, customFieldId, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.taskCustomFieldValues)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taskCustomFieldValues.taskId, taskId), (0, drizzle_orm_1.eq)(schema_1.taskCustomFieldValues.customFieldId, customFieldId)));
        return result.affectedRows > 0;
    }
    // ─── files-value attachment validation ─────────────────────────────────────
    /**
     * Return the subset of `fileIds` that are live attachments belonging to the
     * given workspace (an attachment reaches a workspace only through its task:
     * `attachments.task_id → tasks.workspace_id`). Soft-deleted attachments
     * (`deleted_at IS NOT NULL`) are excluded. The caller rejects the difference
     * → so a cross-workspace or missing id is indistinguishable (no oracle).
     */
    async findAttachmentIdsInWorkspace(fileIds, workspaceId, exec = this.db) {
        if (fileIds.length === 0)
            return new Set();
        const rows = await exec
            .select({ id: schema_1.attachments.id })
            .from(schema_1.attachments)
            .innerJoin(schema_1.tasks, (0, drizzle_orm_1.eq)(schema_1.attachments.taskId, schema_1.tasks.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.attachments.id, fileIds), (0, drizzle_orm_1.eq)(schema_1.tasks.workspaceId, workspaceId), (0, drizzle_orm_1.isNull)(schema_1.attachments.deletedAt)));
        return new Set(rows.map((r) => r.id));
    }
}
exports.CustomFieldsRepo = CustomFieldsRepo;
