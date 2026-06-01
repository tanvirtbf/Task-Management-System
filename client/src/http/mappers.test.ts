import { describe, it, expect } from "vitest";
import { taskToWire } from "./mappers";

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
