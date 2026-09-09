import { afterEach, describe, expect, it, vi } from "vitest";
import { formatActivityTime, RELATIVE_CUTOVER_MS } from "./date-utils";

/**
 * P0 wrote this file to pin a duplication. **P6 flipped it**, exactly as P0's
 * closing note said it would:
 *
 *   NOW (P0):  there are exactly 3, and they agree on every input.
 *   AT P6:     flipped to assert there is exactly ONE, in `lib/date-utils.ts`.
 *
 * ── ⛔ what P0 got wrong, found by doing P6 ─────────────────────────────────
 * There were **EIGHT** copies, not three, under FIVE names:
 *
 *   timeAgo    — TaskActivitySection, CommentsSection, RecentActivityCard
 *   formatTime — InboxPage
 *   agoOf      — AssignmentRequestCard
 *   relTime    — ReviewSection, DeptQueue, DeptSummary
 *
 * P0 found three because it searched for the NAME `timeAgo`. Five copies were
 * invisible to it, and a name-based scan would have missed them again at P6 —
 * which is why the guard below searches for the BEHAVIOUR (the `"just now"`
 * and `"…m ago"` shapes). A ninth copy called `whenWasThat` cannot hide.
 *
 * ⚠️ And they did not agree. Four stopped at `13d ago` forever; four fell
 * through to `toLocaleDateString()` after seven days. **The same instant
 * already rendered two different ways depending on which screen you were
 * on** — a shipped inconsistency nobody had reported, found only because the
 * consolidation was verified rather than assumed.
 */

const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

/**
 * The file allowed to contain the rule. Everything else is a copy.
 *
 * `./` and not `../lib/`: vite keys a same-directory file relative to THIS
 * one. Getting it wrong makes the helper look like a copy of itself and the
 * `rule DOES live in the helper` check look like a missing file.
 */
const HELPER = "./date-utils.ts";

/**
 * Any file that formats a relative time for itself.
 *
 * Matched on the two literals every such function must contain to work, in any
 * order: the "nothing has happened yet" string and the minutes suffix. Both,
 * not either — `"just now"` alone appears in copy, and `"m ago"` alone would
 * match a comment.
 */
const localFormatters = (): string[] =>
    Object.entries(SOURCES)
        .filter(([file]) => !file.includes(".test.") && file !== HELPER)
        .filter(
            ([, src]) =>
                src.includes('"just now"') && /`\$\{[^}]+\}m ago`/.test(src),
        )
        .map(([file]) => file.replace(/^\.\.\//, ""))
        .sort();

afterEach(() => {
    vi.useRealTimers();
});

describe("there is exactly ONE relative-time rule (P6)", () => {
    it("the scan can see the client source at all (guards a vacuous pass)", () => {
        expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    });

    it("no component formats a relative time for itself any more", () => {
        expect({ copies: localFormatters() }).toEqual({ copies: [] });
    });

    it("the rule DOES live in the shared helper", () => {
        // Without this, deleting the helper would satisfy the assertion above.
        const helper = SOURCES[HELPER];
        expect({
            exists: helper !== undefined,
            hasJustNow: helper?.includes('"just now"') ?? false,
            hasMinutes: /`\$\{[^}]+\}m ago`/.test(helper ?? ""),
        }).toEqual({ exists: true, hasJustNow: true, hasMinutes: true });
    });

    it("the guard FIRES on a copy — under a name nothing searches for", () => {
        // P0's scan looked for `timeAgo` and therefore never saw the inbox's
        // `formatTime`. This one looks at what the code DOES.
        const fake = {
            "../pages/Somewhere.tsx": [
                "const whenWasThat = (iso: string) => {",
                '  if (m < 1) return "just now";',
                "  return `${m}m ago`;",
                "};",
            ].join("\n"),
        };
        const hits = Object.entries(fake)
            .filter(
                ([, src]) =>
                    src.includes('"just now"') && /`\$\{[^}]+\}m ago`/.test(src),
            )
            .map(([f]) => f);
        expect(hits).toEqual(["../pages/Somewhere.tsx"]);
    });

    it("all EIGHT former call sites now import the helper", () => {
        // Listed explicitly rather than derived, so removing a call site is a
        // visible edit here and not a silently shorter list.
        const CALLERS = [
            "../components/task/TaskActivitySection.tsx",
            "../components/task/CommentsSection.tsx",
            "../components/task/AssignmentRequestCard.tsx",
            "../components/task/ReviewSection.tsx",
            "../pages/home/RecentActivityCard.tsx",
            "../pages/inbox/InboxPage.tsx",
            "../pages/dept/DeptQueue.tsx",
            "../pages/dept/DeptSummary.tsx",
        ];
        expect(
            CALLERS.map((f) => ({
                file: f.replace(/^\.\.\//, ""),
                imports: (SOURCES[f] ?? "").includes(
                    'import { formatActivityTime } from "../../lib/date-utils"',
                ),
                uses: (SOURCES[f] ?? "").includes("formatActivityTime("),
            })),
        ).toEqual(
            CALLERS.map((f) => ({
                file: f.replace(/^\.\.\//, ""),
                imports: true,
                uses: true,
            })),
        );
    });
});

describe("the hybrid format the user asked for (§P6.3)", () => {
    /** 2026-08-24, 22:24 local — the user's own example instant. */
    const AUG24 = new Date(2026, 7, 24, 22, 24, 0).getTime();

    it("renders '24 Aug, 10.24 PM' — the exact shape asked for", () => {
        // The dot in "10.24" is the user's notation, not a typo for a colon.
        expect(formatActivityTime(new Date(AUG24), AUG24 + 3 * 60 * 60 * 1000)).toBe(
            "24 Aug, 10.24 PM",
        );
    });

    it("stays RELATIVE under the cutover hour", () => {
        const now = AUG24 + RELATIVE_CUTOVER_MS;
        expect([
            formatActivityTime(new Date(now), now),
            formatActivityTime(new Date(now - 30_000), now),
            formatActivityTime(new Date(now - 12 * 60_000), now),
            formatActivityTime(new Date(now - 59 * 60_000), now),
        ]).toEqual(["just now", "just now", "12m ago", "59m ago"]);
    });

    it("becomes ABSOLUTE at the cutover, and both sides are pinned", () => {
        // The boundary is the whole decision, so it is asserted from both
        // sides of the same instant rather than trusted to a constant.
        const now = AUG24 + RELATIVE_CUTOVER_MS;
        expect({
            // One second short of an hour old.
            justUnder: formatActivityTime(new Date(AUG24 + 1000), now),
            // Exactly an hour old — the first instant that goes absolute.
            exactly: formatActivityTime(new Date(AUG24), now),
        }).toEqual({ justUnder: "59m ago", exactly: "24 Aug, 10.24 PM" });
    });

    it("never says '13d ago' again — the case the user called out", () => {
        const now = AUG24 + 13 * 24 * 60 * 60 * 1000;
        const out = formatActivityTime(new Date(AUG24), now);
        expect(out).toBe("24 Aug, 10.24 PM");
        expect(out).not.toMatch(/ago/);
    });

    it("adds the year only when it differs from now", () => {
        // Without this, a comment from two Augusts ago is indistinguishable
        // from last week's.
        const at = new Date(2026, 7, 24, 22, 24).getTime();
        expect({
            // Read in December of the same year…
            thisYear: formatActivityTime(
                new Date(at),
                new Date(2026, 11, 31, 9, 0).getTime(),
            ),
            // …and a week later, in January of the next one.
            lastYear: formatActivityTime(
                new Date(at),
                new Date(2027, 0, 5, 9, 0).getTime(),
            ),
        }).toEqual({
            thisYear: "24 Aug, 10.24 PM",
            lastYear: "24 Aug 2026, 10.24 PM",
        });
    });

    it("gets midnight and noon right", () => {
        // Both land on hour 0 under `% 12`, and one of them reads 12.
        const day = (h: number, m: number) =>
            formatActivityTime(
                new Date(2026, 7, 24, h, m),
                new Date(2026, 7, 25, 12, 0).getTime(),
            );
        expect([day(0, 5), day(11, 59), day(12, 0), day(12, 1), day(23, 59)]).toEqual([
            "24 Aug, 12.05 AM",
            "24 Aug, 11.59 AM",
            "24 Aug, 12.00 PM",
            "24 Aug, 12.01 PM",
            "24 Aug, 11.59 PM",
        ]);
    });

    it("survives the inputs that used to reach four different functions", () => {
        const now = Date.UTC(2026, 2, 20, 12, 0, 0);
        expect([
            formatActivityTime(null, now),
            formatActivityTime(undefined, now),
            formatActivityTime("", now),
            formatActivityTime("not a date", now),
            // Clock skew: the API's instant is slightly ahead of the browser.
            formatActivityTime(new Date(now + 5000), now),
        ]).toEqual(["", "", "", "", "just now"]);
    });
});

describe("⛔ these are INSTANTS, so they render in the VIEWER's zone", () => {
    /**
     * Deliberately the opposite of the deadline badge, which renders in the
     * WORKSPACE's zone. A deadline is a wall-clock promise — "5 PM" means five
     * in the office that set it, for everyone. An activity timestamp is a real
     * moment that already happened, and the only useful question about it is
     * when it happened relative to the person reading.
     *
     * This test exists so that someone "fixing the inconsistency" has to delete
     * an assertion and read the reason first.
     */
    const INSTANT = "2026-08-24T16:24:00.000Z";
    const NOW = Date.parse("2026-08-25T10:00:00.000Z");

    it("renders the instant in whatever zone the VIEWER is in", () => {
        // Zone-agnostic on purpose: it asserts the output matches the same
        // instant's LOCAL components, whatever this machine's zone happens to
        // be. An earlier draft tried to set `process.env.TZ` per case — that
        // needs node types the client tsconfig deliberately lacks, and V8 does
        // not re-resolve its zone mid-run in any case, so it would have
        // asserted nothing while looking thorough.
        const at = new Date(INSTANT);
        const h = at.getHours();
        const hour = h % 12 === 0 ? 12 : h % 12;
        const expected = `${at.getDate()} ${
            [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec",
            ][at.getMonth()]
        }, ${hour}.${String(at.getMinutes()).padStart(2, "0")} ${
            h < 12 ? "AM" : "PM"
        }`;
        expect(formatActivityTime(at, NOW)).toBe(expected);
    });

    it("the helper reads LOCAL components, not UTC ones", () => {
        // The structural version of the claim above, and the one that cannot
        // be defeated by a platform that ignores a mid-run TZ change: reading
        // `getUTCHours` here would make every viewer see the office's clock.
        const helper = SOURCES[HELPER] ?? "";
        const fn = helper.slice(helper.indexOf("export const formatActivityTime"));
        expect({
            usesLocal: /at\.getHours\(\)/.test(fn),
            usesUtc: /getUTC(Hours|Date|Month|FullYear)\(/.test(fn),
        }).toEqual({ usesLocal: true, usesUtc: false });
    });
});
