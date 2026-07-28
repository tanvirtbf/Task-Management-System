"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireSprint = exports.formatWireDate = void 0;
/**
 * Format a MySQL DATE to the `YYYY-MM-DD` wire form using LOCAL date components.
 * The mysql2 driver materialises a DATE as a Date at local midnight, so
 * `toISOString()` could shift it across the UTC boundary. A pre-formatted string
 * (string-mode columns) is sliced defensively. Mirrors `taskSerializer`.
 */
const formatWireDate = (value) => {
    if (typeof value === "string")
        return value.slice(0, 10);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};
exports.formatWireDate = formatWireDate;
const toWireSprint = (s) => ({
    id: s.id,
    name: s.name,
    goal: s.goal,
    start_date: (0, exports.formatWireDate)(s.startDate),
    end_date: (0, exports.formatWireDate)(s.endDate),
    status: s.status,
    committed_points: s.committedPoints,
});
exports.toWireSprint = toWireSprint;
