"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormFieldsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const context_1 = require("../rbac/context");
/**
 * Data access for `form_fields`. Uniqueness is `(form_id, field_kind,
 * field_key)`; `position` is NOT unique. `field_kind='custom_field'` stores a
 * `custom_fields.id` in `field_key` (a plain VARCHAR — the app validates it).
 */
class FormFieldsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** A form's fields, ordered by position then insertion. */
    async listByForm(formId, exec = this.db) {
        return exec
            .select()
            .from(schema_1.formFields)
            .where((0, drizzle_orm_1.eq)(schema_1.formFields.formId, formId))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.formFields.position), (0, drizzle_orm_1.asc)(schema_1.formFields.createdAt));
    }
    async insert(values, exec = this.db) {
        await exec.insert(schema_1.formFields).values(values);
    }
    /** Next append position (MAX+1) for a form's fields. */
    async nextPosition(formId, exec = this.db) {
        const [row] = await exec
            .select({
            max: (0, drizzle_orm_1.sql) `COALESCE(MAX(${schema_1.formFields.position}), -1)`,
        })
            .from(schema_1.formFields)
            .where((0, drizzle_orm_1.eq)(schema_1.formFields.formId, formId));
        return Number(row?.max ?? -1) + 1;
    }
    /**
     * Find a field by id, scoped to a workspace via the form→list→space join
     * (the `/form-fields/:id` routes have no form in the path). Returns the
     * field + its `formId`, or null (404 source — no cross-tenant oracle).
     */
    async findByIdInWorkspace(fieldId, workspaceId, exec = this.db) {
        const [row] = await exec
            .select({ field: schema_1.formFields })
            .from(schema_1.formFields)
            .innerJoin(schema_1.forms, (0, drizzle_orm_1.eq)(schema_1.forms.id, schema_1.formFields.formId))
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.forms.listId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.formFields.id, fieldId), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), 
        // Team-access P5: same reach as the form itself
        // (`FormsRepo` filters on `forms.list_id`) — this resolve
        // used to bypass the scoped `requireForm` path entirely.
        await (0, context_1.listScopeFilter)(schema_1.forms.listId)))
            .limit(1);
        return row?.field ?? null;
    }
    /** The set of field ids belonging to a form (reorder membership check). */
    async idSetForForm(formId, exec = this.db) {
        const rows = await exec
            .select({ id: schema_1.formFields.id })
            .from(schema_1.formFields)
            .where((0, drizzle_orm_1.eq)(schema_1.formFields.formId, formId));
        return new Set(rows.map((r) => r.id));
    }
    async update(fieldId, patch, exec = this.db) {
        await exec
            .update(schema_1.formFields)
            .set(patch)
            .where((0, drizzle_orm_1.eq)(schema_1.formFields.id, fieldId));
    }
    async updatePosition(fieldId, position, exec = this.db) {
        await exec
            .update(schema_1.formFields)
            .set({ position })
            .where((0, drizzle_orm_1.eq)(schema_1.formFields.id, fieldId));
    }
    async deleteById(fieldId, exec = this.db) {
        const [res] = await exec
            .delete(schema_1.formFields)
            .where((0, drizzle_orm_1.eq)(schema_1.formFields.id, fieldId));
        return res.affectedRows;
    }
}
exports.FormFieldsRepo = FormFieldsRepo;
