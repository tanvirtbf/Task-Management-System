import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DUE_DATE_PRESETS,
    EMPTY_TASK_FILTERS,
    UNASSIGNED,
    applyTaskFilters,
    countActiveTaskFilters,
    type TaskFilterState,
} from "./taskFilters";
import { dayKey, parseWireDate } from "../../lib/date-utils";
import type { Task } from "../../types";

/**
 * §P13 / KI-24 — the shared task filter, which every task surface runs.
 *
 * Two things are pinned here, and the first one is a real defect P13 found
 * while measuring the second.
 *
 * ── the timezone defect ─────────────────────────────────────────────────────
 * `due_date` crosses the wire as a plain calendar day, `"2026-03-20"` — the
 * serializer's `toWireDate` builds it from UTC components precisely so it
 * carries no timezone. The filter then read it back as
 * `dayKey(new Date(t.dueDate))`, and that round-trip re-introduces one:
 * `new Date("2026-03-20")` is UTC midnight, and `dayKey` reads the LOCAL
 * calendar day off it. East of UTC that lands on the same day and looks fine —
 * which is why Dhaka never saw it. West of UTC it lands on the PREVIOUS day,
 * so a task due the 20th is filtered as if it were due the 19th.
 *
 * `toWireDate`'s own comment warned about exactly this shape ("In, say, New
 * York it would have rendered the previous day"), and P10 fixed the same class
 * on the calendar's drop handler. These tests run the filter under a western
 * zone so the bug cannot hide behind the office's UTC+6.
 *
 * ⚠️ Node applies the TZ environment variable to Dates created AFTER it is
 * set, which is what makes this testable at all — `vi.stubEnv("TZ", …)` inside
 * a test really does move the clock, and `vi.unstubAllEnvs()` puts it back so
 * the zone cannot leak into another suite. (Verified by removing the fix and
 * watching 5 of these go red.) `vi.stubEnv` rather than assigning
 * `process.env` directly: the client tsconfig has no Node types, so the direct
 * form compiles under vitest but fails `tsc -b`, which is a gate check.
 */

/** Set the process timezone for the assertions that follow. */
const inZone = (tz: string) => vi.stubEnv("TZ", tz);
afterEach(() => {
    vi.unstubAllEnvs();
});

/** A task carrying only the fields the filter reads. */
const task = (over: Partial<Task> = {}): Task =>
    ({
        id: "t1",
        statusId: "st_open",
        assignees: [],
        priority: 0,
        dueDate: null,
        ...over,
    }) as unknown as Task;

const filters = (over: Partial<TaskFilterState> = {}): TaskFilterState => ({
    ...EMPTY_TASK_FILTERS,
    ...over,
});

const ids = (ts: Task[]) => ts.map((t) => t.id);

/**
 * The pre-P7 two-argument form, for the cases that predate the clock.
 *
 * `applyTaskFilters` gained a REQUIRED third argument at P7 precisely so the
 * compiler would list every caller (the P2 lesson). Every assertion below is a
 * pure date-window case, where the clock is never consulted — so a fixed one is
 * honest here, and the cases that DO depend on it call the real function
 * directly with their own.
 */
const applyFilters = (ts: Task[], f: TaskFilterState) =>
    applyTaskFilters(ts, f, {
        timeZone: "Asia/Dhaka",
        now: Date.parse("2026-03-20T04:00:00.000Z"),
    });

describe("applyTaskFilters — due-date window", () => {
    it("keeps a task due on the exact day the window names", () => {
        const t = task({ id: "due20", dueDate: "2026-03-20" });
        expect(
            ids(
                applyFilters([t], filters({ dueFrom: "2026-03-20", dueTo: "2026-03-20" })),
            ),
        ).toEqual(["due20"]);
    });

    it("reads the wire date as a CALENDAR DAY, west of UTC too (P13)", () => {
        // The regression. In New York the old implementation resolved
        // "2026-03-20" to 2026-03-19 and dropped the task from its own day.
        inZone("America/New_York");
        const t = task({ id: "due20", dueDate: "2026-03-20" });

        expect(
            ids(
                applyFilters([t], filters({ dueFrom: "2026-03-20", dueTo: "2026-03-20" })),
            ),
        ).toEqual(["due20"]);

        // …and it must NOT answer to the day before, which is where it used to
        // land. Without this the test would pass on an implementation that had
        // merely shifted the bug.
        expect(
            ids(
                applyFilters([t], filters({ dueFrom: "2026-03-19", dueTo: "2026-03-19" })),
            ),
        ).toEqual([]);
    });

    it("agrees across zones — the same task, the same window, four clocks", () => {
        const t = task({ id: "due20", dueDate: "2026-03-20" });
        const window = filters({ dueFrom: "2026-03-20", dueTo: "2026-03-20" });
        for (const tz of [
            "Asia/Dhaka",
            "UTC",
            "America/New_York",
            "Pacific/Midway",
        ]) {
            inZone(tz);
            expect({ tz, kept: ids(applyFilters([t], window)) }).toEqual({
                tz,
                kept: ["due20"],
            });
        }
    });

    it("half-open windows still bound on the right side", () => {
        inZone("America/New_York");
        const ts = [
            task({ id: "a", dueDate: "2026-03-19" }),
            task({ id: "b", dueDate: "2026-03-20" }),
            task({ id: "c", dueDate: "2026-03-21" }),
        ];
        expect(ids(applyFilters(ts, filters({ dueFrom: "2026-03-20" })))).toEqual([
            "b",
            "c",
        ]);
        expect(ids(applyFilters(ts, filters({ dueTo: "2026-03-20" })))).toEqual([
            "a",
            "b",
        ]);
    });

    it("drops undated tasks unless includeUndated says otherwise", () => {
        const ts = [task({ id: "dated", dueDate: "2026-03-20" }), task({ id: "undated" })];
        const window = { dueFrom: "2026-03-01", dueTo: "2026-03-31" };
        expect(ids(applyFilters(ts, filters(window)))).toEqual(["dated"]);
        expect(
            ids(applyFilters(ts, filters({ ...window, includeUndated: true }))),
        ).toEqual(["dated", "undated"]);
    });
});

describe("P7 — the Overdue preset must agree with the deadline badge", () => {
    /**
     * The semantics sweep's headline case.
     *
     * P1 gave a deadline a time, P2 taught the server to judge it and P4 put a
     * countdown on every card. The client's filter model never changed: it is a
     * `[dueFrom, dueTo]` window over calendar DAYS, and "Overdue" is expressed
     * as `[null, yesterday]`.
     *
     * So a task due TODAY at 09:00, read at 10:00, wears a red "5h late" badge
     * and is in the server's overdue bucket — and does NOT appear when you
     * filter for Overdue. One screen, two answers.
     */
    /** 2026-03-20, 10:00 — an hour after a 09:00 deadline. */
    const NOW = new Date(2026, 2, 20, 10, 0).getTime();

    /**
     * The Overdue preset AS THE POPOVER APPLIES IT — range and flag together.
     *
     * Building the state from the range alone is what the first draft of these
     * tests did, and it asserted a gap that the fix had already closed: the
     * range still says `[null, yesterday]` (the popover matches on it to show
     * which chip is active), and `deadlinePassed` is what actually decides.
     */
    const overduePreset = (): TaskFilterState => {
        const preset = DUE_DATE_PRESETS.find((p) => p.key === "overdue")!;
        const [dueFrom, dueTo] = preset.range(6);
        return filters({
            dueFrom,
            dueTo,
            deadlinePassed: preset.deadlinePassed ?? false,
        });
    };

    it("still catches a task whose DAY has passed", () => {
        // The pre-027 behaviour, which must not regress.
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        try {
            const t = task({ id: "yesterday", dueDate: "2026-03-19" });
            expect(
                ids(
                    applyTaskFilters([t], overduePreset(), {
                        timeZone: "Asia/Dhaka",
                        now: NOW,
                    }),
                ),
            ).toEqual(["yesterday"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("⛔ catches a task due TODAY whose time has passed", () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        try {
            const late = task({
                id: "late-today",
                dueDate: "2026-03-20",
                dueTime: "09:00",
            });
            expect(
                ids(
                    applyTaskFilters([late], overduePreset(), {
                        timeZone: "Asia/Dhaka",
                        now: NOW,
                    }),
                ),
            ).toEqual(["late-today"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("but NOT one due later today", () => {
        // The other half: an afternoon deadline is not overdue at 10am, and a
        // fix that swept in every task due today would be worse than the bug.
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        try {
            const later = task({
                id: "later-today",
                dueDate: "2026-03-20",
                dueTime: "17:00",
            });
            expect(
                ids(
                    applyTaskFilters([later], overduePreset(), {
                        timeZone: "Asia/Dhaka",
                        now: NOW,
                    }),
                ),
            ).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("and NOT a time-less task due today — end of day, not midnight (§B1)", () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        try {
            const timeless = task({ id: "timeless", dueDate: "2026-03-20" });
            expect(
                ids(
                    applyTaskFilters([timeless], overduePreset(), {
                        timeZone: "Asia/Dhaka",
                        now: NOW,
                    }),
                ),
            ).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a NON-overdue window is untouched by any of this", () => {
        // "This week" must keep meaning a calendar week. Only the overdue
        // preset carries a lateness judgement.
        const t = task({
            id: "friday",
            dueDate: "2026-03-20",
            dueTime: "09:00",
        });
        expect(
            ids(
                applyTaskFilters(
                    [t],
                    filters({ dueFrom: "2026-03-16", dueTo: "2026-03-22" }),
                    { timeZone: "Asia/Dhaka", now: NOW },
                ),
            ),
        ).toEqual(["friday"]);
    });
});

describe("dayKey — a wire date is already a calendar day", () => {
    it("returns a YYYY-MM-DD string unchanged, in any zone", () => {
        for (const tz of ["Asia/Dhaka", "UTC", "America/New_York", "Pacific/Midway"]) {
            inZone(tz);
            expect({ tz, key: dayKey("2026-03-20") }).toEqual({
                tz,
                key: "2026-03-20",
            });
        }
    });

    it("still reads a real instant on the LOCAL calendar", () => {
        // The other half of the contract, and the reason `dayKey` cannot simply
        // stop touching timezones: for an actual timestamp, the local day is
        // exactly what the caller wants (`dayKey(new Date())` = "today here").
        inZone("UTC");
        expect(dayKey(new Date("2026-03-20T23:30:00Z"))).toBe("2026-03-20");
        inZone("Asia/Dhaka");
        expect(dayKey(new Date("2026-03-20T23:30:00Z"))).toBe("2026-03-21");
    });
});

describe("applyTaskFilters — the other predicates", () => {
    it("returns the SAME array reference when nothing is filtered", () => {
        // The early return is load-bearing: every view re-runs this pass, and a
        // fresh array on every call would defeat the memo below it.
        const ts = [task()];
        expect(applyFilters(ts, filters())).toBe(ts);
    });

    it("keeps tasks whose status is selected", () => {
        const ts = [
            task({ id: "a", statusId: "open" }),
            task({ id: "b", statusId: "done" }),
        ];
        expect(ids(applyFilters(ts, filters({ statusIds: ["open"] })))).toEqual(["a"]);
    });

    it("matches if ANY assignee is selected, and handles the unassigned sentinel", () => {
        const ts = [
            task({ id: "mine", assignees: ["u1"] }),
            task({ id: "shared", assignees: ["u9", "u1"] }),
            task({ id: "theirs", assignees: ["u9"] }),
            task({ id: "nobody", assignees: [] }),
        ];
        expect(ids(applyFilters(ts, filters({ assigneeIds: ["u1"] })))).toEqual([
            "mine",
            "shared",
        ]);
        expect(
            ids(applyFilters(ts, filters({ assigneeIds: [UNASSIGNED] }))),
        ).toEqual(["nobody"]);
        expect(
            ids(applyFilters(ts, filters({ assigneeIds: ["u1", UNASSIGNED] }))),
        ).toEqual(["mine", "shared", "nobody"]);
    });

    it("filters on priority", () => {
        const ts = [
            task({ id: "urgent", priority: 1 }),
            task({ id: "low", priority: 4 }),
        ];
        expect(ids(applyFilters(ts, filters({ priorities: [1] })))).toEqual([
            "urgent",
        ]);
    });

    it("ANDs the groups together", () => {
        const ts = [
            task({ id: "hit", statusId: "open", assignees: ["u1"], priority: 1 }),
            task({ id: "wrongStatus", statusId: "done", assignees: ["u1"], priority: 1 }),
            task({ id: "wrongPerson", statusId: "open", assignees: ["u2"], priority: 1 }),
            task({ id: "wrongPriority", statusId: "open", assignees: ["u1"], priority: 4 }),
        ];
        expect(
            ids(
                applyFilters(
                    ts,
                    filters({
                        statusIds: ["open"],
                        assigneeIds: ["u1"],
                        priorities: [1],
                    }),
                ),
            ),
        ).toEqual(["hit"]);
    });

    it("counts active filter GROUPS, not values", () => {
        expect(countActiveTaskFilters(filters())).toBe(0);
        expect(
            countActiveTaskFilters(
                filters({ statusIds: ["a", "b", "c"], dueFrom: "2026-01-01" }),
            ),
        ).toBe(2);
    });
});

describe("parseWireDate — the display half of the same defect", () => {
    it("puts a wire date on its own LOCAL calendar day, in any zone", () => {
        // `DueDateBadge` decides overdue / today / "Tomorrow" by comparing this
        // Date to `new Date()` in local time. Before P13 it used
        // `new Date(dueDate)` — UTC midnight — so west of UTC a task due TODAY
        // compared as yesterday and rendered as the red OVERDUE chip on every
        // row, card and board tile.
        for (const tz of ["Asia/Dhaka", "UTC", "America/New_York", "Pacific/Midway"]) {
            inZone(tz);
            const d = parseWireDate("2026-03-20");
            expect({
                tz,
                y: d.getFullYear(),
                m: d.getMonth() + 1,
                day: d.getDate(),
                h: d.getHours(),
            }).toEqual({ tz, y: 2026, m: 3, day: 20, h: 0 });
        }
    });

    it("resolves a real timestamp to the local day", () => {
        inZone("Asia/Dhaka");
        // 23:30 UTC is already the next day in Dhaka, and that is the day a
        // person there should see.
        expect(dayKey(parseWireDate(new Date("2026-03-20T23:30:00Z")))).toBe(
            "2026-03-21",
        );
    });
});
