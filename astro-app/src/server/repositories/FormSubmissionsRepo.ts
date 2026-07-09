import { and, count, desc, eq, lt } from "drizzle-orm";
import { MySql2Database } from "../db/client";
import * as schema from "../db/schema";
import { formSubmissions } from "../db/schema";
import type { FormSubmission, NewFormSubmission } from "../db/schema";
import type { DbExecutor } from "./types";

/**
 * Data access for `form_submissions`. `submission_count` on the parent form is
 * trigger-maintained on insert — never written here. Listing is newest-first,
 * keyset-paginated on the `internal_id` INTEGER PK.
 */
export class FormSubmissionsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Insert a submission (caller supplies the id). The AFTER INSERT trigger bumps forms.submission_count. */
    async insert(
        values: NewFormSubmission,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec.insert(formSubmissions).values(values);
    }

    /**
     * One newest-first page of a form's submissions. Keyset on `internal_id`
     * DESC; callers pass `limit + 1` and use the extra row to derive `has_more`.
     */
    async listByForm(params: {
        formId: string;
        beforeInternalId?: number;
        limit: number;
    }): Promise<FormSubmission[]> {
        return this.db
            .select()
            .from(formSubmissions)
            .where(
                and(
                    eq(formSubmissions.formId, params.formId),
                    params.beforeInternalId !== undefined
                        ? lt(formSubmissions.internalId, params.beforeInternalId)
                        : undefined,
                ),
            )
            .orderBy(desc(formSubmissions.internalId))
            .limit(params.limit);
    }

    /** Exact submission count for a form — feeds `pagination.total_estimate`. */
    async countByForm(formId: string): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(formSubmissions)
            .where(eq(formSubmissions.formId, formId));
        return row?.value ?? 0;
    }

    /** Count submissions expired before a cutoff timestamp (90-day retention job). */
    async countExpiredBefore(cutoff: Date): Promise<number> {
        const [row] = await this.db
            .select({ value: count() })
            .from(formSubmissions)
            .where(lt(formSubmissions.expiresAt, cutoff));
        return row?.value ?? 0;
    }

    /** Hard-delete submissions expired before a cutoff timestamp. Returns count deleted. */
    async deleteExpiredBefore(cutoff: Date): Promise<number> {
        const result = await this.db
            .delete(formSubmissions)
            .where(lt(formSubmissions.expiresAt, cutoff));
        return result.rowsAffected ?? 0;
    }
}
