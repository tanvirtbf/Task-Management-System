import { and, asc, eq, sql } from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import { formFields, forms, lists, spaces } from "../db/schema";
import type { FormField, NewFormField } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for `form_fields`. Uniqueness is `(form_id, field_kind,
 * field_key)`; `position` is NOT unique. `field_kind='custom_field'` stores a
 * `custom_fields.id` in `field_key` (a plain VARCHAR — the app validates it).
 */
export class FormFieldsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** A form's fields, ordered by position then insertion. */
    async listByForm(
        formId: string,
        exec: DbExecutor = this.db,
    ): Promise<FormField[]> {
        return exec
            .select()
            .from(formFields)
            .where(eq(formFields.formId, formId))
            .orderBy(asc(formFields.position), asc(formFields.createdAt));
    }

    async insert(
        values: NewFormField,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(formFields).values(values);
    }

    /** Next append position (MAX+1) for a form's fields. */
    async nextPosition(
        formId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [row] = await exec
            .select({
                max: sql<number>`COALESCE(MAX(${formFields.position}), -1)`,
            })
            .from(formFields)
            .where(eq(formFields.formId, formId));
        return Number(row?.max ?? -1) + 1;
    }

    /**
     * Find a field by id, scoped to a workspace via the form→list→space join
     * (the `/form-fields/:id` routes have no form in the path). Returns the
     * field + its `formId`, or null (404 source — no cross-tenant oracle).
     */
    async findByIdInWorkspace(
        fieldId: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<FormField | null> {
        const [row] = await exec
            .select({ field: formFields })
            .from(formFields)
            .innerJoin(forms, eq(forms.id, formFields.formId))
            .innerJoin(lists, eq(lists.id, forms.listId))
            .innerJoin(spaces, eq(spaces.id, lists.spaceId))
            .where(
                and(
                    eq(formFields.id, fieldId),
                    eq(spaces.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row?.field ?? null;
    }

    /** The set of field ids belonging to a form (reorder membership check). */
    async idSetForForm(
        formId: string,
        exec: DbExecutor = this.db,
    ): Promise<Set<string>> {
        const rows = await exec
            .select({ id: formFields.id })
            .from(formFields)
            .where(eq(formFields.formId, formId));
        return new Set(rows.map((r) => r.id));
    }

    async update(
        fieldId: string,
        patch: Partial<Omit<NewFormField, "id" | "formId">>,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(formFields)
            .set(patch)
            .where(eq(formFields.id, fieldId));
    }

    async updatePosition(
        fieldId: string,
        position: number,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(formFields)
            .set({ position })
            .where(eq(formFields.id, fieldId));
    }

    async deleteById(
        fieldId: string,
        exec: DbExecutor = this.db,
    ): Promise<number> {
        const [res] = await exec
            .delete(formFields)
            .where(eq(formFields.id, fieldId));
        return res.affectedRows;
    }
}
