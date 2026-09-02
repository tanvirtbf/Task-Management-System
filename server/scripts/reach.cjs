/* eslint-disable no-undef, no-console */
/**
 * Which of a phase's endpoints does the test suite actually CALL?
 *
 *   npm run reach          # defaults to P3
 *   npm run reach -- P5
 *
 * Extracts every URL passed to a supertest verb across tests/, resolves the
 * constants those URLs are built from, and matches the result against the live
 * route table (from `scripts/endpoints.cjs`, the same source Appendix A is
 * generated from). Coarse greps could not answer this — "workspace" appears in
 * 114 files — but a URL that no test ever constructs is a genuinely untested
 * endpoint.
 *
 * Run this FIRST in a phase: it turns "what is untested?" from a guess into a
 * list.
 *
 * It is a diagnostic, so distrust it before you distrust the suite. It has been
 * wrong twice, both times reporting a tested endpoint as untested:
 *
 *   1. It did not strip the query string, so `${QUEUE}?box=pending` looked like
 *      a different route from `${QUEUE}`.
 *   2. It resolved constants in ONE FLAT NAMESPACE shared by every test file.
 *      `BASE` is declared in three files and `PATH` in forty; last writer won,
 *      so `${BASE}/${id}/snooze` in the notifications suite resolved against
 *      workspace-activity's `BASE` and produced an activity URL for a
 *      notifications route, which matches nothing. Three endpoints were called
 *      untested while their own test files — named after them — sat right
 *      there. Constants are now resolved PER FILE, following relative imports.
 *
 * Both bugs had the same shape: a wrong answer that looked like a finding. So
 * the run ends with a self-check — for every endpoint reported as untested, the
 * suite is grepped for the route's own distinctive segment, and a hit is called
 * out as SUSPECT rather than reported as a gap.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SERVER = path.resolve(__dirname, "..");
const TESTS = path.join(SERVER, "tests");
const phase = process.argv[2] || "P3";

const endpoints = execFileSync(
    process.execPath,
    [path.join(SERVER, "scripts", "endpoints.cjs"), "--phase", phase],
    { encoding: "utf8" },
)
    .split("\n")
    .map((l) => new RegExp("^\\s*\\[ \\] " + phase + "\\s+(\\w+)\\s+(\\S+)").exec(l))
    .filter(Boolean)
    .map((m) => ({ method: m[1], path: m[2] }));

const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".ts")) out.push(p);
    }
    return out;
};

const allFiles = walk(TESTS);
const rel = (f) => path.relative(TESTS, f).replace(/\\/g, "/");

// ── per-file declarations ───────────────────────────────────────────────────
// Values are kept RAW, interpolations and all, because a declaration is very
// often built on another one: `const PATH = ${BASE}/mark-all-read`. Anything
// without a route-ish shape or an interpolation to expand is dropped, so the
// table stays small enough to reason about.
const DECL_PLAIN =
    /(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*[`"']([^`"']*)[`"']/g;
const DECL_ARROW =
    /(?:export\s+)?const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*[`"']([^`"']*)[`"']/g;
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

const looksRoutish = (v) => /\/api\/v1|\/health|\/metrics|\$\{/.test(v);

const declsOf = new Map(); // file -> { name: rawValue }
const importsOf = new Map(); // file -> { name: sourceFile }
const srcOf = new Map(); // file -> source text

for (const file of allFiles) {
    const src = fs.readFileSync(file, "utf8");
    srcOf.set(file, src);

    const decls = {};
    for (const re of [DECL_PLAIN, DECL_ARROW]) {
        for (const m of src.matchAll(re)) {
            if (looksRoutish(m[2])) decls[m[1]] = m[2];
        }
    }
    declsOf.set(file, decls);

    const imports = {};
    for (const m of src.matchAll(IMPORT)) {
        if (!m[2].startsWith(".")) continue; // package import: not our source
        const target = path.resolve(path.dirname(file), m[2]);
        const resolved = [target + ".ts", path.join(target, "index.ts")].find(
            (c) => fs.existsSync(c),
        );
        if (!resolved) continue;
        for (const raw of m[1].split(",")) {
            const name = raw.trim().split(/\s+as\s+/).pop().trim();
            if (name) imports[name] = resolved;
        }
    }
    importsOf.set(file, imports);
}

/**
 * Resolve a name in ONE file's scope: its own declarations first, then whatever
 * it imported. `seen` guards against a cycle between two helper modules.
 */
const resolveName = (file, name, seen = new Set()) => {
    const key = file + "::" + name;
    if (seen.has(key)) return null;
    seen.add(key);

    const own = declsOf.get(file)?.[name];
    if (own !== undefined) return expand(file, own, seen);

    const from = importsOf.get(file)?.[name];
    return from ? resolveName(from, name, seen) : null;
};

/**
 * Substitute the interpolations a template is built from. A name that resolves
 * to nothing is a runtime value (`${id}`, `${task.id}`) and is left alone —
 * `normalise` turns it into the wildcard segment it is.
 */
const expand = (file, raw, seen) =>
    raw.replace(/\$\{(\w+)\}/g, (whole, name) => {
        const v = resolveName(file, name, seen);
        return v === null ? whole : v;
    });

// `${QUEUE}?box=pending` addresses the same ROUTE as `${QUEUE}`; not stripping
// the query string once reported a tested endpoint as untested.
const normalise = (url) =>
    url
        .replace(/\$\{[^}]*\}/g, "*")
        .split("?")[0]
        .replace(/\/+$/, "")
        .trim();

// ── call sites ──────────────────────────────────────────────────────────────
const VERB = "(?:get|post|patch|put|delete)";
const CALL_TEMPLATE = new RegExp("\\." + VERB + "\\(\\s*`([^`]*)`", "g");
const CALL_QUOTED = new RegExp("\\." + VERB + "\\(\\s*\"([^\"]*)\"", "g");
const CALL_IDENT = new RegExp("\\." + VERB + "\\(\\s*(\\w+)\\s*[(,)]", "g");

const calls = new Map(); // normalised url -> Set(test file)

for (const file of allFiles) {
    const src = srcOf.get(file);
    const name = rel(file);

    const record = (raw) => {
        if (raw === null) return;
        const url = normalise(raw);
        if (!/^\/(api\/v1|health|metrics)/.test(url)) return;
        if (!calls.has(url)) calls.set(url, new Set());
        calls.get(url).add(name);
    };

    for (const m of src.matchAll(CALL_TEMPLATE)) record(expand(file, m[1], new Set()));
    for (const m of src.matchAll(CALL_QUOTED)) record(m[1]);
    for (const m of src.matchAll(CALL_IDENT)) record(resolveName(file, m[1]));
}

/** Does a called URL match this route (params are wildcards on both sides)? */
const matches = (route, called) => {
    const r = route.split("/").filter(Boolean);
    const c = called.split("/").filter(Boolean);
    if (r.length !== c.length) return false;
    return r.every((seg, i) => seg.startsWith(":") || c[i] === "*" || c[i] === seg);
};

const lines = [];
for (const ep of endpoints) {
    const hits = new Set();
    for (const [url, files] of calls) {
        if (matches(ep.path, url)) for (const f of files) hits.add(f);
    }
    lines.push({ ep, hits: [...hits] });
}

const untested = lines.filter((l) => l.hits.length === 0);

console.log(
    `${phase}: ${endpoints.length} endpoints · ${endpoints.length - untested.length} called by tests · ${untested.length} NEVER called\n`,
);
for (const { ep, hits } of lines) {
    const mark = hits.length === 0 ? "  ⛔" : "  ok";
    const where =
        hits.length === 0
            ? "— NO TEST CALLS THIS —"
            : `${hits.length} file(s): ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? " …" : ""}`;
    console.log(
        `${mark} ${ep.method.padEnd(6)} ${ep.path.replace("/api/v1", "").padEnd(40)} ${where}`,
    );
}

// ── self-check ──────────────────────────────────────────────────────────────
// Twice now this script has reported a tested endpoint as untested, and both
// times the test file was named after the endpoint. So before a gap is
// believed, look for the route's own distinctive segment in the suite.
const suspects = [];
for (const { ep } of untested) {
    const segs = ep.path.split("/").filter((s) => s && !s.startsWith(":"));
    const leaf = segs[segs.length - 1];
    if (!leaf || leaf === "v1" || leaf === "api") continue;
    const where = allFiles.filter((f) => srcOf.get(f).includes(leaf)).map(rel);
    if (where.length) suspects.push({ ep, leaf, where });
}
if (suspects.length) {
    console.log(
        `\n  ⚠ SELF-CHECK — ${suspects.length} of the ${untested.length} gap(s) mention the route's own name somewhere in tests/.`,
    );
    console.log("  Read these before believing the gap:");
    for (const s of suspects) {
        console.log(
            `     ${s.ep.method} ${s.ep.path.replace("/api/v1", "")} — "${s.leaf}" appears in ${s.where.length} file(s): ${s.where.slice(0, 3).join(", ")}`,
        );
    }
} else if (untested.length) {
    console.log(
        `\n  self-check: none of the ${untested.length} gap(s) is named anywhere in tests/ — they look real.`,
    );
}
