"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormSubmissionsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/**
 * Data access for `form_submissions`. `submission_count` on the parent form is
 * trigger-maintained on insert — never written here. Listing is newest-first,
 * keyset-paginated on the `internal_id` BIGINT.
 */
class FormSubmissionsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Insert a submission (caller supplies the id). The AFTER INSERT trigger bumps forms.submission_count. */
    async insert(values, exec = this.db) {
        await exec.insert(schema_1.formSubmissions).values(values);
    }
    /**
     * One newest-first page of a form's submissions. Keyset on `internal_id`
     * DESC; callers pass `limit + 1` and use the extra row to derive `has_more`.
     */
    async listByForm(params) {
        return this.db
            .select()
            .from(schema_1.formSubmissions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.formSubmissions.formId, params.formId), params.beforeInternalId !== undefined
            ? (0, drizzle_orm_1.lt)(schema_1.formSubmissions.internalId, params.beforeInternalId)
            : undefined))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.formSubmissions.internalId))
            .limit(params.limit);
    }
    /** Exact submission count for a form — feeds `pagination.total_estimate`. */
    async countByForm(formId) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.formSubmissions)
            .where((0, drizzle_orm_1.eq)(schema_1.formSubmissions.formId, formId));
        return row?.value ?? 0;
    }
    /** Count submissions expired before a cutoff timestamp (90-day retention job). */
    async countExpiredBefore(cutoff) {
        const [row] = await this.db
            .select({ value: (0, drizzle_orm_1.count)() })
            .from(schema_1.formSubmissions)
            .where((0, drizzle_orm_1.lt)(schema_1.formSubmissions.expiresAt, cutoff));
        return row?.value ?? 0;
    }
    /** Hard-delete submissions expired before a cutoff timestamp. Returns count deleted. */
    async deleteExpiredBefore(cutoff) {
        const result = await this.db
            .delete(schema_1.formSubmissions)
            .where((0, drizzle_orm_1.lt)(schema_1.formSubmissions.expiresAt, cutoff));
        return result[0]?.affectedRows ?? 0;
    }
}
exports.FormSubmissionsRepo = FormSubmissionsRepo;
