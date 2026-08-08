/**
 * Date fixtures for MySQL `DATE` columns.
 *
 * **Always build a DATE fixture with these, never with `new Date(y, m - 1, d)`.**
 *
 * A `DATE` column stores a calendar day with no timezone. Drizzle materialises it
 * at **UTC midnight** (`MySqlDate.mapFromDriverValue` does `new Date("YYYY-MM-DD")`)
 * and has no `mapToDriverValue`, so the JS Date is handed straight to mysql2,
 * which serialises it using the driver's `timezone` — pinned to `+00:00` since F3.
 *
 * A LOCAL-midnight Date therefore lands on the **previous** calendar day from any
 * timezone east of UTC: local midnight in Dhaka is 18:00 UTC the day before, and
 * the DATE column truncates the time away. Fixtures built that way inserted rows
 * one day earlier than they read, so the assertions failed — the fixture was
 * wrong, not the product.
 *
 * Written during F3 (the clock fix), after that pattern was found in the sprint
 * and on-call factories and in four suites' private helpers.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `"2026-06-01"` → the Date a DATE column round-trips to. */
export const utcDate = (ymd: string): Date => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
};

/** `(2026, 6, 1)` → 2026-06-01 at UTC midnight. Month is 1-based, unlike `Date`. */
export const utcYmd = (year: number, month: number, day: number): Date =>
    new Date(Date.UTC(year, month - 1, day));

/** Shift a UTC-midnight DATE by whole days. Safe: UTC has no DST. */
export const addUtcDays = (base: Date, days: number): Date =>
    new Date(base.getTime() + days * DAY_MS);

/**
 * A DATE `offsetDays` from **today in Dhaka** — for fixtures that must straddle
 * "now" (the current on-call shift, due-today buckets).
 *
 * Dhaka, not the box: the product decides those windows on the business calendar
 * (`utils/dhakaTime.dhakaToday`), so a fixture keyed to the box's local day would
 * disagree with it for six hours every night and make the suite flake.
 */
export const dhakaDayOffset = (offsetDays: number): Date => {
    const dhakaNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
    return new Date(
        Date.UTC(
            dhakaNow.getUTCFullYear(),
            dhakaNow.getUTCMonth(),
            dhakaNow.getUTCDate() + offsetDays,
        ),
    );
};

/** The `YYYY-MM-DD` a DATE column will render for one of these Dates. */
export const wireYmd = (d: Date): string => d.toISOString().slice(0, 10);
