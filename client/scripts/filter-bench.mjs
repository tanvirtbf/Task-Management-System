/**
 * KI-24 — what client-side task filtering actually costs.
 *
 * §P13 task 1: "Cost grows linearly with the list. Measure at 500, 2,000 and
 * 5,000 tasks. Fix or GATE with the number attached."
 *
 *   node scripts/filter-bench.mjs
 *
 * It benchmarks the REAL `taskFilters.ts` — compiled with the esbuild the
 * client already depends on, not a paraphrase of it — so the number cannot
 * drift away from the shipped code. Deterministic fixture and a median of
 * repeated passes, because a single timing on a laptop under Chrome is noise.
 *
 * The scenarios are chosen to separate the costs that hide inside one number:
 * an `includes()` over a filter array is charged per task, and a due-date
 * comparison additionally allocated a `Date` per task before P13.
 */

import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "components", "views", "taskFilters.ts");

const out = path.join(os.tmpdir(), `taskfilters-bench-${process.pid}.mjs`);
await build({
    entryPoints: [SRC],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
});
const { applyTaskFilters, EMPTY_TASK_FILTERS, UNASSIGNED } = await import(
    pathToFileURL(out).href
);

// ── fixture ─────────────────────────────────────────────────────────────────
let seed = 20260907;
const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
};

const STATUSES = Array.from({ length: 8 }, (_, i) => `st_${i}`);
const USERS = Array.from({ length: 15 }, (_, i) => `usr_${i}`);

const day = (n) =>
    new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const makeTasks = (n) => {
    seed = 20260907;
    return Array.from({ length: n }, (_, i) => ({
        id: `t_${i}`,
        statusId: STATUSES[Math.floor(rnd() * STATUSES.length)],
        assignees:
            rnd() < 0.2
                ? []
                : [USERS[Math.floor(rnd() * USERS.length)]].concat(
                      rnd() < 0.25
                          ? [USERS[Math.floor(rnd() * USERS.length)]]
                          : [],
                  ),
        priority: Math.floor(rnd() * 5),
        // Two thirds carry a due date — the branch that allocated a Date.
        dueDate: rnd() < 0.66 ? day(Math.floor(rnd() * 120) - 60) : null,
    }));
};

const SCENARIOS = {
    none: { ...EMPTY_TASK_FILTERS },
    status: { ...EMPTY_TASK_FILTERS, statusIds: STATUSES.slice(0, 3) },
    assignee: {
        ...EMPTY_TASK_FILTERS,
        assigneeIds: [USERS[1], USERS[4], USERS[9], UNASSIGNED],
    },
    date: { ...EMPTY_TASK_FILTERS, dueFrom: day(-14), dueTo: day(14) },
    all: {
        ...EMPTY_TASK_FILTERS,
        statusIds: STATUSES.slice(0, 3),
        assigneeIds: [USERS[1], USERS[4], USERS[9]],
        priorities: [1, 2, 3],
        dueFrom: day(-14),
        dueTo: day(14),
    },
};

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
};

const timeOne = (tasks, filters, passes = 60) => {
    // Warm-up so the JIT has compiled the predicate before anything is timed.
    for (let i = 0; i < 10; i++) applyTaskFilters(tasks, filters);
    const runs = [];
    for (let i = 0; i < passes; i++) {
        const t0 = performance.now();
        const kept = applyTaskFilters(tasks, filters);
        runs.push(performance.now() - t0);
        if (kept.length < 0) throw new Error("unreachable");
    }
    return median(runs);
};

const SIZES = [500, 2000, 5000];
const names = Object.keys(SCENARIOS);

console.log(`\nKI-24 — applyTaskFilters, median of 60 passes (ms)\n`);
console.log(
    `  tasks  ` + names.map((n) => n.padStart(9)).join("") + "     kept(all)",
);
const table = {};
for (const n of SIZES) {
    const tasks = makeTasks(n);
    const cells = names.map((name) => {
        const ms = timeOne(tasks, SCENARIOS[name]);
        table[`${n}/${name}`] = ms;
        return ms.toFixed(3).padStart(9);
    });
    const kept = applyTaskFilters(tasks, SCENARIOS.all).length;
    console.log(`  ${String(n).padStart(5)}  ` + cells.join("") + `  ${String(kept).padStart(11)}`);
}

// Linearity: cost per task should be flat across sizes. A rising per-task cost
// would mean the pass is worse than linear, which is the thing KI-24 feared.
console.log(`\n  per-task cost (µs), scenario "all":`);
for (const n of SIZES) {
    console.log(
        `    ${String(n).padStart(5)} tasks → ${((table[`${n}/all`] * 1000) / n).toFixed(4)} µs/task`,
    );
}
console.log();

fs.unlinkSync(out);

// ── the pass that sits ABOVE the filter in every view ────────────────────────
// ListView and BoardView drop closed tasks before calling applyTaskFilters, and
// did it with `statuses.find(...)` INSIDE the predicate — O(tasks × statuses).
// MobileTaskView already used a Map (the mobile rebuild fixed it there), so the
// two shapes below are both real code from this repo, not a strawman.
const statuses = Array.from({ length: 18 }, (_, i) => ({
    id: `st_${i}`,
    statusGroup: i > 14 ? "closed" : "active",
}));
const statusById = new Map(statuses.map((s) => [s.id, s]));

const viaFind = (tasks) =>
    tasks.filter((t) => statuses.find((x) => x.id === t.statusId)?.statusGroup !== "closed");
const viaMap = (tasks) =>
    tasks.filter((t) => statusById.get(t.statusId)?.statusGroup !== "closed");

const timeFn = (fn, tasks, passes = 60) => {
    for (let i = 0; i < 10; i++) fn(tasks);
    const runs = [];
    for (let i = 0; i < passes; i++) {
        const t0 = performance.now();
        fn(tasks);
        runs.push(performance.now() - t0);
    }
    return median(runs);
};

console.log(`  "show closed" pass — find() vs Map, ${statuses.length} statuses (ms)\n`);
console.log(`  tasks      find()       Map      speedup`);
for (const n of SIZES) {
    const tasks = makeTasks(n).map((t, i) => ({ ...t, statusId: `st_${i % 18}` }));
    const f = timeFn(viaFind, tasks);
    const m = timeFn(viaMap, tasks);
    console.log(
        `  ${String(n).padStart(5)}  ${f.toFixed(3).padStart(9)} ${m.toFixed(3).padStart(9)}` +
            `   ${(f / m).toFixed(1).padStart(6)}×`,
    );
}
console.log();
