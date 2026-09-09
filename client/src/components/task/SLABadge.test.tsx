import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { SLABadge } from "./SLABadge";
import { TICK_MS } from "../../lib/now-tick";

/**
 * P5 of DEADLINE_TIME_PLAN_2026-09-08 — decision §B4.
 *
 * A task can now carry BOTH an SLA target and a deadline, and the plan's rule
 * is that the UI must not show two similar-looking countdowns without saying
 * which is which. This file starts as a CHARACTERISATION of what the SLA badge
 * does today, because P4 changed the deadline badge and the difference between
 * them is now the thing that matters.
 *
 * Three questions worth answering with a test rather than a reading:
 *   1. Does it name itself? (The deadline badge did not, until P5.)
 *   2. Does it TICK? P4 gave the deadline a shared clock; if the SLA badge
 *      still computes `now` at render, two countdowns side by side disagree
 *      about the present, which is worse than either being wrong alone.
 *   3. Does a COMPLETED-but-breached task stop counting? The deadline badge
 *      settles on "done 5h late". If this one keeps counting up forever, the
 *      same finished task reads as ongoing in one badge and finished in the
 *      other.
 */

const at = (isoInstant: string, props: Parameters<typeof SLABadge>[0]) => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoInstant));
    const { container } = render(<SLABadge {...props} />);
    return { text: container.textContent ?? "", container };
};

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

const NOW = "2026-03-20T09:00:00.000Z";

describe("SLABadge — what it says", () => {
    it("names itself, so it cannot be read as the deadline", () => {
        const r = at(NOW, { slaDueAt: "2026-03-20T12:00:00.000Z" });
        expect(r.text).toContain("SLA");
    });

    it("counts down to the target", () => {
        expect(at(NOW, { slaDueAt: "2026-03-20T12:20:00.000Z" }).text).toBe(
            "SLA in 3h 20m",
        );
    });

    it("counts up once breached", () => {
        // "5h", not "5h 0m": P5 moved both badges onto the same `humanGap`
        // formatter. Counting in different units would not have told the two
        // apart, only made one of them harder to read — the word is what
        // distinguishes them (§B4).
        expect(at(NOW, { slaDueAt: "2026-03-20T04:00:00.000Z" }).text).toBe(
            "SLA breached 5h ago",
        );
    });

    it("says met when the work finished before the target", () => {
        expect(
            at(NOW, {
                slaDueAt: "2026-03-20T12:00:00.000Z",
                completedAt: "2026-03-20T08:00:00.000Z",
            }).text,
        ).toBe("SLA met");
    });
});

describe("the two badges must agree about the present and the past", () => {
    it("TICKS, like the deadline badge does", () => {
        // Without this, a page left open shows a frozen SLA beside a live
        // deadline. P4's note: SLABadge computed `now` at render.
        const { container } = (() => {
            cleanup();
            vi.useFakeTimers();
            vi.setSystemTime(new Date(NOW));
            return render(<SLABadge slaDueAt="2026-03-20T09:05:00.000Z" />);
        })();
        expect(container.textContent).toBe("SLA in 5m");

        act(() => {
            vi.advanceTimersByTime(4 * TICK_MS);
        });
        expect(container.textContent).toBe("SLA in 1m");
    });

    it("a breached task that was FINISHED stops counting", () => {
        // The deadline badge settles on "done 5h late" and never moves again.
        // A live "SLA breached 12d ago" on the same finished task says the work
        // is still outstanding.
        const first = at(NOW, {
            slaDueAt: "2026-03-20T04:00:00.000Z",
            completedAt: "2026-03-20T06:00:00.000Z", // two hours late
        });
        expect(first.text).toBe("SLA missed by 2h");

        // Thirty days later, the same fact.
        const later = at("2026-04-19T09:00:00.000Z", {
            slaDueAt: "2026-03-20T04:00:00.000Z",
            completedAt: "2026-03-20T06:00:00.000Z",
        });
        expect(later.text).toBe("SLA missed by 2h");
    });
});
