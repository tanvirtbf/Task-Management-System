"use strict";
/**
 * Dhaka-calendar date helpers (Dept Review V1 — plan §5 rule 3).
 *
 * Bangladesh is permanently UTC+6 with NO daylight-saving time, so a fixed
 * offset is exact — no tz database needed. All comparisons run on app-UTC
 * instants (bound params); these helpers only derive the Dhaka CALENDAR
 * labels ("today", week keys) from those instants. Never use server-local
 * `new Date()` component math for "today" — the deploy box's tz must not
 * change business results.
 *
 * P18 extends this module with the Mon–Sun week math for weekly reports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.weekBoundsUtc = exports.previousWeekStart = exports.dhakaWeekOf = exports.isDhakaMonday = exports.addDaysYmd = exports.dhakaToday = exports.dhakaDateOf = void 0;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
/** The Dhaka calendar date (`YYYY-MM-DD`) of a UTC instant. */
const dhakaDateOf = (utc) => new Date(utc.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
exports.dhakaDateOf = dhakaDateOf;
/** Today's date in the Dhaka calendar (`YYYY-MM-DD`). */
const dhakaToday = () => (0, exports.dhakaDateOf)(new Date());
exports.dhakaToday = dhakaToday;
// ─── Week math (P18 — weekly department reports) ─────────────────────────────
// Weeks are Dhaka-calendar Monday→Sunday (D-3). All arithmetic is pure UTC
// day-shifting on the calendar STRINGS; instants only appear at the
// `weekBoundsUtc` edge, where the fixed +06:00 offset converts the Dhaka
// midnight boundaries into the UTC bounds that app-UTC timestamps
// (completed_at, task_reviews.created_at) are filtered against.
/** Shift a `YYYY-MM-DD` calendar string by whole days. */
const addDaysYmd = (ymd, days) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
exports.addDaysYmd = addDaysYmd;
/** True when the calendar date is a Monday (report weeks must start on one). */
const isDhakaMonday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay() === 1;
exports.isDhakaMonday = isDhakaMonday;
/** The Dhaka Mon–Sun week containing a UTC instant. */
const dhakaWeekOf = (utc) => {
    const day = (0, exports.dhakaDateOf)(utc);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
    const sinceMonday = (dow + 6) % 7;
    const weekStart = (0, exports.addDaysYmd)(day, -sinceMonday);
    return { weekStart, weekEnd: (0, exports.addDaysYmd)(weekStart, 6) };
};
exports.dhakaWeekOf = dhakaWeekOf;
/** The Monday one week before a given week's Monday. */
const previousWeekStart = (weekStart) => (0, exports.addDaysYmd)(weekStart, -7);
exports.previousWeekStart = previousWeekStart;
/**
 * The UTC instant bounds of a Dhaka week: `[fromUtc, toUtcExclusive)`.
 * `2026-07-13` → from `2026-07-12T18:00:00Z`, to `2026-07-19T18:00:00Z`.
 */
const weekBoundsUtc = (weekStart) => {
    const fromUtc = new Date(`${weekStart}T00:00:00+06:00`);
    return {
        fromUtc,
        toUtcExclusive: new Date(fromUtc.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
};
exports.weekBoundsUtc = weekBoundsUtc;
