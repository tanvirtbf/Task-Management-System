import { toWireUser, type WireUser } from "./userSerializer";
import type { OnCallShiftRecord } from "../repositories/OnCallRepo";

/**
 * Wire-format `OnCallShift` per API_DESIGN.md §21 + Appendix A. snake_case;
 * never leaks `workspace_id`, `created_by`, or the timestamps. `week_start` /
 * `week_end` are MySQL DATE columns rendered as `YYYY-MM-DD`; `engineer` is the
 * full canonical `User` (via `toWireUser`), not a bare id — the frontend's flat
 * `engineerId` is a mock-only shape the client reconciles at integration.
 *
 * Single source for the on-call response shape, shared by every §21 endpoint
 * that returns a shift.
 */
export interface WireOnCallShift {
    id: string;
    week_start: string;
    week_end: string;
    engineer: WireUser;
}

/**
 * Render a MySQL DATE as `YYYY-MM-DD` from **UTC** date components (mirrors
 * `taskSerializer.toWireDate`). A DATE is a calendar day with no timezone, and
 * Drizzle materialises it at UTC midnight, so UTC components are exact under any
 * process TZ. Changed from local components in F3 — see the note there.
 * Accepts a pre-formatted string defensively (string-mode columns / drivers).
 */
const toWireDate = (value: Date | string): string => {
    if (typeof value === "string") return value.slice(0, 10);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

export const toWireOnCallShift = (s: OnCallShiftRecord): WireOnCallShift => ({
    id: s.id,
    week_start: toWireDate(s.weekStart),
    week_end: toWireDate(s.weekEnd),
    engineer: toWireUser(s.engineer),
});
