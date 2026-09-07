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
