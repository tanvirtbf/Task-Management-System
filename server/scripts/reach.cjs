/* eslint-disable no-undef, no-console */
/**
 * Which of a phase's endpoints does the test suite actually CALL?
 *
 *   npm run reach          # defaults to P3
 *   npm run reach -- P5
 *
 * Extracts every URL passed to a supertest verb across tests/, resolving the
 * file's own `const X = "/api/v1/…"` declarations and collapsing `${…}` to a
 * parameter marker, then matches those against the live route table (from
 * `scripts/endpoints.cjs`, the same source Appendix A is generated from).
 * Coarse greps could not answer this — "workspace" appears in 114 files — but
 * a URL that no test ever constructs is a genuinely untested endpoint.
 *
 * Run this FIRST in a phase: it turns "what is untested?" from a guess into a
 * list. It is also a diagnostic, so distrust it before you distrust the suite —
 * it once reported `GET /delete-requests` as untested because it was not
 * stripping the query string off `${QUEUE}?box=pending`.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SERVER = path.resolve(__dirname, "..");
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

// Collapse a template's interpolations to a wildcard segment, and drop the
// query string — `${QUEUE}?box=pending` addresses the same ROUTE as `${QUEUE}`,
// and not stripping it reported a tested endpoint as untested.
const normalise = (url) =>
    url
        .replace(/\$\{[^}]*\}/g, "*")
        .split("?")[0]
        .replace(/\/+$/, "")
        .trim();

const calls = new Map(); // "METHOD /path/*/x" -> Set(files)

// Constants are frequently exported from a module's `helpers.ts` and imported
// by its test files, so the table has to be global rather than per file.
const globalConsts = {};
const allFiles = walk(path.join(SERVER, "tests"));
for (const file of allFiles) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(
        /(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*[`"]([^`"]*\/api\/v1[^`"]*)[`"]/g,
    )) {
        globalConsts[m[1]] = m[2];
    }
    for (const m of src.matchAll(
        /(?:export\s+)?const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*[`"]([^`"]*\/api\/v1[^`"]*)[`"]/g,
    )) {
        globalConsts[m[1]] = m[2];
    }
}
// A second pass for helpers built ON another constant —
// `const applyUrl = (id) => `${TEMPLATES}/${id}/apply`` — whose own body never
// contains the literal "/api/v1" and so is invisible to the pass above.
for (const file of allFiles) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(
        /(?:export\s+)?const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*`\$\{(\w+)\}([^`]*)`/g,
    )) {
        if (globalConsts[m[2]] && !globalConsts[m[1]]) {
            globalConsts[m[1]] = globalConsts[m[2]] + m[3];
        }
    }
}

for (const file of allFiles) {
    const src = fs.readFileSync(file, "utf8");
    const name = path.relative(path.join(SERVER, "tests"), file).replace(/\\/g, "/");

    // Same-file declarations win over the global table.
    const consts = { ...globalConsts };
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*[`"]([^`"]*\/api\/v1[^`"]*)[`"]/g)) {
        consts[m[1]] = m[2];
    }
    // Arrow helpers, with or without a return-type annotation:
    //   const url = (id) => `/api/v1/tags/${id}`
    //   const url = (id: string): string => `/api/v1/tags/${id}`
    for (const m of src.matchAll(
        /const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*[`"]([^`"]*\/api\/v1[^`"]*)[`"]/g,
    )) {
        consts[m[1]] = m[2];
    }

    const record = (raw) => {
        const url = normalise(raw);
        if (!url.startsWith("/api/v1") && !url.startsWith("/health") && !url.startsWith("/metrics")) return;
        const key = url;
        if (!calls.has(key)) calls.set(key, new Set());
        calls.get(key).add(name);
    };

    // Literal / template URLs
    for (const m of src.matchAll(
        /\.(get|post|patch|put|delete)\(\s*[`"]([^`"]+)[`"]/g,
    )) {
        record(m[2]);
    }
    // Constant references, and constants combined with a suffix
    for (const m of src.matchAll(
        /\.(get|post|patch|put|delete)\(\s*(\w+)\s*[,)]/g,
    )) {
        if (consts[m[2]]) record(consts[m[2]]);
    }
    for (const m of src.matchAll(
        /\.(get|post|patch|put|delete)\(\s*`\$\{(\w+)\}([^`]*)`/g,
    )) {
        if (consts[m[2]]) record(consts[m[2]] + m[3]);
    }
    for (const m of src.matchAll(
        /\.(get|post|patch|put|delete)\(\s*(\w+)\(/g,
    )) {
        if (consts[m[2]]) record(consts[m[2]]);
    }
}

/** Does a called URL match this route (params are wildcards on both sides)? */
const matches = (route, called) => {
    const r = route.split("/").filter(Boolean);
    const c = called.split("/").filter(Boolean);
    if (r.length !== c.length) return false;
    return r.every((seg, i) => seg.startsWith(":") || c[i] === "*" || c[i] === seg);
};

let untested = 0;
const lines = [];
for (const ep of endpoints) {
    const hits = new Set();
    for (const [url, files] of calls) {
        if (matches(ep.path, url)) for (const f of files) hits.add(f);
    }
    if (hits.size === 0) untested++;
    lines.push({ ep, hits: [...hits] });
}

console.log(
    `${phase}: ${endpoints.length} endpoints · ${endpoints.length - untested} called by tests · ${untested} NEVER called\n`,
);
for (const { ep, hits } of lines) {
    const mark = hits.length === 0 ? "  ⛔" : "  ok";
    const where = hits.length === 0 ? "— NO TEST CALLS THIS —" : `${hits.length} file(s): ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? " …" : ""}`;
    console.log(`${mark} ${ep.method.padEnd(6)} ${ep.path.replace("/api/v1", "").padEnd(40)} ${where}`);
}
