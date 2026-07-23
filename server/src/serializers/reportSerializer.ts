import type { DeptReportRecord } from "../repositories/DepartmentReportsRepo";
import type {
    DeptReportPayload,
    ReportTotals,
} from "../services/ReportStatsService";
import {
    toWireUser,
    type WireUser,
    type WireUserSource,
} from "./userSerializer";

/**
 * Wire shapes for `department_reports` (Dept Review V1). snake_case;
 * `internal_id` and `notified_at` (internal fan-out mechanics) never leave
 * the server. `week_*` are Dhaka calendar strings as stored.
 *
 * The LIST item carries only the payload's `totals` (the /reports cards need
 * a preview, not the full member matrix); the DETAIL carries the whole
 * payload snapshot.
 */

interface WireDepartmentReportBase {
    id: string;
    space_id: string;
    week_start: string;
    week_end: string;
    head_user_id: string | null;
    /** Hydrated SNAPSHOT head (null for headless departments). */
    head: WireUser | null;
    head_note: string | null;
    generated_by: string | null;
    generated_at: string;
    acknowledged_by: string | null;
    acknowledged_at: string | null;
}

export interface WireDepartmentReportListItem
    extends WireDepartmentReportBase {
    totals: ReportTotals | null;
}

export interface WireDepartmentReport extends WireDepartmentReportBase {
    payload: DeptReportPayload;
}

const base = (
    r: DeptReportRecord,
    head: WireUserSource | null,
): WireDepartmentReportBase => ({
    id: r.id,
    space_id: r.spaceId,
    week_start: r.weekStart,
    week_end: r.weekEnd,
    head_user_id: r.headUserId,
    head: head ? toWireUser(head) : null,
    head_note: r.headNote,
    generated_by: r.generatedBy,
    generated_at: r.generatedAt.toISOString(),
    acknowledged_by: r.acknowledgedBy,
    acknowledged_at: r.acknowledgedAt
        ? r.acknowledgedAt.toISOString()
        : null,
});

export const toWireReportListItem = (
    r: DeptReportRecord,
    head: WireUserSource | null,
): WireDepartmentReportListItem => ({
    ...base(r, head),
    totals: (r.payload as DeptReportPayload | null)?.totals ?? null,
});

export const toWireReport = (
    r: DeptReportRecord,
    head: WireUserSource | null,
): WireDepartmentReport => ({
    ...base(r, head),
    payload: r.payload as DeptReportPayload,
});
