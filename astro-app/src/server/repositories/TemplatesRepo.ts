import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { templates } from "../db/schema";
import type { DbExecutor } from "./types";
import type { TemplateStructure, TemplateType } from "../types/templates";

/**
 * Data access for the `templates` table (§23). Owns the Drizzle queries; the
 * service composes business logic over the rows this repo returns.
 *
 * Unlike most catalog repos, the wire `Template` (API_DESIGN.md §23) exposes
 * EVERY column — `workspace_id`, `usage_count`, `created_by`, and the
 * timestamps are all part of the response — so each method selects the full
 * row rather than a trimmed projection.
 */

export type TemplateRecord = typeof templates.$inferSelect;

export interface TemplateListFilters {
    /** Optional `type` enum filter. */
    type?: TemplateType;
    /** Optional case-insensitive name search (LIKE). */
    q?: string;
}

/**
 * Row to insert for a new template. `id`, `workspaceId`, `type`, `name`,
 * `structure`, and `createdBy` are always supplied by the service; the rest are
 * nullable. `usage_count` is never accepted — it starts at the column DEFAULT
 * (0) and only `/apply` moves it.
 */
export interface NewTemplateRow {
    id: string;
    workspaceId: string;
    type: TemplateType;
    name: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    structure: TemplateStructure;
    createdBy: string;
}

/**
 * Columns settable by `PATCH`. Only the keys the client actually sent are
 * present, so untouched columns are never overwritten. `type`, `usage_count`,
 * `created_by`, and `workspace_id` are absent by design — they are not
 * patchable through the API.
 */
export interface TemplateUpdateRow {
    name?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    structure?: TemplateStructure;
}

/** Escape LIKE wildcards so a `q` containing `%`/`_`/`\` is matched literally. */
const escapeLike = (value: string): string =>
    value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export class TemplatesRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /**
     * List the templates in a workspace, newest first with a stable `id`
     * tie-break. Optional `type` (exact) and `q` (case-insensitive name LIKE,
     * wildcards escaped) filters narrow the set. Backed by
     * `idx_templates_workspace_type (workspace_id, type)`.
     */
    async listByWorkspace(
        workspaceId: string,
        filters: TemplateListFilters = {},
    ): Promise<TemplateRecord[]> {
        const conditions = [eq(templates.workspaceId, workspaceId)];
        if (filters.type) {
            conditions.push(eq(templates.type, filters.type));
        }
        if (filters.q && filters.q.length > 0) {
            conditions.push(like(templates.name, `%${escapeLike(filters.q)}%`));
        }
        return this.db
            .select()
            .from(templates)
            .where(and(...conditions))
            .orderBy(desc(templates.createdAt), asc(templates.id));
    }

    /**
     * Fetch one template scoped to its workspace, or `null` if it does not exist
     * there (so a cross-tenant id is indistinguishable from a missing one — no
     * existence oracle). `forUpdate` is kept for API compatibility but is a
     * no-op: SQLite has no `SELECT … FOR UPDATE` — writing transactions are
     * serialised by the engine, so the caller's tx already excludes a
     * concurrent update/delete of the same row.
     */
    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        opts: { forUpdate?: boolean } = {},
    ): Promise<TemplateRecord | null> {
        const query = exec
            .select()
            .from(templates)
            .where(
                and(
                    eq(templates.id, id),
                    eq(templates.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        const [row] = await query;
        return row ?? null;
    }

    /**
     * Insert a template and return the full stored row. A `(workspace_id, name)`
     * collision surfaces as the driver's `SQLITE_CONSTRAINT_UNIQUE` — the service
     * maps it to `409 template.duplicate`. Pass `exec` to run inside a transaction.
     */
    async create(
        row: NewTemplateRow,
        exec: DbExecutor = this.db,
    ): Promise<TemplateRecord> {
        await exec.insert(templates).values({
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
            .from(templates)
            .where(eq(templates.id, row.id))
            .limit(1);
        if (!created) {
            // Unreachable: the row was just inserted on this same executor.
            throw new Error(
                `template ${row.id} missing immediately after insert`,
            );
        }
        return created;
    }

    /**
     * Apply a partial update by id and return the full stored row. Only the
     * columns present in `patch` are written; `updated_at` is bumped by the
     * schema's `$onUpdate`. A `(workspace_id, name)` collision on rename
     * surfaces as `SQLITE_CONSTRAINT_UNIQUE` — the service maps it to 409. Caller
     * guarantees `patch` is non-empty and the row exists (resolved in the same tx).
     */
    async update(
        id: string,
        patch: TemplateUpdateRow,
        exec: DbExecutor = this.db,
    ): Promise<TemplateRecord> {
        await exec.update(templates).set(patch).where(eq(templates.id, id));

        const [updated] = await exec
            .select()
            .from(templates)
            .where(eq(templates.id, id))
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
    async deleteById(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const result = await exec
            .delete(templates)
            .where(eq(templates.id, id));
        return result.rowsAffected;
    }

    /**
     * Atomically bump `usage_count` by one. Used by `POST /templates/:id/apply`
     * inside its transaction so the increment commits with the spawned task.
     */
    async incrementUsage(
        id: string,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(templates)
            .set({ usageCount: sql`${templates.usageCount} + 1` })
            .where(eq(templates.id, id));
    }
}
