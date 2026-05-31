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
 * Format a MySQL DATE to the `YYYY-MM-DD` wire form using LOCAL date components.
 * The mysql2 driver materialises a DATE as a Date at local midnight, so
 * `toISOString()` could shift it across the UTC boundary. A pre-formatted string
 * (string-mode columns) is sliced defensively. Mirrors `taskSerializer`.
 */
export const formatWireDate = (value: Date | string): string => {
    if (typeof value === "string") return value.slice(0, 10);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
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
