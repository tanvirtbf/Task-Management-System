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
 * Render a MySQL DATE as `YYYY-MM-DD` from LOCAL date components (mirrors
 * `taskSerializer.toWireDate`): mysql2 materialises a DATE as a Date at local
 * midnight, so `toISOString()` could shift it across the UTC boundary. Accepts
 * a pre-formatted string defensively (string-mode columns / drivers).
 */
const toWireDate = (value: Date | string): string => {
    if (typeof value === "string") return value.slice(0, 10);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

export const toWireOnCallShift = (s: OnCallShiftRecord): WireOnCallShift => ({
    id: s.id,
    week_start: toWireDate(s.weekStart),
    week_end: toWireDate(s.weekEnd),
    engineer: toWireUser(s.engineer),
});
