import { and, desc, eq } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { forms, lists, spaces } from "../db/schema";
import type { Form, NewForm } from "../db/schema";
import { listScopeFilter } from "../rbac/context";
import type { DbExecutor } from "./types";

/**
 * Data access for `forms`. `forms` has NO `workspace_id` column — tenant
 * isolation is enforced via the `forms → lists → spaces.workspace_id` join in
 * every workspace-scoped method. `public_slug` is GLOBALLY unique
 * (`uq_forms_public_slug`), so the slug resolver needs no workspace scope.
 * `submission_count` is trigger-maintained (never written here).
 */
export class FormsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

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
    async findByIdInWorkspace(
        formId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<Form | null> {
        const [row] = await exec
            .select({ form: forms })
            .from(forms)
            .innerJoin(lists, eq(lists.id, forms.listId))
            .innerJoin(spaces, eq(spaces.id, lists.spaceId))
            .where(
                and(
                    eq(forms.id, formId),
                    eq(spaces.workspaceId, workspaceId),
                    await listScopeFilter(forms.listId),
                ),
            )
            .limit(1);
        return row?.form ?? null;
    }

    /** All forms VISIBLE to the caller (newest first) — F9/ISS-084 scoped. */
    async listByWorkspace(workspaceId: string): Promise<Form[]> {
        const rows = await this.db
            .select({ form: forms })
            .from(forms)
            .innerJoin(lists, eq(lists.id, forms.listId))
            .innerJoin(spaces, eq(spaces.id, lists.spaceId))
            .where(
                and(
                    eq(spaces.workspaceId, workspaceId),
                    await listScopeFilter(forms.listId),
                ),
            )
            .orderBy(desc(forms.createdAt));
        return rows.map((r) => r.form);
    }

    /** Forms attached to a specific list (workspace-scoped, newest first). */
    async listByList(listId: string, workspaceId: string): Promise<Form[]> {
        const rows = await this.db
            .select({ form: forms })
            .from(forms)
            .innerJoin(lists, eq(lists.id, forms.listId))
            .innerJoin(spaces, eq(spaces.id, lists.spaceId))
            .where(
                and(
                    eq(forms.listId, listId),
                    eq(spaces.workspaceId, workspaceId),
                ),
            )
            .orderBy(desc(forms.createdAt));
        return rows.map((r) => r.form);
    }

    /**
     * Resolve a form by its global public slug (the public endpoints). Returns
     * the form + the owning `workspace_id` (needed to scope the created task on
     * submit). No workspace filter — the slug is the public key.
     */
    async resolveBySlug(
        slug: string,
        exec: DbExecutor = this.db,
    ): Promise<{ form: Form; workspaceId: string } | null> {
        const [row] = await exec
            .select({ form: forms, workspaceId: spaces.workspaceId })
            .from(forms)
            .innerJoin(lists, eq(lists.id, forms.listId))
            .innerJoin(spaces, eq(spaces.id, lists.spaceId))
            .where(eq(forms.publicSlug, slug))
            .limit(1);
        return row ? { form: row.form, workspaceId: row.workspaceId } : null;
    }

    /** Cheap existence check for slug-collision avoidance during generation. */
    async slugExists(slug: string, exec: DbExecutor = this.db): Promise<boolean> {
        const [row] = await exec
            .select({ id: forms.id })
            .from(forms)
            .where(eq(forms.publicSlug, slug))
            .limit(1);
        return Boolean(row);
    }

    async insert(values: NewForm, exec: DbExecutor = this.db): Promise<void> {
        await exec.insert(forms).values(values);
    }

    /** Partial update by PK; `updated_at` bumped explicitly. Never writes submission_count. */
    async update(
        formId: string,
        patch: Partial<Omit<NewForm, "id" | "submissionCount">>,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(forms)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(forms.id, formId));
    }

    /**
     * Hard-delete a form. `fk_form_fields_form` + `fk_form_submissions_form` are
     * ON DELETE CASCADE, so fields + submissions are torn down by the DB; tasks
     * created from submissions survive (the submission→task FK is SET NULL the
     * other direction). Returns affected-row count.
     */
    async hardDelete(
        formId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [res] = await exec.delete(forms).where(eq(forms.id, formId));
        return res.affectedRows;
    }
}
