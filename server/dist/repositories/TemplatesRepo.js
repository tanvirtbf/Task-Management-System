"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplatesRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/** Escape LIKE wildcards so a `q` containing `%`/`_`/`\` is matched literally. */
const escapeLike = (value) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
class TemplatesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * List the templates in a workspace, newest first with a stable `id`
     * tie-break. Optional `type` (exact) and `q` (case-insensitive name LIKE,
     * wildcards escaped) filters narrow the set. Backed by
     * `idx_templates_workspace_type (workspace_id, type)`.
     */
    async listByWorkspace(workspaceId, filters = {}) {
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.templates.workspaceId, workspaceId)];
        if (filters.type) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.templates.type, filters.type));
        }
        if (filters.q && filters.q.length > 0) {
            conditions.push((0, drizzle_orm_1.like)(schema_1.templates.name, `%${escapeLike(filters.q)}%`));
        }
        return this.db
            .select()
            .from(schema_1.templates)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.templates.createdAt), (0, drizzle_orm_1.asc)(schema_1.templates.id));
    }
    /**
     * Fetch one template scoped to its workspace, or `null` if it does not exist
     * there (so a cross-tenant id is indistinguishable from a missing one — no
     * existence oracle). Pass `forUpdate` to take a `SELECT … FOR UPDATE` row
     * lock inside the caller's transaction, serialising a concurrent
     * update/delete of the same row.
     */
    async findByIdInWorkspace(id, workspaceId, exec = this.db, opts = {}) {
        const query = exec
            .select()
            .from(schema_1.templates)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.templates.id, id), (0, drizzle_orm_1.eq)(schema_1.templates.workspaceId, workspaceId)))
            .limit(1);
        const [row] = opts.forUpdate ? await query.for("update") : await query;
        return row ?? null;
    }
    /**
     * Insert a template and return the full stored row. A `(workspace_id, name)`
     * collision surfaces as the driver's `ER_DUP_ENTRY` — the service maps it to
     * `409 template.duplicate`. Pass `exec` to run inside a transaction.
     */
    async create(row, exec = this.db) {
        await exec.insert(schema_1.templates).values({
            id: row.id,
            workspaceId: row.workspaceId,
            type: row.type,
            name: row.name,
            description: row.description,
            icon: row.icon,
            color: row.color,
            structure: row.structure,
            createdBy: row.createdBy,
        });
        const [created] = await exec
            .select()
            .from(schema_1.templates)
            .where((0, drizzle_orm_1.eq)(schema_1.templates.id, row.id))
            .limit(1);
        if (!created) {
            // Unreachable: the row was just inserted on this same executor.
            throw new Error(`template ${row.id} missing immediately after insert`);
        }
        return created;
    }
    /**
     * Apply a partial update by id and return the full stored row. Only the
     * columns present in `patch` are written; `updated_at` is bumped by the
     * schema's `ON UPDATE CURRENT_TIMESTAMP`. A `(workspace_id, name)` collision
     * on rename surfaces as `ER_DUP_ENTRY` — the service maps it to 409. Caller
     * guarantees `patch` is non-empty and the row exists (locked in the same tx).
     */
    async update(id, patch, exec = this.db) {
        await exec.update(schema_1.templates).set(patch).where((0, drizzle_orm_1.eq)(schema_1.templates.id, id));
        const [updated] = await exec
            .select()
            .from(schema_1.templates)
            .where((0, drizzle_orm_1.eq)(schema_1.templates.id, id))
            .limit(1);
        if (!updated) {
            // Unreachable: the row is locked for the duration of the tx.
            throw new Error(`template ${id} missing immediately after update`);
        }
        return updated;
    }
    /**
     * Hard-delete a template by id, returning the affected-row count. Zero means
     * the row was already gone (a concurrent delete won the race) — the caller
     * renders that as `404 template.not_found`. The write is keyed on the PK
     * alone, so callers MUST have resolved the id within the workspace first.
     * Spawned tasks are unaffected (no FK from `tasks` to `templates`).
     */
    async deleteById(id, exec = this.db) {
        const [result] = await exec
            .delete(schema_1.templates)
            .where((0, drizzle_orm_1.eq)(schema_1.templates.id, id));
        return result.affectedRows;
    }
    /**
     * Atomically bump `usage_count` by one. Used by `POST /templates/:id/apply`
     * inside its transaction so the increment commits with the spawned task.
     */
    async incrementUsage(id, exec = this.db) {
        await exec
            .update(schema_1.templates)
            .set({ usageCount: (0, drizzle_orm_1.sql) `${schema_1.templates.usageCount} + 1` })
            .where((0, drizzle_orm_1.eq)(schema_1.templates.id, id));
    }
}
exports.TemplatesRepo = TemplatesRepo;
