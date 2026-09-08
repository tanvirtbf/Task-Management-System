import { describe, expect, it, vi } from "vitest";

/**
 * P0 of DEADLINE_TIME_PLAN_2026-09-08 — pin the duplication before removing it.
 *
 * The user asked for the activity log to stop saying "2d ago" and start saying
 * "24 Aug, 10.24 PM". The scan found that `timeAgo` is not one function: it has
 * been copy-pasted into THREE components.
 *
 *   components/task/TaskActivitySection.tsx
 *   components/task/CommentsSection.tsx
 *   pages/home/RecentActivityCard.tsx
 *
 * That matters for two reasons. Changing the format means changing it in three
 * places, and the obvious failure mode is changing two — a comment thread and an
 * activity feed disagreeing about how to say the same instant. And a fourth copy
 * is exactly what gets written next time someone needs a timestamp.
 *
 * ⚠️ The plan called the three "byte-identical". They are not:
 * `RecentActivityCard` assigns `const d = …` where the other two inline the same
 * expression. Two distinct texts, one distinct behaviour — which is why the
 * equivalence check below COMPILES AND RUNS all three rather than comparing
 * their source. Text was never what Phase 6 depends on; identical output is.
 *
 * So this file does two jobs across the plan's life:
 *
 *   NOW (P0):  there are exactly 3, and they agree on every input — which is
 *              what makes Phase 6's consolidation provably behaviour-preserving
 *              rather than a rewrite that happens to look right.
 *   AT P6:     flipped to assert there is exactly ONE, in `lib/date-utils.ts`.
 */

const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

/** Every local `timeAgo` definition, with its body normalised for comparison. */
const definitions = (): { file: string; body: string }[] => {
    const out: { file: string; body: string }[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
        if (file.includes(".test.")) continue;
        // `const timeAgo = (...) ... => { ... };` — capture to the closing brace
        // of the arrow body at column 0, which is how all three are written.
        const m = src.match(/const timeAgo = [\s\S]*?\n};/);
        if (!m) continue;
        out.push({
            file: file.replace(/^\.\.\//, ""),
            // Normalise whitespace and the optional `: string` return annotation,
            // so a formatting difference is not read as a behavioural one.
            body: m[0].replace(/:\s*string\b/g, "").replace(/\s+/g, " ").trim(),
        });
    }
    return out.sort((a, b) => a.file.localeCompare(b.file));
};

describe("relative-time rendering — the duplication, pinned (P0)", () => {
    it("the scan can see the client source at all (guards a vacuous pass)", () => {
        expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    });

    it("there are exactly THREE copies of timeAgo, in the known files", () => {
        expect(definitions().map((d) => d.file)).toEqual([
            "components/task/CommentsSection.tsx",
            "components/task/TaskActivitySection.tsx",
            "pages/home/RecentActivityCard.tsx",
        ]);
    });

    it("all three AGREE on every output — so consolidating changes no behaviour", () => {
        /**
         * ⚠️ Corrected during P0. The plan claimed these were "byte-identical";
         * they are not. `RecentActivityCard` assigns `const d = …` where the
         * other two inline the same expression — two distinct TEXTS, and a
         * string comparison called that a drift.
         *
         * Text was never the thing that mattered. What Phase 6 needs to know is
         * that replacing three functions with one changes no OUTPUT, so the
         * three are compiled and run against the same inputs instead.
         */
        const fns = definitions().map((d) => ({
            file: d.file,
            fn: Function(`"use strict"; ${d.body} return timeAgo;`)() as (
                iso: string,
            ) => string,
        }));
        expect(fns).toHaveLength(3);

        const now = Date.UTC(2026, 2, 20, 12, 0, 0);
        const MIN = 60_000;
        const inputs = [
            0, // just now
            30 * 1000, // <1m
            5 * MIN,
            59 * MIN,
            60 * MIN, // the hour boundary
            23 * 60 * MIN,
            24 * 60 * MIN, // the day boundary
            13 * 24 * 60 * MIN, // "13d ago", the case the user called out
        ];

        vi.useFakeTimers();
        vi.setSystemTime(new Date(now));
        try {
            for (const ms of inputs) {
                const iso = new Date(now - ms).toISOString();
                const answers = fns.map((f) => f.fn(iso));
                const distinct = [...new Set(answers)];
                expect({ ms, distinct: distinct.length, answer: distinct[0] }).toEqual({
                    ms,
                    distinct: 1,
                    answer: answers[0],
                });
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it("and they render the shape the user is asking us to replace", () => {
        // Recorded so the "before" is in the repo, not just in a chat message.
        const body = definitions()[0].body;
        for (const shape of ["just now", "m ago", "h ago", "d ago"]) {
            expect(body).toContain(shape);
        }
        // No absolute format anywhere yet — this is what P6 adds.
        expect(body).not.toMatch(/toLocaleDateString|toLocaleString/);
    });
});
