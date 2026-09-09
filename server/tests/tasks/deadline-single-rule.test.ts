import fs from "node:fs";
import path from "node:path";

/**
 * P2 of DEADLINE_TIME_PLAN_2026-09-08 — there is ONE deadline rule, and this
 * test is what keeps it that way.
 *
 * `src/utils/deadline.ts` decides "has this deadline passed" and "is this due
 * today, not yet late". Before P2 that judgement was written out by hand in
 * eleven places across three repositories, and the reason this guard exists is
 * that adding a time to the deadline made every one of them wrong at once. The
 * next person to need an overdue filter must reach for the resolver rather than
 * type `dueDate < today` again — and a test is the only thing that will tell
 * them so at the moment they do it.
 *
 * Modelled on P13's `write-paths-recompute` guard, including the part that
 * matters most: it is proved able to fire, on a reconstruction of the very
 * pattern it forbids.
 */

const SRC = path.join(__dirname, "..", "..", "src");
const RESOLVER = path.join("utils", "deadline.ts");

/** Every `.ts` under `src/`, except the file that defines the rule. */
const sourceFiles = (dir: string, acc: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, acc);
        else if (entry.name.endsWith(".ts")) acc.push(full);
    }
    return acc;
};

/**
 * The two shapes that ARE a deadline judgement.
 *
 * `<` (strict) is "overdue"; `= <today>` is "due today". Deliberately NOT
 * matched: `>=` / `<=` date WINDOWS — the seven-day look-ahead, an agenda for a
 * requested day, and the caller-supplied `dueAfter`/`dueBefore` filter are
 * ranges over a calendar, not verdicts about lateness, and they stay date-only
 * on purpose. `[^=]` after the `<` is what separates the verdict from the
 * window, since `<=` starts with `<`.
 */
const OVERDUE_SHAPE = /\$\{tasks\.dueDate\}\s*<[^=]/;
const DUE_TODAY_SHAPE = /\$\{tasks\.dueDate\}\s*=\s*\$\{[^}]*\btoday\b/;

const scan = (files: { file: string; src: string }[]) => {
    const hits: string[] = [];
    for (const { file, src } of files) {
        src.split(/\r?\n/).forEach((line, i) => {
            if (OVERDUE_SHAPE.test(line)) hits.push(`${file}:${i + 1} overdue`);
            if (DUE_TODAY_SHAPE.test(line)) hits.push(`${file}:${i + 1} due-today`);
        });
    }
    return hits;
};

const loaded = sourceFiles(SRC)
    .filter((f) => !f.endsWith(RESOLVER))
    .map((f) => ({
        file: path.relative(SRC, f).replace(/\\/g, "/"),
        src: fs.readFileSync(f, "utf8"),
    }));

describe("the deadline rule has exactly one home", () => {
    it("the scan reads this codebase (guards against a vacuous pass)", () => {
        expect(loaded.length).toBeGreaterThan(50);
        const names = loaded.map((f) => f.file);
        // The three repositories the judgement used to be spread across must be
        // in the scan, or the whole thing passes for the wrong reason.
        expect(names).toContain("repositories/TasksRepo.ts");
        expect(names).toContain("repositories/HomeRepo.ts");
        expect(names).toContain("repositories/ReviewsRepo.ts");
    });

    it("nothing outside the resolver decides overdue or due-today itself", () => {
        expect({ handWrittenJudgements: scan(loaded) }).toEqual({
            handWrittenJudgements: [],
        });
    });

    it("and the resolver is actually being USED — by all three repositories", () => {
        // Without this, deleting every call site would satisfy the rule above.
        const uses = (file: string) =>
            loaded.find((f) => f.file === file)?.src.includes("sqlDeadlinePassed") ?? false;
        expect({
            tasks: uses("repositories/TasksRepo.ts"),
            home: uses("repositories/HomeRepo.ts"),
            reviews: uses("repositories/ReviewsRepo.ts"),
            job: loaded
                .find((f) => f.file === "jobs/overdueAlert.ts")
                ?.src.includes("workspaceNow"),
        }).toEqual({ tasks: true, home: true, reviews: true, job: true });
    });

    it("the rule FIRES — on the pattern it forbids", () => {
        // A guard nobody has watched fail is a guard nobody has. This is the
        // exact line that used to sit in three repositories.
        const overdue = [
            {
                file: "fake/SomeRepo.ts",
                src: "const where = and(open, sql`${tasks.dueDate} < ${today}`);",
            },
        ];
        expect(scan(overdue)).toEqual(["fake/SomeRepo.ts:1 overdue"]);

        const dueToday = [
            {
                file: "fake/OtherRepo.ts",
                src: "sql`${tasks.dueDate} = ${today}`",
            },
        ];
        expect(scan(dueToday)).toEqual(["fake/OtherRepo.ts:1 due-today"]);
    });

    it("does NOT fire on a date WINDOW, which is a different thing", () => {
        // `due_soon` is a range over the calendar, not a verdict about lateness,
        // and must stay date-only. If this ever started failing, the guard would
        // be pushing people to resolve a timezone they do not need.
        const windows = [
            {
                file: "fake/WindowRepo.ts",
                src: [
                    "sql`${tasks.dueDate} >= ${now.today}`,",
                    "sql`${tasks.dueDate} <= DATE_ADD(${now.today}, INTERVAL 7 DAY)`,",
                    "sql`${tasks.dueDate} = ${date}`,",
                    "sql`${tasks.dueDate} <= ${params.dueBefore}`",
                ].join("\n"),
            },
        ];
        expect(scan(windows)).toEqual([]);
    });
});
