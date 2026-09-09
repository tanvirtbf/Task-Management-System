/**
 * Date helpers used by Calendar / Gantt / Timeline views.
 * No deps — uses native Date.
 */

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const startOfDay = (d: Date | string): Date => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

export const endOfDay = (d: Date | string): Date => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
};

export const startOfMonth = (d: Date): Date => {
    const x = startOfDay(d);
    x.setDate(1);
    return x;
};

export const endOfMonth = (d: Date): Date => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + 1, 0);
    x.setHours(23, 59, 59, 999);
    return x;
};

export const addDays = (d: Date, n: number): Date => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
};

export const addMonths = (d: Date, n: number): Date => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + n);
    return x;
};

export const daysBetween = (a: Date | string, b: Date | string): number =>
    Math.round(
        (startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_PER_DAY,
    );

export const isSameDay = (a: Date | string, b: Date | string): boolean =>
    startOfDay(a).getTime() === startOfDay(b).getTime();

/**
 * Build calendar grid for a month, returning 42 cells (6 weeks × 7 days)
 * starting on the workspace week start (default Saturday for BD).
 */
export const buildMonthGrid = (
    monthAnchor: Date,
    weekStartsOn: number = 6,
): Date[] => {
    const monthStart = startOfMonth(monthAnchor);
    const firstDay = monthStart.getDay();
    const offset = (firstDay - weekStartsOn + 7) % 7;
    const gridStart = addDays(monthStart, -offset);

    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
};

/**
 * Build week-day-name array starting from weekStartsOn (Sat = 6).
 */
export const weekDayNames = (
    weekStartsOn: number = 6,
    short = true,
): string[] => {
    const names = short
        ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        : [
              "Sunday",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
          ];
    const result: string[] = [];
    for (let i = 0; i < 7; i++) {
        result.push(names[(weekStartsOn + i) % 7]);
    }
    return result;
};

export const formatMonthLabel = (d: Date): string =>
    d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

export const formatShortDate = (d: Date | string): string =>
    new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });

export const formatRangeLabel = (start: Date, end: Date): string => {
    if (start.getFullYear() !== end.getFullYear()) {
        return `${start.toLocaleDateString("en-US", { month: "short", year: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
    }
    if (start.getMonth() !== end.getMonth()) {
        return `${start.toLocaleDateString("en-US", { month: "short" })} – ${end.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
    }
    return start.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
};

/** A wire date: `"2026-05-26"`, optionally with a time the server appended. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

/**
 * Day key like "2026-05-26" used as object key / DnD id.
 *
 * ⚠️ A `YYYY-MM-DD` string is returned as-is, and that short-circuit is a
 * correctness fix, not an optimisation (P13). `due_date` and `start_date`
 * cross the wire as plain calendar days — `toWireDate` on the server builds
 * them from UTC components *precisely so* they carry no timezone. Feeding one
 * to `new Date()` parses it as UTC midnight, and reading the local calendar day
 * back off that lands on the PREVIOUS day for every viewer west of UTC. The
 * office is at UTC+6, so the round-trip happened to be harmless here and the
 * bug hid; in New York a task due the 20th filtered, bucketed and highlighted
 * as if it were due the 19th.
 *
 * A real instant still resolves to the LOCAL calendar day, which is what
 * `dayKey(new Date())` means and must keep meaning.
 */
export const dayKey = (d: Date | string): string => {
    if (typeof d === "string" && DATE_ONLY.test(d)) return d.slice(0, 10);
    const x = startOfDay(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export const parseDayKey = (key: string): Date => {
    const [y, m, day] = key.split("-").map(Number);
    return new Date(y, m - 1, day);
};

/**
 * A value from the API as a Date sitting on the right LOCAL calendar day.
 *
 * Use this instead of `new Date(value)` wherever a date is COMPARED to today
 * or FORMATTED for a human. `new Date("2026-03-20")` is UTC midnight, so every
 * local reading of it — `toDateString()`, `getDate()`, `toLocaleDateString()` —
 * is a day early west of UTC (P13). Composing through `dayKey` means a plain
 * wire date keeps its calendar day and a real timestamp resolves to the local
 * one, which is the correct answer in both cases.
 */
export const parseWireDate = (value: Date | string): Date =>
    parseDayKey(dayKey(value));

/**
 * `"17:00"` → `"5:00 PM"` (upgrades/027).
 *
 * A time of day, unlike everything else in this file, carries no date and
 * therefore no timezone — it is a wall-clock reading and formats the same
 * for every viewer. That is exactly why it must NOT go through `Date`: a
 * `new Date("17:00")` is invalid, and the near-miss
 * `new Date(\`1970-01-01T${t}\`)` would be parsed in local time and shift.
 *
 * Empty for an absent or unparseable value, so a caller can render it
 * unconditionally — a null time means end of day and shows nothing extra.
 */
export const formatTimeOfDay = (
    value: string | null | undefined,
): string => {
    if (!value) return "";
    const [h, m] = value.slice(0, 5).split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return "";
    const suffix = h < 12 ? "AM" : "PM";
    // 00:00 and 12:00 both land on hour 0 under `% 12`, and one of them
    // reads 12. This is the line a naive version gets wrong.
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
};

// ─── Activity timestamps (DEADLINE_TIME_PLAN P6) ────────────────────────────

/**
 * Where relative stops and absolute starts.
 *
 * Decision §P6.3: under an hour stays relative, an hour or older becomes a
 * real date. A timestamp on something twenty seconds old is noise; "13d ago"
 * on something a fortnight old is the reading that loses the information the
 * user actually wanted. Exported so the tests can assert BOTH sides of the
 * boundary without restating the number.
 */
export const RELATIVE_CUTOVER_MS = 60 * 60 * 1000;

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

/**
 * When something happened: `"just now"`, `"12m ago"`, or `"24 Aug, 10.24 PM"`.
 *
 * THE formatter for every activity, comment and notification time in the app.
 * It replaced FOUR copies -- three named `timeAgo` and a fourth called
 * `formatTime` in the inbox that nobody had noticed, because it was found by
 * searching for the name rather than the behaviour. `time-rendering.test.ts`
 * now searches for the behaviour, so a fifth cannot appear quietly.
 *
 * ── ⛔ the LOCAL zone, and why that is not an inconsistency ─────────────────
 * This renders in the VIEWER's timezone, while a deadline renders in the
 * WORKSPACE's. That looks like a bug and is the point. A deadline is a
 * wall-clock promise -- "5 PM" means five in the office that set it, for
 * everyone. An activity timestamp is a real instant that already happened, and
 * the only useful question about it is when it happened relative to the person
 * reading. Do not "fix" one to match the other.
 *
 * The dot in `10.24 PM` is the user's own notation, not a typo for a colon.
 * The year appears only when the instant falls in a different calendar year
 * from `now` -- without that, a comment from two Augusts ago is indistinguish-
 * able from last week's.
 *
 * `now` is injectable so a test can pin the clock; callers pass nothing.
 */
export const formatActivityTime = (
    iso: string | Date | null | undefined,
    now: number = Date.now(),
): string => {
    if (!iso) return "";
    const at = iso instanceof Date ? iso : new Date(iso);
    const ms = at.getTime();
    if (Number.isNaN(ms)) return "";

    const elapsed = now - ms;
    if (elapsed < RELATIVE_CUTOVER_MS) {
        // A future instant (clock skew between the browser and the API) reads
        // as "just now" rather than a negative age.
        const minutes = Math.floor(Math.max(0, elapsed) / 60_000);
        return minutes < 1 ? "just now" : `${minutes}m ago`;
    }

    const h24 = at.getHours();
    const suffix = h24 < 12 ? "AM" : "PM";
    // Same midnight/noon trap as `formatTimeOfDay`: both land on 0 under `% 12`
    // and one of them reads 12.
    const hour = h24 % 12 === 0 ? 12 : h24 % 12;
    const minute = String(at.getMinutes()).padStart(2, "0");
    const day = at.getDate();
    const month = MONTHS[at.getMonth()];
    const year =
        at.getFullYear() === new Date(now).getFullYear()
            ? ""
            : ` ${at.getFullYear()}`;
    return `${day} ${month}${year}, ${hour}.${minute} ${suffix}`;
};
