"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireOnCallShift = void 0;
const userSerializer_1 = require("./userSerializer");
/**
 * Render a MySQL DATE as `YYYY-MM-DD` from LOCAL date components (mirrors
 * `taskSerializer.toWireDate`): mysql2 materialises a DATE as a Date at local
 * midnight, so `toISOString()` could shift it across the UTC boundary. Accepts
 * a pre-formatted string defensively (string-mode columns / drivers).
 */
const toWireDate = (value) => {
    if (typeof value === "string")
        return value.slice(0, 10);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};
const toWireOnCallShift = (s) => ({
    id: s.id,
    week_start: toWireDate(s.weekStart),
    week_end: toWireDate(s.weekEnd),
    engineer: (0, userSerializer_1.toWireUser)(s.engineer),
});
exports.toWireOnCallShift = toWireOnCallShift;
