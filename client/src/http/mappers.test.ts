import { describe, it, expect } from "vitest";
import { taskToWire, workspaceToWire } from "./mappers";
import type { Workspace } from "../types";

/**
 * Regression tests for the calendar/inline/bulk "Could not create task" bug:
 * the UI hands task date fields as full ISO datetimes, but the backend DATE
 * columns require a strict `YYYY-MM-DD`. `taskToWire` must normalise them.
 */
describe("taskToWire — date normalisation", () => {
    it("converts a full ISO dueDate to bare YYYY-MM-DD", () => {
        // Build the ISO from a LOCAL noon date so the expected day is tz-stable.
        const iso = new Date(2026, 5, 15, 12, 0, 0).toISOString();
        const out = taskToWire({ dueDate: iso });
        expect(out.dueDate).toBe("2026-06-15");
    });

    it("leaves an already date-only value unchanged", () => {
        const out = taskToWire({ dueDate: "2026-06-15" });
        expect(out.dueDate).toBe("2026-06-15");
    });

    it("passes null through (clearing the date)", () => {
        const out = taskToWire({ dueDate: null });
        expect(out.dueDate).toBeNull();
    });

    it("normalises startDate and recurrence.endsAt as well", () => {
        const iso = new Date(2026, 0, 3, 12, 0, 0).toISOString();
        const out = taskToWire({
            startDate: iso,
            recurrence: {
                pattern: "weekly",
                interval: 1,
                endsAt: iso,
                spawnOnComplete: true,
            },
        });
        expect(out.startDate).toBe("2026-01-03");
        expect(out.recurrenceEndsAt).toBe("2026-01-03");
    });

    it("does not introduce date keys that were not in the patch", () => {
        const out = taskToWire({ name: "x" });
        expect("dueDate" in out).toBe(false);
        expect("startDate" in out).toBe(false);
    });
});

/**
 * P3 of DEADLINE_TIME_PLAN_2026-09-08 — the time half of the same contract.
 *
 * Everything the app writes to a task passes through `taskToWire`: create,
 * update AND bulk. That makes it the one place both time rules can be held, and
 * the one place a surface cannot forget them.
 */
describe("taskToWire — the TIME columns (upgrades/027)", () => {
    it("trims the HH:MM:SS a TIME column returns down to HH:MM", () => {
        // mysql2 hands back `17:00:00`; the server's validator is HH:MM and
        // refuses that. Echoing a task object straight back would 422 without
        // this, which is the same trap `recurrenceTime` hit in upgrades/024.
        const out = taskToWire({ dueDate: "2026-09-05", dueTime: "17:00:00" });
        expect(out.dueTime).toBe("17:00");
    });

    it("leaves an already-HH:MM value alone", () => {
        const out = taskToWire({ dueDate: "2026-09-05", dueTime: "17:00" });
        expect(out.dueTime).toBe("17:00");
    });

    it("keeps midnight distinct from null", () => {
        // `"00:00"` is a real deadline someone picked; `null` means end of day.
        // A truthiness check that collapsed them would silently move a midnight
        // deadline to 23:59 (plan §B1).
        const out = taskToWire({ dueDate: "2026-09-05", dueTime: "00:00" });
        expect(out.dueTime).toBe("00:00");
    });

    it("clearing the due date clears the due time in the same request", () => {
        // The server enforces this too (`task.time_without_date`), and would
        // refuse the contradictory version. A UI that knowingly sends a doomed
        // request surfaces someone else's 422 as an unexplained failure.
        const out = taskToWire({ dueDate: null, dueTime: "17:00" });
        expect({ date: out.dueDate, time: out.dueTime }).toEqual({
            date: null,
            time: null,
        });
    });

    it("clearing the start date clears the start time", () => {
        const out = taskToWire({ startDate: null, startTime: "09:30" });
        expect({ date: out.startDate, time: out.startTime }).toEqual({
            date: null,
            time: null,
        });
    });

    it("clearing ONE date does not clear the other's time", () => {
        const out = taskToWire({
            startDate: null,
            startTime: "09:30",
            dueDate: "2026-09-30",
            dueTime: "17:00",
        });
        expect({ start: out.startTime, due: out.dueTime }).toEqual({
            start: null,
            due: "17:00",
        });
    });

    it("does not introduce time keys that were not in the patch", () => {
        // A patch of `{ name }` must not start sending `due_time: null` and
        // silently wipe a deadline's time on every rename.
        const out = taskToWire({ name: "x" });
        expect({
            due: "dueTime" in out,
            start: "startTime" in out,
        }).toEqual({ due: false, start: false });
    });
});

/**
 * Gap-scan C3 regression: Workspace Settings could never save — the wire
 * patch always carried `default_locale` (the endpoint rejects the key
 * outright) and TimePicker times went out as HH:mm (validator wants
 * HH:MM:SS).
 */
describe("workspaceToWire — C3 save-blockers", () => {
    const settings: Workspace["settings"] = {
        timezone: "Asia/Dhaka",
        defaultLocale: "en-US",
        weekStartsOn: 0,
        workingDays: [1, 2, 3, 4, 5],
        businessHours: { start: "09:00", end: "18:00" },
    };

    it("NEVER emits default_locale, even when the draft carries it", () => {
        const out = workspaceToWire({ name: "BB", settings });
        expect("defaultLocale" in out).toBe(false);
        expect("default_locale" in out).toBe(false);
    });

    it("pads TimePicker HH:mm to HH:MM:SS; leaves HH:MM:SS untouched", () => {
        const out = workspaceToWire({ settings });
        expect(out.businessHoursStart).toBe("09:00:00");
        expect(out.businessHoursEnd).toBe("18:00:00");

        const already = workspaceToWire({
            settings: {
                ...settings,
                businessHours: { start: "08:30:00", end: "17:15:00" },
            },
        });
        expect(already.businessHoursStart).toBe("08:30:00");
        expect(already.businessHoursEnd).toBe("17:15:00");
    });
});
