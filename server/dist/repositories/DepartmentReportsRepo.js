"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DepartmentReportsRepo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const utils_1 = require("../utils");
class DepartmentReportsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Insert-or-refresh one (space, week) row. Re-reads for the canonical
     *  record (the pre-existing id survives an update). */
    async upsert(input, exec = this.db) {
        await exec
            .insert(schema_1.departmentReports)
            .values({
            id: (0, utils_1.fakeId)("rep"),
            workspaceId: input.workspaceId,
            spaceId: input.spaceId,
            weekStart: input.weekStart,
            weekEnd: input.weekEnd,
            headUserId: input.headUserId,
            payload: input.payload,
            generatedBy: input.generatedBy,
            generatedAt: input.generatedAt,
        })
            .onDuplicateKeyUpdate({
            set: {
                payload: input.payload,
                headUserId: input.headUserId,
                generatedBy: input.generatedBy,
                generatedAt: input.generatedAt,
            },
        });
        const row = await this.findBySpaceWeek(input.spaceId, input.weekStart, exec);
        if (!row) {
            // Unreachable: the row was just upserted in this executor.
            throw new Error("department_reports upsert read-back failed");
        }
        return row;
    }
    async findBySpaceWeek(spaceId, weekStart, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.departmentReports)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.departmentReports.spaceId, spaceId), (0, drizzle_orm_1.eq)(schema_1.departmentReports.weekStart, weekStart)))
            .limit(1);
        return row ?? null;
    }
    /** Workspace-scoped read — absent or foreign id both resolve null. */
    async findByIdInWorkspace(id, workspaceId, exec = this.db) {
        const [row] = await exec
            .select()
            .from(schema_1.departmentReports)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.departmentReports.id, id), (0, drizzle_orm_1.eq)(schema_1.departmentReports.workspaceId, workspaceId)))
            .limit(1);
        return row ?? null;
    }
    filterWhere(f) {
        const conds = [
            (0, drizzle_orm_1.eq)(schema_1.departmentReports.workspaceId, f.workspaceId),
        ];
        if (f.spaceId) {
            conds.push((0, drizzle_orm_1.eq)(schema_1.departmentReports.spaceId, f.spaceId));
        }
        if (f.headVisibility) {
            const parts = [
                (0, drizzle_orm_1.eq)(schema_1.departmentReports.headUserId, f.headVisibility.userId),
            ];
            if (f.headVisibility.headedSpaceIds.length > 0) {
                parts.push((0, drizzle_orm_1.inArray)(schema_1.departmentReports.spaceId, f.headVisibility.headedSpaceIds));
            }
            conds.push((0, drizzle_orm_1.or)(...parts));
        }
        return conds;
    }
    /**
     * One keyset page, NEWEST WEEK FIRST with `internal_id` DESC as the
     * stable tie-break (A-8 can back-fill older weeks, so insertion order
     * diverges from week order — the composite key handles it). The `after`
     * predicate selects everything strictly later in that ordering.
     */
    async list(f) {
        const conds = this.filterWhere(f);
        if (f.afterKey) {
            conds.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.lt)(schema_1.departmentReports.weekStart, f.afterKey.weekStart), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.departmentReports.weekStart, f.afterKey.weekStart), (0, drizzle_orm_1.lt)(schema_1.departmentReports.internalId, f.afterKey.internalId))));
        }
        return this.db
            .select()
            .from(schema_1.departmentReports)
            .where((0, drizzle_orm_1.and)(...conds))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.departmentReports.weekStart), (0, drizzle_orm_1.desc)(schema_1.departmentReports.internalId))
            .limit(f.limit);
    }
    /** Exact filtered count (the envelope's `total_estimate`). */
    async countFor(f) {
        const [row] = await this.db
            .select({ n: (0, drizzle_orm_1.count)() })
            .from(schema_1.departmentReports)
            .where((0, drizzle_orm_1.and)(...this.filterWhere(f)));
        return row?.n ?? 0;
    }
    /**
     * The ATOMIC one-time-fanout claim (v1.1 H-8): flips `notified_at` from
     * NULL exactly once per (space, week). Row-lock serialized — a weekly job
     * racing a manual generate elects a SINGLE notifier, and a pre-cron
     * manual generate can never suppress the weekly notification (whoever
     * generates first triggers it). Returns true iff THIS call won the claim.
     */
    async claimNotification(spaceId, weekStart, notifiedAt, exec = this.db) {
        const [result] = await exec
            .update(schema_1.departmentReports)
            .set({ notifiedAt })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.departmentReports.spaceId, spaceId), (0, drizzle_orm_1.eq)(schema_1.departmentReports.weekStart, weekStart), (0, drizzle_orm_1.isNull)(schema_1.departmentReports.notifiedAt)));
        return result.affectedRows === 1;
    }
    /** A-9 — the snapshot head's note (null clears). Nothing else moves. */
    async setHeadNote(id, headNote, exec = this.db) {
        await exec
            .update(schema_1.departmentReports)
            .set({ headNote })
            .where((0, drizzle_orm_1.eq)(schema_1.departmentReports.id, id));
    }
    /**
     * A-10 — first-ack-wins (race-safe): the conditional UPDATE only lands
     * while `acknowledged_at IS NULL`, so concurrent acks keep the FIRST
     * actor/timestamp; later calls are no-ops (the endpoint stays
     * idempotent-200).
     */
    async acknowledgeIfFirst(id, userId, at, exec = this.db) {
        await exec
            .update(schema_1.departmentReports)
            .set({ acknowledgedBy: userId, acknowledgedAt: at })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.departmentReports.id, id), (0, drizzle_orm_1.isNull)(schema_1.departmentReports.acknowledgedAt)));
    }
}
exports.DepartmentReportsRepo = DepartmentReportsRepo;
