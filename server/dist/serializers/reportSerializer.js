"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireReport = exports.toWireReportListItem = void 0;
const userSerializer_1 = require("./userSerializer");
const base = (r, head) => ({
    id: r.id,
    space_id: r.spaceId,
    week_start: r.weekStart,
    week_end: r.weekEnd,
    head_user_id: r.headUserId,
    head: head ? (0, userSerializer_1.toWireUser)(head) : null,
    head_note: r.headNote,
    generated_by: r.generatedBy,
    generated_at: r.generatedAt.toISOString(),
    acknowledged_by: r.acknowledgedBy,
    acknowledged_at: r.acknowledgedAt
        ? r.acknowledgedAt.toISOString()
        : null,
});
const toWireReportListItem = (r, head) => ({
    ...base(r, head),
    totals: r.payload?.totals ?? null,
});
exports.toWireReportListItem = toWireReportListItem;
const toWireReport = (r, head) => ({
    ...base(r, head),
    payload: r.payload,
});
exports.toWireReport = toWireReport;
