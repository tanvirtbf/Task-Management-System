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
exports.addBusinessDays = exports.addBusinessMs = exports.businessDayLengthMs = exports.weekBoundsUtc = exports.previousWeekStart = exports.dhakaWeekOf = exports.isDhakaMonday = exports.addDaysYmd = exports.clockInZone = exports.zoneClockOf = exports.todayInZone = exports.zoneDateOf = exports.dhakaToday = exports.dhakaDateOf = void 0;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
/** The Dhaka calendar date (`YYYY-MM-DD`) of a UTC instant. */
const dhakaDateOf = (utc) => new Date(utc.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
exports.dhakaDateOf = dhakaDateOf;
/** Today's date in the Dhaka calendar (`YYYY-MM-DD`). */
const dhakaToday = () => (0, exports.dhakaDateOf)(new Date());
exports.dhakaToday = dhakaToday;
// ─── Workspace-zone calendar (F5 / ISS-058) ──────────────────────────────────
// `workspaces.timezone` holds an IANA name ("Asia/Dhaka", "America/New_York")
// validated at write time against Intl. Deriving a calendar day for an
// arbitrary zone therefore goes through Intl too — Node ships full ICU, DST is
// handled, and no MySQL tz tables are involved. The fixed-offset helpers above
// stay for the COMPANY calendar (dept-review weeks, the on-call roster), which
// is Dhaka by design and must not move when a workspace re-zones itself.
/**
 * The calendar date (`YYYY-MM-DD`) of a UTC instant in an IANA zone.
 *
 * An unknown/invalid zone falls back to the Dhaka calendar — the business
 * default — rather than throwing: the write path already rejects bad zones, so
 * this only triggers for rows edited outside the API, and "today is Dhaka's
 * today" is the least surprising answer this product can give.
 */
const zoneDateOf = (utc, timeZone) => {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(utc);
        const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
        const day = `${get("year")}-${get("month")}-${get("day")}`;
        return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : (0, exports.dhakaDateOf)(utc);
    }
    catch {
        return (0, exports.dhakaDateOf)(utc);
    }
};
exports.zoneDateOf = zoneDateOf;
/** Today's date (`YYYY-MM-DD`) on a workspace's own calendar. */
const todayInZone = (timeZone) => (0, exports.zoneDateOf)(new Date(), timeZone);
exports.todayInZone = todayInZone;
/**
 * The wall clock (`HH:MM`, 24h) in a zone — the day's companion to
 * `zoneDateOf`. upgrades/024: a recurring task fires at a time the person
 * picked, and "9:00" means nine in THEIR office, not on the API box.
 *
 * Falls back to the fixed Dhaka offset if the zone name is unusable, matching
 * `zoneDateOf` — a bad timezone value must degrade, never throw inside a job.
 */
const zoneClockOf = (utc, timeZone) => {
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(utc);
        const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
        const clock = `${get("hour")}:${get("minute")}`;
        if (/^\d{2}:\d{2}$/.test(clock))
            return clock;
    }
    catch {
        /* fall through */
    }
    return new Date(utc.getTime() + DHAKA_OFFSET_MS)
        .toISOString()
        .slice(11, 16);
};
exports.zoneClockOf = zoneClockOf;
/** The wall clock right now, on a workspace's own calendar. */
const clockInZone = (timeZone) => (0, exports.zoneClockOf)(new Date(), timeZone);
exports.clockInZone = clockInZone;
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
// ─── The business clock (F28 / ISS-029, decision D12.2) ──────────────────────
// `workspaces.working_days` and `business_hours_start/end` were stored,
// validated and read by NOTHING. The sharp consequence was SLA: deadlines were
// pure wall-clock, so an S0 bug filed 17:30 on a Thursday was due 19:30 the same
// Thursday — after hours, on the last working day before BeautyBooth's Friday-
// Saturday weekend. The team was measured against a deadline nobody was at work
// for. These helpers make elapsed time count only while the office is open.
/** MySQL's `working_days` SET members, in `Date#getUTCDay()` order. */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_MS = 24 * 60 * 60 * 1000;
/** `"09:00"` / `"09:00:00"` → ms since local midnight; `null` if unparseable. */
const timeOfDayMs = (value) => {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? "").trim());
    if (!m)
        return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3] ?? 0);
    if (h > 24 || min > 59 || s > 59)
        return null;
    return ((h * 60 + min) * 60 + s) * 1000;
};
/**
 * A zone's UTC offset in ms at a given instant, via Intl (Node ships full ICU).
 *
 * Read ONCE at the start of a business-time window and held constant for the
 * whole calculation. Bangladesh is a fixed +06:00 with no DST, so for the real
 * deployment this is exact. In a DST zone a deadline that spans a transition can
 * land an hour out — accepted deliberately rather than carrying a tz library for
 * a workspace setting that is `Asia/Dhaka`.
 */
const zoneOffsetMsAt = (utc, timeZone) => {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).formatToParts(utc);
        const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
        const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, // some locales render midnight as "24"
        get("minute"), get("second"));
        return Number.isNaN(asIfUtc) ? DHAKA_OFFSET_MS : asIfUtc - utc.getTime();
    }
    catch {
        return DHAKA_OFFSET_MS;
    }
};
/** Length of one working day in ms, or `null` if the window is unusable. */
const businessDayLengthMs = (cal) => {
    const open = timeOfDayMs(cal.businessHoursStart);
    const close = timeOfDayMs(cal.businessHoursEnd);
    if (open === null || close === null || close <= open)
        return null;
    return close - open;
};
exports.businessDayLengthMs = businessDayLengthMs;
/**
 * Advance `from` by `durationMs` of **business** time.
 *
 * Time only elapses inside `[business_hours_start, business_hours_end)` on a
 * `working_days` day. An instant outside the window contributes nothing and the
 * clock resumes at the next opening — so 2 business hours from Thursday 17:30
 * (30 minutes before close, with Friday and Saturday off) lands at **Sunday
 * 10:30**, giving the team the two working hours the SLA promises.
 *
 * Degrades to plain wall-clock arithmetic — i.e. exactly the pre-F28 behaviour —
 * when the calendar cannot be used: no working days, an unparseable or inverted
 * window, or a non-positive duration. It never throws, because an SLA deadline
 * must not be the thing that fails a task create.
 */
const addBusinessMs = (from, durationMs, cal) => {
    const dayLength = (0, exports.businessDayLengthMs)(cal);
    const open = timeOfDayMs(cal.businessHoursStart);
    const days = new Set((cal.workingDays ?? []).map((d) => String(d).trim().toLowerCase()));
    if (dayLength === null ||
        open === null ||
        days.size === 0 ||
        durationMs <= 0) {
        return new Date(from.getTime() + Math.max(0, durationMs));
    }
    const offset = zoneOffsetMsAt(from, cal.timeZone);
    let cursor = from.getTime() + offset; // local ms, read as if it were UTC
    let remaining = durationMs;
    // Bounded rather than `while (true)`: 400 iterations is over a year even on
    // a one-day working week, and `remaining` strictly decreases on every
    // working day, so the loop cannot spin. The fallback below is unreachable
    // for any calendar the validator accepts.
    for (let i = 0; i < 400; i += 1) {
        const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
        if (days.has(DAY_KEYS[new Date(dayStart).getUTCDay()])) {
            const opens = dayStart + open;
            const closes = opens + dayLength;
            const enter = Math.max(cursor, opens);
            if (enter < closes) {
                const available = closes - enter;
                if (remaining <= available) {
                    return new Date(enter + remaining - offset);
                }
                remaining -= available;
            }
        }
        cursor = dayStart + DAY_MS; // next local midnight
    }
    return new Date(from.getTime() + durationMs);
};
exports.addBusinessMs = addBusinessMs;
/** Advance by whole working days (`1 business day` = one full open window). */
const addBusinessDays = (from, days, cal) => {
    const dayLength = (0, exports.businessDayLengthMs)(cal);
    if (dayLength === null) {
        return new Date(from.getTime() + days * DAY_MS);
    }
    return (0, exports.addBusinessMs)(from, days * dayLength, cal);
};
exports.addBusinessDays = addBusinessDays;
