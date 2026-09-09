import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DeadlineBadge } from "./DeadlineBadge";
import { TICK_MS } from "../../lib/now-tick";
import { tokens } from "../../theme";

/**
 * P4 of DEADLINE_TIME_PLAN_2026-09-08 — the badge, rendered.
 *
 * The plan's exit criterion: every state at four timezones, plus proof the
 * countdown actually moves. `lib/deadline.test.ts` owns the maths (including
 * the 540-case check that this client agrees with the server); this file owns
 * what a person ends up looking at.
 */

/** The workspace zone is read through react-query, so tests seed the cache. */
const wrapperFor = (timezone: string) => {
    const qc = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: Infinity,
                // ⚠️ Without this the seeded workspace is stale on arrival and
                // react-query refetches it FOR REAL — 20 ECONNREFUSED to
                // localhost:5501 per run, and worse if a dev server happens to
                // be up, since the test would then be reading the DEV database.
                staleTime: Infinity,
                refetchOnMount: false,
            },
        },
    });
    qc.setQueryData(["workspace"], {
        id: "ws-1",
        name: "BeautyBooth",
        logoUrl: null,
        settings: {
            timezone,
            defaultLocale: "en",
            weekStartsOn: 6,
            workingDays: [0, 1, 2, 3, 4],
            businessHours: { start: "09:00", end: "18:00" },
        },
    });
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
};

/**
 * Render at a frozen instant.
 *
 * ⚠️ `cleanup()` FIRST, and that is not tidiness. The badge reads the shared
 * clock in `lib/now-tick.ts`, which refreshes its snapshot when the FIRST
 * subscriber arrives and then leaves it alone until the interval fires -- one
 * clock for the page, which is the whole point of the module. So a second
 * render mounted beside a live one inherits the first one's `now`, whatever
 * `setSystemTime` has been told since. The loops below render the same case in
 * four zones, and without this they all silently answer at the first zone's
 * instant -- which is exactly how the first draft of this file "proved" a
 * ten-hour error in New York that did not exist.
 */
const at = (
    isoInstant: string,
    props: Partial<Parameters<typeof DeadlineBadge>[0]> & {
        dueDate: string | null;
    },
    timezone = "Asia/Dhaka",
) => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoInstant));
    const { container } = render(<DeadlineBadge {...props} />, {
        wrapper: wrapperFor(timezone),
    });
    const span = container.querySelector("[data-deadline-state]") as
        | HTMLElement
        | null;
    return {
        state: span?.dataset.deadlineState ?? "none",
        text: span?.textContent ?? "",
        color: span?.style.color ?? "",
        container,
    };
};

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("every state, at four timezones", () => {
    // Each zone gets a clock that is the SAME distance from the deadline, so
    // the expected words are identical and any zone-handling bug shows up as a
    // different answer rather than a different fixture.
    const CASES: {
        zone: string;
        /** UTC instant that is 09:00 on 2026-03-20 in that zone. */
        nine: string;
    }[] = [
        { zone: "Asia/Dhaka", nine: "2026-03-20T03:00:00.000Z" },
        { zone: "America/New_York", nine: "2026-03-20T13:00:00.000Z" },
        { zone: "Pacific/Kiritimati", nine: "2026-03-19T19:00:00.000Z" },
        { zone: "Pacific/Midway", nine: "2026-03-20T20:00:00.000Z" },
    ];

    it("upcoming — days out, quiet", () => {
        for (const { zone, nine } of CASES) {
            const r = at(nine, { dueDate: "2026-03-25", dueTime: "09:00" }, zone);
            expect({ zone, state: r.state, text: r.text }).toEqual({
                zone,
                state: "upcoming",
                text: "5d left",
            });
        }
    });

    it("soon — inside the last day, warned", () => {
        for (const { zone, nine } of CASES) {
            const r = at(nine, { dueDate: "2026-03-21", dueTime: "02:00" }, zone);
            expect({ zone, state: r.state, text: r.text, color: r.color }).toEqual({
                zone,
                state: "soon",
                text: "17h left",
                color: tokens.colors.warning,
            });
        }
    });

    it("late — behind, in danger colour", () => {
        for (const { zone, nine } of CASES) {
            const r = at(nine, { dueDate: "2026-03-20", dueTime: "04:00" }, zone);
            expect({ zone, state: r.state, text: r.text, color: r.color }).toEqual({
                zone,
                state: "late",
                text: "5h late",
                color: tokens.colors.danger,
            });
        }
    });

    it("done on time — states it, quietly", () => {
        for (const { zone, nine } of CASES) {
            // Six hours before a 17:00 deadline, in that zone.
            const done = new Date(
                Date.parse(nine) + 2 * 60 * 60 * 1000,
            ).toISOString();
            const r = at(
                nine,
                { dueDate: "2026-03-20", dueTime: "17:00", completedAt: done },
                zone,
            );
            expect({ zone, state: r.state, text: r.text }).toEqual({
                zone,
                state: "done_on_time",
                text: "done on time",
            });
        }
    });

    it("done late — says how late, the user's own phrasing", () => {
        for (const { zone, nine } of CASES) {
            // Finished five hours after a 09:00 deadline.
            const done = new Date(
                Date.parse(nine) + 5 * 60 * 60 * 1000,
            ).toISOString();
            const r = at(
                nine,
                { dueDate: "2026-03-20", dueTime: "09:00", completedAt: done },
                zone,
            );
            expect({ zone, state: r.state, text: r.text }).toEqual({
                zone,
                state: "done_late",
                text: "done 5h late",
            });
        }
    });

    it("a time-less task due TODAY is never late, at any hour", () => {
        // The invariant P0 pinned and every phase since has had to preserve.
        for (const { zone } of CASES) {
            for (const hour of [0, 6, 12, 18, 23]) {
                const instant = new Date(
                    Date.UTC(2026, 2, 20, hour, 30),
                ).toISOString();
                const today = new Intl.DateTimeFormat("en-CA", {
                    timeZone: zone,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                }).format(new Date(instant));
                const r = at(instant, { dueDate: today, dueTime: null }, zone);
                expect({ zone, hour, late: r.state === "late" }).toEqual({
                    zone,
                    hour,
                    late: false,
                });
            }
        }
    });
});

describe("it renders nothing when there is nothing to say", () => {
    it("no due date, no badge", () => {
        const r = at("2026-03-20T03:00:00.000Z", { dueDate: null });
        expect(r.container.textContent).toBe("");
    });
});

describe("the countdown actually moves", () => {
    it("re-renders on the shared tick", () => {
        // `SLABadge` computes `now` at render and so never updates on a page
        // left open. That is survivable for "17h left" and wrong for "4m left",
        // which is the case this whole feature is about.
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-20T03:00:00.000Z"));
        const { container } = render(
            <DeadlineBadge dueDate="2026-03-20" dueTime="09:05" />,
            { wrapper: wrapperFor("Asia/Dhaka") },
        );
        expect(container.textContent).toContain("5m left");

        act(() => {
            vi.advanceTimersByTime(4 * TICK_MS);
        });
        expect(container.textContent).toContain("1m left");
    });
});
