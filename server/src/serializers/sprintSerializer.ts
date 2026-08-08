import type { Sprint as SprintRow } from "../db/schema";

/**
 * Wire-format `Sprint` per API_DESIGN.md §20 + Appendix A. snake_case; dates are
 * `YYYY-MM-DD`. The row also carries `workspace_id`, `created_at` and
 * `updated_at`, but the documented wire shape does NOT expose them (nor a
 * `completed_points` figure — that is derived at read time / snapshotted into
 * the audit feed on close, never a sprint column).
 *
 * Single source for the `Sprint` response shape, shared by every §20 endpoint
 * that returns a sprint — the same role `taskSerializer` plays for `Task`.
 */
export interface WireSprint {
    id: string;
    name: string;
    goal: string | null;
    start_date: string;
    end_date: string;
    status: "planned" | "active" | "closed";
    committed_points: number;
}

/**
 * Format a MySQL DATE to the `YYYY-MM-DD` wire form using **UTC** components.
 * Mirrors `taskSerializer.toWireDate`. A pre-formatted string (string-mode
 * columns) is sliced defensively.
 *
 * F3: this used LOCAL components, on the premise that the driver materialises a
 * DATE at local midnight. Drizzle's `MySqlDate.mapFromDriverValue` actually does
 * `new Date("YYYY-MM-DD")`, which is **UTC** midnight, and `SprintsService`'s
 * `toDateOnly` now writes it there — so UTC components are the exact,
 * process-TZ-independent reading. Local components only survived because Dhaka
 * sits east of UTC.
 */
export const formatWireDate = (value: Date | string): string => {
    if (typeof value === "string") return value.slice(0, 10);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

export const toWireSprint = (s: SprintRow): WireSprint => ({
    id: s.id,
    name: s.name,
    goal: s.goal,
    start_date: formatWireDate(s.startDate),
    end_date: formatWireDate(s.endDate),
    status: s.status,
    committed_points: s.committedPoints,
});
