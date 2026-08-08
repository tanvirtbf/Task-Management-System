"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireSprint = exports.formatWireDate = void 0;
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
const formatWireDate = (value) => {
    if (typeof value === "string")
        return value.slice(0, 10);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
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
