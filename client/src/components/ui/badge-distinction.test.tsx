import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DeadlineBadge } from "./DeadlineBadge";
import { SLABadge } from "../task/SLABadge";

/**
 * P5 of DEADLINE_TIME_PLAN_2026-09-08 — decision §B4, enforced.
 *
 * *"They are different things — SLA is a response commitment, the deadline is
 * when the work is due — and the UI must not show two similar-looking
 * countdowns without saying which is which."*
 *
 * A decision written only in a plan rots. These tests are the version that
 * cannot: they assert the distinction as rendered, and they fail if a later
 * change quietly removes it.
 */

const qc = () => {
    const c = new QueryClient({
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
    c.setQueryData(["workspace"], {
        id: "ws-1",
        name: "BeautyBooth",
        logoUrl: null,
        settings: {
            timezone: "Asia/Dhaka",
            defaultLocale: "en",
            weekStartsOn: 6,
            workingDays: [0, 1, 2, 3, 4],
            businessHours: { start: "09:00", end: "18:00" },
        },
    });
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={c}>{children}</QueryClientProvider>
    );
};

/**
 * The component sources, read the way this codebase reads its own source in
 * a test (`time-rendering.test.ts`, P0): vite's `?raw`, not `node:fs`. The
 * client tsconfig has no node types and should not gain any — it is browser
 * code, and a test that needs `__dirname` to run is a test that has drifted
 * away from what it is testing.
 */
const SOURCES = import.meta.glob("../**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

/**
 * One component's source, by its EXACT glob key.
 *
 * Exact rather than a suffix match, for two reasons the first draft hit:
 * vite keys a same-directory file as `./X.tsx` and a sibling as
 * `../dir/X.tsx`, so one uniform `dir/X.tsx` suffix matches the second and
 * silently misses the first; and the glob also returns the `.test.tsx`
 * files, which a loose match will happily pick up and then assert things
 * about the test rather than the component.
 *
 * Throwing on a miss is the point: if a component moves, this fails loudly
 * instead of passing on an empty string.
 */
const sourceOf = (key: string): string => {
    const src = SOURCES[key];
    if (src === undefined) {
        throw new Error(`no source at ${key} — did the file move?`);
    }
    return src;
};

/** 09:00 Dhaka on 2026-03-20. */
const NOW = "2026-03-20T03:00:00.000Z";

const both = (labelled: boolean) => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { container } = render(
        <>
            {/* Same moment, both badges: 17 hours out. */}
            <DeadlineBadge
                dueDate="2026-03-21"
                dueTime="02:00"
                labelled={labelled}
            />
            <SLABadge slaDueAt="2026-03-20T20:00:00.000Z" />
        </>,
        { wrapper: qc() },
    );
    const deadline = container.querySelector(
        "[data-deadline-state]",
    ) as HTMLElement;
    const sla = container.querySelector("[data-sla-badge]") as HTMLElement;
    return { deadline, sla };
};

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("side by side, each says what it is", () => {
    it("neither can be read as the other", () => {
        const { deadline, sla } = both(true);
        expect({
            deadline: deadline.textContent,
            sla: sla.textContent,
        }).toEqual({ deadline: "Deadline 17h left", sla: "SLA in 17h" });
    });

    it("⛔ they do NOT render the same words for the same moment", () => {
        // The §B4 failure, stated as an assertion. Both are 17 hours out here
        // deliberately: identical numbers are exactly when the words have to do
        // the work.
        const { deadline, sla } = both(true);
        expect(deadline.textContent).not.toBe(sla.textContent);
    });

    it("different icon families, so a glance separates them", () => {
        const { deadline, sla } = both(true);
        const iconOf = (el: HTMLElement) =>
            el.querySelector("svg")?.getAttribute("class") ?? "";
        expect(iconOf(deadline)).not.toBe(iconOf(sla));
        expect({
            deadlineHasIcon: iconOf(deadline).length > 0,
            slaHasIcon: iconOf(sla).length > 0,
        }).toEqual({ deadlineHasIcon: true, slaHasIcon: true });
    });

    it("unlabelled, the deadline badge is BARE — which is why the drawer labels it", () => {
        // Proof the `labelled` prop is load-bearing rather than decorative.
        const { deadline } = both(false);
        expect(deadline.textContent).toBe("17h left");
    });
});

describe("the ONE screen that shows both actually labels the deadline", () => {
    it("the detail drawer passes `labelled` to DeadlineBadge", () => {
        // The prop defaults to false, so §B4 is only satisfied if the drawer
        // opts in. Asserting the component in isolation would pass forever
        // while the real screen showed a bare "17h left" beside "SLA in 17h".
        const drawer = sourceOf("../task/TaskDetailDrawer.tsx");
        expect({
            rendersBoth:
                drawer.includes("<DeadlineBadge") && drawer.includes("<SLABadge"),
            labelsTheDeadline: /<DeadlineBadge[^>]*labelled/s.test(drawer),
        }).toEqual({ rendersBoth: true, labelsTheDeadline: true });
    });
});

describe("both countdowns move together", () => {
    it("neither is frozen while the other ticks", () => {
        // Before P5 the SLA badge computed `now` at render, so on a page left
        // open it stood still beside a live deadline. Two countdowns
        // disagreeing about the present is worse than either being wrong.
        expect({
            deadlineUsesSharedClock: sourceOf("./DeadlineBadge.tsx").includes(
                "useNow(",
            ),
            slaUsesSharedClock:
                sourceOf("../task/SLABadge.tsx").includes("useNow("),
            slaMakesItsOwnClock: /new Date\(\)/.test(
                sourceOf("../task/SLABadge.tsx"),
            ),
        }).toEqual({
            deadlineUsesSharedClock: true,
            slaUsesSharedClock: true,
            slaMakesItsOwnClock: false,
        });
    });
});

describe("precedence in a cramped slot", () => {
    /**
     * ⛔ THE DECISION (plan §P5.2): where only one countdown fits, the
     * DEADLINE wins.
     *
     * Why: the deadline is when the work is due and is what the person holding
     * the task is measured on. The SLA is a response commitment that is
     * usually shorter and usually already satisfied by the time a card is being
     * scanned — and it is a dev-space concept (the drawer renders it inside an
     * `isDev` strip), while a deadline is on every task in the company.
     *
     * As it stands there is no contention to resolve: `SLABadge` renders in
     * exactly ONE place, the task detail drawer, which is not cramped. This
     * test exists so that adding it to a card is a deliberate act that comes
     * with re-reading the line above, rather than a quiet second countdown
     * appearing next to the first.
     */
    const CARDS = [
        "../views/BoardCard.tsx",
        "../views/MobileTaskCard.tsx",
        "../task/TaskRow.tsx",
    ];

    it("the cards show the deadline and NOT the SLA", () => {
        const state = CARDS.map((rel) => {
            const src = sourceOf(rel);
            return {
                card: rel.split("/").pop(),
                deadline: src.includes("<DeadlineBadge"),
                sla: src.includes("<SLABadge"),
            };
        });
        expect(state).toEqual([
            { card: "BoardCard.tsx", deadline: true, sla: false },
            { card: "MobileTaskCard.tsx", deadline: true, sla: false },
            { card: "TaskRow.tsx", deadline: true, sla: false },
        ]);
    });

    it("the scan reads real files (vacuity guard)", () => {
        for (const rel of CARDS) {
            expect(sourceOf(rel).length).toBeGreaterThan(500);
        }
    });
});
