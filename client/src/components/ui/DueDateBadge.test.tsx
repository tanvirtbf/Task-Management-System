import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DueDateBadge } from "./DueDateBadge";
import { tokens } from "../../theme";

/**
 * P0 of DEADLINE_TIME_PLAN_2026-09-08 — a CHARACTERISATION test.
 *
 * This does not assert what the badge *should* do. It records what it does
 * TODAY, before hourly deadlines exist, so that the phases which add a time
 * component have something to be measured against. If one of these changes
 * later, that is a decision someone has to make deliberately rather than a
 * regression that slips through.
 *
 * ── the invariant this exists to protect (plan §B1) ─────────────────────────
 * A task due TODAY is not overdue at ANY hour of today. Today's rule is
 * `due_date < today` on a DATE column, so "due today" simply cannot be late.
 * When `due_time` arrives, a NULL time must resolve to the END of the day
 * precisely so this stays true — otherwise every existing task due today turns
 * overdue the moment the feature ships, on data nobody touched.
 *
 * `atClock` freezes the wall clock, so "today" is a fact rather than a race
 * with the test runner. Freezing is what lets us assert the 23:59 case, which
 * is the one that would break if a NULL time were ever read as midnight.
 */

const OVERDUE = tokens.colors.danger;
const TODAY = tokens.colors.warning;
const NEUTRAL = tokens.colors.textSecondary;

/** Render the badge with the clock frozen at a given instant. */
const atClock = (isoInstant: string, dueDate: string | null) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoInstant));
    const { container } = render(<DueDateBadge dueDate={dueDate} />);
    const span = container.querySelector("span") as HTMLElement;
    return { text: span.textContent ?? "", color: span.style.color };
};

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("DueDateBadge — what it does TODAY (characterisation, pre-time)", () => {
    it("a task due TODAY is never overdue — not even at 23:59", () => {
        // THE invariant. Both ends of the day, same verdict.
        const morning = atClock("2026-03-20T00:05:00", "2026-03-20");
        const midnightish = atClock("2026-03-20T23:59:00", "2026-03-20");

        expect({ at: "00:05", text: morning.text, color: morning.color }).toEqual({
            at: "00:05",
            text: "Today",
            color: TODAY,
        });
        expect({ at: "23:59", text: midnightish.text, color: midnightish.color }).toEqual({
            at: "23:59",
            text: "Today",
            color: TODAY,
        });
    });

    it("yesterday is overdue, tomorrow is not", () => {
        const past = atClock("2026-03-20T12:00:00", "2026-03-19");
        const future = atClock("2026-03-20T12:00:00", "2026-03-21");

        expect({ text: past.text, color: past.color }).toEqual({
            text: "Yesterday",
            color: OVERDUE,
        });
        expect({ text: future.text, color: future.color }).toEqual({
            text: "Tomorrow",
            color: NEUTRAL,
        });
    });

    it("names the weekday inside a week, and the date beyond it", () => {
        const soon = atClock("2026-03-20T12:00:00", "2026-03-23");
        const far = atClock("2026-03-20T12:00:00", "2026-05-02");

        expect(soon.text).toBe("Mon"); // 2026-03-23 is a Monday
        expect(far.text).toBe("May 2");
    });

    it("renders an em dash when there is no due date", () => {
        const none = atClock("2026-03-20T12:00:00", null);
        expect(none.text).toBe("—");
    });
});

describe("DueDateBadge — the same verdict in every timezone", () => {
    /**
     * P13 fixed a defect here: the wire date was parsed through `new Date()`
     * (UTC midnight) and read back on the LOCAL calendar, so west of UTC a task
     * due today rendered as the red OVERDUE chip. These pin the fix, and they
     * are the tests most likely to catch a timezone mistake in the phases that
     * follow — the ones that turn this date into an instant.
     */
    const ZONES = ["Asia/Dhaka", "UTC", "America/New_York", "Pacific/Midway"];

    it('"due today" reads Today in all four zones', () => {
        for (const tz of ZONES) {
            vi.stubEnv("TZ", tz);
            // Local noon on the 20th, whatever the zone.
            const { text, color } = atClock("2026-03-20T12:00:00", "2026-03-20");
            expect({ tz, text, color }).toEqual({ tz, text: "Today", color: TODAY });
            vi.unstubAllEnvs();
        }
    });

    it("yesterday reads overdue in all four zones", () => {
        for (const tz of ZONES) {
            vi.stubEnv("TZ", tz);
            const { text, color } = atClock("2026-03-20T12:00:00", "2026-03-19");
            expect({ tz, text, color }).toEqual({
                tz,
                text: "Yesterday",
                color: OVERDUE,
            });
            vi.unstubAllEnvs();
        }
    });
});
