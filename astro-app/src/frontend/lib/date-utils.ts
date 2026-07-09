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

/**
 * Day key like "2026-05-26" used as object key / DnD id.
 */
export const dayKey = (d: Date | string): string => {
    const x = startOfDay(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export const parseDayKey = (key: string): Date => {
    const [y, m, day] = key.split("-").map(Number);
    return new Date(y, m - 1, day);
};
