import {
    and,
    count,
    desc,
    eq,
    inArray,
    isNull,
    lt,
    or,
    type SQL,
} from "drizzle-orm";
import { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../db/schema";
import {
    departmentReports,
    type DepartmentReport,
} from "../db/schema";
import { fakeId } from "../utils";
import type { DbExecutor } from "./types";

/**
 * Data access for `department_reports` (Dept Review V1).
 *
 * The UPSERT invariant (§2.5, enforced here and nowhere else): generation —
 * job or manual — updates ONLY `payload` / `generated_at` / `generated_by` /
 * the `head_user_id` snapshot. It must NEVER touch `head_note`,
 * `acknowledged_by/At` or `notified_at` — those belong to their own writers
 * (P21 note/ack, P20's atomic notification claim).
 */

export type DeptReportRecord = DepartmentReport;

export interface UpsertReportInput {
    workspaceId: string;
    spaceId: string;
    /** Dhaka Monday (`YYYY-MM-DD`). */
    weekStart: string;
    weekEnd: string;
    /** Head snapshot at generation — null for headless departments. */
    headUserId: string | null;
    payload: Record<string, unknown>;
    /** null = the automated job. */
    generatedBy: string | null;
    /** App-UTC generation instant. */
    generatedAt: Date;
}

export interface ReportListFilter {
    workspaceId: string;
    spaceId?: string;
    /**
     * Non-admin visibility (A-6 gate): rows in CURRENTLY-headed spaces OR
     * rows where the caller is the SNAPSHOT head (an ex-head keeps their own
     * past reports; a new head sees the space's history).
     */
    headVisibility?: { userId: string; headedSpaceIds: string[] };
}

export class DepartmentReportsRepo {
    constructor(private db: MySql2Database<typeof schema>) {}

    /** Insert-or-refresh one (space, week) row. Re-reads for the canonical
     *  record (the pre-existing id survives an update). */
    async upsert(
        input: UpsertReportInput,
        exec: DbExecutor = this.db,
    ): Promise<DeptReportRecord> {
        await exec
            .insert(departmentReports)
            .values({
                id: fakeId("rep"),
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
        const row = await this.findBySpaceWeek(
            input.spaceId,
            input.weekStart,
            exec,
        );
        if (!row) {
            // Unreachable: the row was just upserted in this executor.
            throw new Error("department_reports upsert read-back failed");
        }
        return row;
    }

    async findBySpaceWeek(
        spaceId: string,
        weekStart: string,
        exec: DbExecutor = this.db,
    ): Promise<DeptReportRecord | null> {
        const [row] = await exec
            .select()
            .from(departmentReports)
            .where(
                and(
                    eq(departmentReports.spaceId, spaceId),
                    eq(departmentReports.weekStart, weekStart),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /** Workspace-scoped read — absent or foreign id both resolve null. */
    async findByIdInWorkspace(
        id: string,
        workspaceId: string,
        exec: DbExecutor = this.db,
    ): Promise<DeptReportRecord | null> {
        const [row] = await exec
            .select()
            .from(departmentReports)
            .where(
                and(
                    eq(departmentReports.id, id),
                    eq(departmentReports.workspaceId, workspaceId),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    private filterWhere(f: ReportListFilter): SQL[] {
        const conds: SQL[] = [
            eq(departmentReports.workspaceId, f.workspaceId),
        ];
        if (f.spaceId) {
            conds.push(eq(departmentReports.spaceId, f.spaceId));
        }
        if (f.headVisibility) {
            const parts: SQL[] = [
                eq(departmentReports.headUserId, f.headVisibility.userId),
            ];
            if (f.headVisibility.headedSpaceIds.length > 0) {
                parts.push(
                    inArray(
                        departmentReports.spaceId,
                        f.headVisibility.headedSpaceIds,
                    ),
                );
            }
            conds.push(or(...parts) as SQL);
        }
        return conds;
    }

    /**
     * One keyset page, NEWEST WEEK FIRST with `internal_id` DESC as the
     * stable tie-break (A-8 can back-fill older weeks, so insertion order
     * diverges from week order — the composite key handles it). The `after`
     * predicate selects everything strictly later in that ordering.
     */
    async list(
        f: ReportListFilter & {
            afterKey?: { weekStart: string; internalId: bigint };
            limit: number;
        },
    ): Promise<DeptReportRecord[]> {
        const conds = this.filterWhere(f);
        if (f.afterKey) {
            conds.push(
                or(
                    lt(departmentReports.weekStart, f.afterKey.weekStart),
                    and(
                        eq(
                            departmentReports.weekStart,
                            f.afterKey.weekStart,
                        ),
                        lt(
                            departmentReports.internalId,
                            f.afterKey.internalId,
                        ),
                    ),
                ) as SQL,
            );
        }
        return this.db
            .select()
            .from(departmentReports)
            .where(and(...conds))
            .orderBy(
                desc(departmentReports.weekStart),
                desc(departmentReports.internalId),
            )
            .limit(f.limit);
    }

    /** Exact filtered count (the envelope's `total_estimate`). */
    async countFor(f: ReportListFilter): Promise<number> {
        const [row] = await this.db
            .select({ n: count() })
            .from(departmentReports)
            .where(and(...this.filterWhere(f)));
        return row?.n ?? 0;
    }

    /**
     * The ATOMIC one-time-fanout claim (v1.1 H-8): flips `notified_at` from
     * NULL exactly once per (space, week). Row-lock serialized — a weekly job
     * racing a manual generate elects a SINGLE notifier, and a pre-cron
     * manual generate can never suppress the weekly notification (whoever
     * generates first triggers it). Returns true iff THIS call won the claim.
     */
    async claimNotification(
        spaceId: string,
        weekStart: string,
        notifiedAt: Date,
        exec: DbExecutor = this.db,
    ): Promise<boolean> {
        const [result] = await exec
            .update(departmentReports)
            .set({ notifiedAt })
            .where(
                and(
                    eq(departmentReports.spaceId, spaceId),
                    eq(departmentReports.weekStart, weekStart),
                    isNull(departmentReports.notifiedAt),
                ),
            );
        return result.affectedRows === 1;
    }

    /** A-9 — the snapshot head's note (null clears). Nothing else moves. */
    async setHeadNote(
        id: string,
        headNote: string | null,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(departmentReports)
            .set({ headNote })
            .where(eq(departmentReports.id, id));
    }

    /**
     * A-10 — first-ack-wins (race-safe): the conditional UPDATE only lands
     * while `acknowledged_at IS NULL`, so concurrent acks keep the FIRST
     * actor/timestamp; later calls are no-ops (the endpoint stays
     * idempotent-200).
     */
    async acknowledgeIfFirst(
        id: string,
        userId: string,
        at: Date,
        exec: DbExecutor = this.db,
    ): Promise<void> {
        await exec
            .update(departmentReports)
            .set({ acknowledgedBy: userId, acknowledgedAt: at })
            .where(
                and(
                    eq(departmentReports.id, id),
                    isNull(departmentReports.acknowledgedAt),
                ),
            );
    }
}
