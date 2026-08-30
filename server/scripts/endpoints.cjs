#!/usr/bin/env node
/* eslint-disable no-undef, no-console */
/**
 * APPENDIX A — every HTTP endpoint this server actually mounts.
 *
 * Why a script and not a list in a document
 * -----------------------------------------
 * A pasted endpoint list is a second description of the system, and second
 * descriptions rot. This project has been bitten by that twice already (the
 * schema.sql-vs-Drizzle drift KI-12 exists to close), and the endpoint inventory
 * had quietly been wrong for months: every prior scan said 209 because
 * `GET /health` is declared inline on the app rather than in a router, and a
 * router-only count loses it. It is the endpoint uptime monitoring hits.
 *
 * So this reads the truth each time: `app.ts` for the mount table (which router
 * sits under which prefix), then each router file for its own declarations.
 *
 * Usage
 * -----
 *   node scripts/endpoints.cjs                 # grouped by router, with totals
 *   node scripts/endpoints.cjs --phase P3      # one phase's checklist
 *   node scripts/endpoints.cjs --flat          # one line per endpoint, sorted
 *   node scripts/endpoints.cjs --count         # just the number
 *
 * The phase map mirrors FULL_SYSTEM_TEST_PLAN_2026-08-29.md, Appendix A. Two
 * routers are split across phases because the plan splits them:
 *   - `roles`: the read side is P3, the write side P7.
 *   - nothing else.
 */

const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "src");
const METHODS = "get|post|patch|put|delete";

// ── the mount table ─────────────────────────────────────────────────────────
const appSrc = fs
    .readFileSync(path.join(SRC, "app.ts"), "utf8")
    .replace(/\r/g, "");

const importOf = {};
for (const m of appSrc.matchAll(
    /import\s+(\w+)\s+from\s+"\.\/routes\/([\w.]+)"/g,
)) {
    importOf[m[1]] = m[2];
}

const mounts = [];
// v1.use("/prefix", xRouter)
for (const m of appSrc.matchAll(
    /\b(?:v1|app)\.use\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g,
)) {
    if (importOf[m[2]]) {
        mounts.push({ prefix: "/api/v1" + m[1], file: importOf[m[2]] });
    }
}
// A prefix-less mount still sits under whichever app it was added to:
// `v1.use(rolesRouter)` is /api/v1/…, `app.use(healthRouter)` is bare.
for (const m of appSrc.matchAll(/\b(v1|app)\.use\(\s*(\w+Router)\s*\)/g)) {
    if (importOf[m[2]]) {
        mounts.push({
            prefix: m[1] === "v1" ? "/api/v1" : "",
            file: importOf[m[2]],
        });
    }
}

// ── the endpoints ───────────────────────────────────────────────────────────
const groups = [];
for (const { prefix, file } of mounts) {
    const p = path.join(SRC, "routes", file + ".ts");
    if (!fs.existsSync(p)) {
        console.error("missing router file: " + p);
        process.exitCode = 1;
        continue;
    }
    const src = fs.readFileSync(p, "utf8").replace(/\r/g, "");
    const eps = [];
    for (const m of src.matchAll(
        new RegExp("router\\.(" + METHODS + ")\\(\\s*\"([^\"]*)\"", "g"),
    )) {
        const sub = m[2] === "/" ? "" : m[2];
        eps.push({ method: m[1].toUpperCase(), path: prefix + sub || "/" });
    }
    groups.push({ file, prefix: prefix || "(root)", eps });
}

// Routes declared straight on the app. Exactly one today — and the one that
// every previous inventory missed.
const inline = [];
for (const m of appSrc.matchAll(
    new RegExp("\\bapp\\.(" + METHODS + ")\\(\\s*\"([^\"]+)\"", "g"),
)) {
    inline.push({ method: m[1].toUpperCase(), path: m[2] });
}
if (inline.length) {
    groups.push({ file: "app.ts (inline)", prefix: "(root)", eps: inline });
}

// ── the phase map ───────────────────────────────────────────────────────────
const PHASE_OF_ROUTER = {
    auth: "P2",
    users: "P3",
    workspace: "P3",
    teams: "P3",
    spaces: "P3",
    lists: "P3",
    statuses: "P3",
    tags: "P3",
    taskTypes: "P3",
    customFields: "P3",
    templates: "P3",
    tasks: "P4",
    taskDeleteRequests: "P4",
    sla: "P4",
    taskDependencies: "P4",
    comments: "P5",
    checklists: "P5",
    attachments: "P5",
    assignmentRequests: "P5",
    notifications: "P5",
    home: "P6",
    search: "P6",
    sse: "P6",
    workspaceActivity: "P6",
    reports: "P6",
    engineering: "P6",
    sprints: "P6",
    onCall: "P6",
    forms: "P6",
    me: "P7",
    health: "P8",
    "app.ts (inline)": "P8",
    push: "P8",
    assistant: "P9",
    jobs: "P12",
};

/** `roles` is the one router the plan splits: reads in P3, writes in P7. */
const phaseOf = (file, ep) => {
    if (file === "roles") return ep.method === "GET" ? "P3" : "P7";
    return PHASE_OF_ROUTER[file] ?? "?";
};

// ── output ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? null : args[i + 1];
};
const wantPhase = argOf("--phase");
const flat = args.includes("--flat");
const countOnly = args.includes("--count");

const all = [];
for (const g of groups) {
    for (const ep of g.eps) {
        all.push({ ...ep, file: g.file, phase: phaseOf(g.file, ep) });
    }
}

const selected = wantPhase
    ? all.filter((e) => e.phase.toLowerCase() === wantPhase.toLowerCase())
    : all;

if (countOnly) {
    console.log(String(selected.length));
} else if (flat || wantPhase) {
    if (wantPhase) {
        console.log(
            `\n${wantPhase.toUpperCase()} — ${selected.length} endpoint(s)\n`,
        );
    }
    for (const e of selected) {
        console.log(
            `  [ ] ${e.phase.padEnd(4)} ${e.method.padEnd(6)} ${e.path}`,
        );
    }
    console.log("");
} else {
    for (const g of groups.slice().sort((a, b) => a.file.localeCompare(b.file))) {
        const ph = [...new Set(g.eps.map((e) => phaseOf(g.file, e)))].join("+");
        console.log(
            `\n### ${g.file}  (${g.eps.length})  mount: ${g.prefix}  → ${ph}`,
        );
        for (const e of g.eps) {
            console.log(`  ${e.method.padEnd(6)} ${e.path}`);
        }
    }
    const byPhase = {};
    for (const e of all) byPhase[e.phase] = (byPhase[e.phase] || 0) + 1;
    console.log("\nby phase: " + JSON.stringify(byPhase));
    console.log(
        `TOTAL ENDPOINTS: ${all.length}  across ${groups.length} route modules`,
    );
    const unmapped = all.filter((e) => e.phase === "?");
    if (unmapped.length) {
        console.log(
            `\n⚠ ${unmapped.length} endpoint(s) belong to no phase — the plan has a hole:`,
        );
        for (const e of unmapped) console.log(`   ${e.method} ${e.path}`);
        process.exitCode = 1;
    }
}
