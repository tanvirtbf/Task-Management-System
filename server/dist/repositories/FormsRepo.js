"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const context_1 = require("../rbac/context");
/**
 * Data access for `forms`. `forms` has NO `workspace_id` column — tenant
 * isolation is enforced via the `forms → lists → spaces.workspace_id` join in
 * every workspace-scoped method. `public_slug` is GLOBALLY unique
 * (`uq_forms_public_slug`), so the slug resolver needs no workspace scope.
 * `submission_count` is trigger-maintained (never written here).
 */
class FormsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Workspace-scoped single-form lookup (404 source for the admin endpoints).
     *
     * F9 (ISS-084): also filtered by the caller's space visibility — a form's
     * title and field list describe what a department collects, and this read
     * (with `listByWorkspace`) was serving them across departments while the
     * per-list route and every write were already scoped. Invisible → 404,
     * same as `GET /tasks/:id` (D-9). The anonymous public path resolves by
     * slug, not through here, and is untouched.
     */
    async findByIdInWorkspace(formId, workspaceId, exec = this.db) {
        const [row] = await exec
            .select({ form: schema_1.forms })
            .from(schema_1.forms)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.forms.listId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.forms.id, formId), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), await (0, context_1.listScopeFilter)(schema_1.forms.listId)))
            .limit(1);
        return row?.form ?? null;
    }
    /** All forms VISIBLE to the caller (newest first) — F9/ISS-084 scoped. */
    async listByWorkspace(workspaceId) {
        const rows = await this.db
            .select({ form: schema_1.forms })
            .from(schema_1.forms)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.forms.listId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId), await (0, context_1.listScopeFilter)(schema_1.forms.listId)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.forms.createdAt));
        return rows.map((r) => r.form);
    }
    /** Forms attached to a specific list (workspace-scoped, newest first). */
    async listByList(listId, workspaceId) {
        const rows = await this.db
            .select({ form: schema_1.forms })
            .from(schema_1.forms)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.forms.listId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.forms.listId, listId), (0, drizzle_orm_1.eq)(schema_1.spaces.workspaceId, workspaceId)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.forms.createdAt));
        return rows.map((r) => r.form);
    }
    /**
     * Resolve a form by its global public slug (the public endpoints). Returns
     * the form + the owning `workspace_id` (needed to scope the created task on
     * submit). No workspace filter — the slug is the public key.
     */
    async resolveBySlug(slug, exec = this.db) {
        const [row] = await exec
            .select({ form: schema_1.forms, workspaceId: schema_1.spaces.workspaceId })
            .from(schema_1.forms)
            .innerJoin(schema_1.lists, (0, drizzle_orm_1.eq)(schema_1.lists.id, schema_1.forms.listId))
            .innerJoin(schema_1.spaces, (0, drizzle_orm_1.eq)(schema_1.spaces.id, schema_1.lists.spaceId))
            .where((0, drizzle_orm_1.eq)(schema_1.forms.publicSlug, slug))
            .limit(1);
        return row ? { form: row.form, workspaceId: row.workspaceId } : null;
    }
    /** Cheap existence check for slug-collision avoidance during generation. */
    async slugExists(slug, exec = this.db) {
        const [row] = await exec
            .select({ id: schema_1.forms.id })
            .from(schema_1.forms)
            .where((0, drizzle_orm_1.eq)(schema_1.forms.publicSlug, slug))
            .limit(1);
        return Boolean(row);
    }
    async insert(values, exec = this.db) {
        await exec.insert(schema_1.forms).values(values);
    }
    /** Partial update by PK; `updated_at` bumped explicitly. Never writes submission_count. */
    async update(formId, patch, exec = this.db) {
        await exec
            .update(schema_1.forms)
            .set({ ...patch, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.forms.id, formId));
    }
    /**
     * Hard-delete a form. `fk_form_fields_form` + `fk_form_submissions_form` are
     * ON DELETE CASCADE, so fields + submissions are torn down by the DB; tasks
     * created from submissions survive (the submission→task FK is SET NULL the
     * other direction). Returns affected-row count.
     */
    async hardDelete(formId, exec = this.db) {
        const [res] = await exec.delete(schema_1.forms).where((0, drizzle_orm_1.eq)(schema_1.forms.id, formId));
        return res.affectedRows;
    }
}
exports.FormsRepo = FormsRepo;
