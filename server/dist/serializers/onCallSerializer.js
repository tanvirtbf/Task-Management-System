"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireOnCallShift = void 0;
const userSerializer_1 = require("./userSerializer");
/**
 * Render a MySQL DATE as `YYYY-MM-DD` from **UTC** date components (mirrors
 * `taskSerializer.toWireDate`). A DATE is a calendar day with no timezone, and
 * Drizzle materialises it at UTC midnight, so UTC components are exact under any
 * process TZ. Changed from local components in F3 — see the note there.
 * Accepts a pre-formatted string defensively (string-mode columns / drivers).
 */
const toWireDate = (value) => {
    if (typeof value === "string")
        return value.slice(0, 10);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};
const toWireOnCallShift = (s) => ({
    id: s.id,
    week_start: toWireDate(s.weekStart),
    week_end: toWireDate(s.weekEnd),
    engineer: (0, userSerializer_1.toWireUser)(s.engineer),
});
exports.toWireOnCallShift = toWireOnCallShift;
