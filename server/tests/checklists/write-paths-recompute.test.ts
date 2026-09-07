import fs from "node:fs";
import path from "node:path";

/**
 * §P12 task 6 — every path that changes the number of checklist items must
 * update the rollup that summarises them.
 *
 * `tasks.checklist_items_total / _done` is a denormalised cache. There is no
 * trigger behind it: `TasksRepo.recomputeChecklistCounters` is called BY HAND
 * inside each write transaction. `counters.test.ts` walks the sequence and
 * `counter-truth.test.ts` recounts after a mixed run — but both can only
 * exercise the write paths that existed when they were written. A NEW path
 * that forgets the recompute is invisible to both, and that is exactly the
 * shape this cache drifts in.
 *
 * P12 found one, live: `TemplateApplyService` raw-inserts a checklist and its
 * items straight onto a new task, bypassing `ChecklistsService` entirely. A
 * task spawned from a 12-step template reported "0/0" on the card, in the list
 * row, on the board and to the assistant — and stayed wrong until somebody
 * happened to tick an item, at which point the absolute recompute quietly
 * repaired it and destroyed the evidence.
 *
 * So this test does not check behaviour. It checks the CODE, so the next path
 * that forgets is caught the day it is written rather than by a user counting
 * a card by hand.
 */

const SRC = path.join(__dirname, "..", "..", "src");

/**
 * The repo mutators that can change either counter. `insertChecklist` and
 * `updateChecklist` are deliberately absent — a new checklist has no items and
 * a rename moves nothing — and so is `ChecklistsRepo.updateItem`, which
 * patches only `text` / `assigneeId` / `position` (pinned below, because that
 * is an assumption and assumptions rot).
 */
const COUNT_CHANGING = [
    "insertItem",
    "insertItems",
    "deleteItem",
    "setItemCompletion",
    "deleteChecklist",
];

/** Direct table writes — the way `TemplateApplyService` sidesteps the repo. */
const DIRECT_WRITE =
    /\.(?:insert|delete|update)\(\s*checklistItems\b|\.delete\(\s*checklists\b/;

const RECOMPUTE = "recomputeChecklistCounters";

/** Every `.ts` under `src/`, minus the files that DEFINE this machinery. */
const sourceFiles = (dir: string, acc: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, acc);
        else if (entry.name.endsWith(".ts")) acc.push(full);
    }
    return acc;
};

const EXCLUDED = [
    // Where the mutators live; calling them here IS the implementation.
    path.join("repositories", "ChecklistsRepo.ts"),
    // Where the recompute lives.
    path.join("repositories", "TasksRepo.ts"),
    // Schema definitions and the demo seeder, which repairs the counters in
    // one bulk statement of its own after loading everything.
    `src${path.sep}db${path.sep}`,
];

/**
 * Split a file into class-method chunks. Method granularity matters: five
 * methods on `ChecklistsService` recompute and three correctly do not, so a
 * file-level check would pass that file while a single method inside it had
 * quietly dropped the call.
 */
const methodChunks = (src: string): { name: string; body: string }[] => {
    const re =
        /^ {4}(?:(?:private|public|protected|static)\s+)*(?:async\s+)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/gm;
    const starts: { name: string; at: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null)
        starts.push({ name: m[1], at: m.index });
    if (starts.length === 0) return [{ name: "<file>", body: src }];
    return starts.map((s, i) => {
        const raw = src.slice(s.at, starts[i + 1]?.at ?? src.length);
        // End at the method's own closing brace. Without this a chunk swallows
        // the JSDoc of the method BELOW it, and `updateItem` inherits the word
        // `is_completed` from `toggleItem`'s comment — a false positive that
        // is very hard to see when it happens.
        const end = raw.lastIndexOf("\n    }");
        return { name: s.name, body: end > 0 ? raw.slice(0, end + 6) : raw };
    });
};

type Violation = { file: string; method: string };

/**
 * Whether a method body changes the item count.
 *
 * `repoFacing` is what keeps this honest. `ChecklistsController` calls
 * `this.service.deleteChecklist(...)` and `this.service.deleteItem(...)` —
 * identical spellings to the repo mutators, on an object that DOES recompute
 * one layer down. Matching bare method names flagged both, which is the way a
 * guard like this becomes noise and then gets deleted. A file only counts as
 * calling the repo if it actually names `ChecklistsRepo`; direct table writes
 * are caught everywhere regardless, which is how the P12 defect surfaced.
 */
const changesTheCount = (body: string, repoFacing: boolean): boolean =>
    DIRECT_WRITE.test(body) ||
    (repoFacing && COUNT_CHANGING.some((fn) => body.includes(`.${fn}(`)));

/** The whole rule, as one function — so it can be run on a fake and proved. */
const violations = (files: { file: string; src: string }[]): Violation[] => {
    const out: Violation[] = [];
    for (const { file, src } of files) {
        const repoFacing = src.includes("ChecklistsRepo");
        for (const { name, body } of methodChunks(src)) {
            if (
                changesTheCount(body, repoFacing) &&
                !body.includes(RECOMPUTE)
            ) {
                out.push({ file, method: name });
            }
        }
    }
    return out;
};

const slash = (p: string) => p.replace(/\\/g, "/");

const loaded = sourceFiles(SRC)
    .filter((f) => !EXCLUDED.some((ex) => f.includes(ex)))
    .map((f) => ({
        file: slash(path.relative(SRC, f)),
        src: fs.readFileSync(f, "utf8"),
    }));

describe("the checklist rollup — every count-changing write recomputes it", () => {
    it("the scan actually reads this codebase (guards against a vacuous pass)", () => {
        expect(loaded.length).toBeGreaterThan(50);
        // The two files the rule is really about must be among them; a typo in
        // EXCLUDED that swallowed one would otherwise make this suite green.
        const names = loaded.map((f) => f.file);
        expect(names).toContain("services/ChecklistsService.ts");
        expect(names).toContain("services/TemplateApplyService.ts");

        // …and `ChecklistsService` is seen as repo-facing. If it were not, the
        // five mutator calls inside it would stop being checked at all and the
        // suite would go green for the worst possible reason.
        const svc = loaded.find(
            (f) => f.file === "services/ChecklistsService.ts",
        );
        expect(svc!.src).toContain("ChecklistsRepo");
    });

    it("finds the write paths it is meant to be checking", () => {
        // If a refactor renamed the repo mutators, `violations` would return []
        // for the happiest of reasons and the guard would be dead. Count the
        // methods the rule MATCHED, not the ones it complained about.
        const matched = loaded.flatMap(({ file, src }) =>
            methodChunks(src)
                .filter((c) =>
                    changesTheCount(c.body, src.includes("ChecklistsRepo")),
                )
                .map((c) => `${file}#${c.name}`),
        );
        expect(matched).toEqual(
            expect.arrayContaining([
                "services/ChecklistsService.ts#addItem",
                "services/ChecklistsService.ts#bulkAddItems",
                "services/ChecklistsService.ts#toggleItem",
                "services/ChecklistsService.ts#deleteItem",
                "services/ChecklistsService.ts#deleteChecklist",
                "services/TemplateApplyService.ts#apply",
            ]),
        );
    });

    it("no method changes the item count without recomputing the rollup", () => {
        expect(violations(loaded)).toEqual([]);
    });

    it("the rule FIRES — the P12 defect, reconstructed", () => {
        // A guard nobody has seen fail is a guard nobody has. This is
        // `TemplateApplyService.apply` as it was before P12, reduced to the
        // two lines that mattered.
        const brokenSrc = [
            "class X {",
            "    async apply(input: I) {",
            "        await tx.insert(checklists).values({ id, taskId });",
            "        await tx.insert(checklistItems).values(itemRows);",
            "    }",
            "}",
        ].join("\n");
        expect(
            violations([
                { file: "fake/TemplateApplyService.ts", src: brokenSrc },
            ]),
        ).toEqual([{ file: "fake/TemplateApplyService.ts", method: "apply" }]);

        // …and the same code with the fix applied is clean, so the rule is
        // discriminating rather than merely noisy.
        const fixedSrc = brokenSrc.replace(
            "    }\n}",
            `        await this.tasks.${RECOMPUTE}(taskId, tx);\n    }\n}`,
        );
        expect(
            violations([
                { file: "fake/TemplateApplyService.ts", src: fixedSrc },
            ]),
        ).toEqual([]);
    });

    it("ChecklistsService.updateItem is count-NEUTRAL, and stays that way", () => {
        // The reason it is absent from COUNT_CHANGING. It patches text /
        // assignee / position only; the day it learns to set completion it
        // becomes a count-changing path, and this says so before the rollup
        // silently goes stale.
        const src = fs.readFileSync(
            path.join(SRC, "services", "ChecklistsService.ts"),
            "utf8",
        );
        const chunk = methodChunks(src).find((c) => c.name === "updateItem");
        expect(chunk).toBeDefined();
        expect(chunk!.body).not.toMatch(/isCompleted|is_completed/);
        expect(chunk!.body).not.toContain("setItemCompletion");
    });
});
