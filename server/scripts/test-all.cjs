#!/usr/bin/env node
/* eslint-disable no-undef, no-console */
/**
 * ONE honest green-run for the whole system.  (Phase 0 of SYSTEM_TEST_PLAN.)
 *
 * Why this exists
 * ---------------
 * `npm test` runs the ROOT jest config with `--all`, which puts every suite on
 * one shared database and reports FALSE failures from cross-suite collisions.
 * The truth has always lived in the per-module configs — each on its own private
 * DB — but running 34 of them by hand is not a gate anybody performs, so in
 * practice every release rested on memory.
 *
 * The cost of that was measured: the three Lists READ suites were claimed by no
 * config but the root one, so nothing ran them for seventeen days while four
 * asserts sat red, encoding a pagination contract F23 had already replaced.
 *
 * So: this script runs EVERY module config sequentially, then the client suite,
 * and prints one verdict. Nothing is excluded — including the duplicate runners
 * (`tagscheck`, `tagsreview`) and the deliberate second pass over tasks
 * (`tasks10`, a different private DB, which is how DB-state-dependent flakes get
 * caught). A config left out of this list is a config that can rot.
 *
 * Retries
 * -------
 * One retry per module, matching the scan methodology. Three modules (health,
 * tags, taskTypes) have a documented cold-start failure — the first test in a
 * file pays for the ts-jest transform, the first bcrypt hash and the first pool
 * connect, and can exceed the timeout on a cold or busy machine. A module that
 * fails then passes is reported as FLAKY-PASS: counted green, but named, because
 * a flake that nobody names becomes a flake nobody investigates.
 *
 * Usage
 * -----
 *   node scripts/test-all.cjs                 # everything (server + client)
 *   node scripts/test-all.cjs --only tasks    # substring filter on config names
 *   node scripts/test-all.cjs --only tasks,rbac
 *   node scripts/test-all.cjs --server-only
 *   node scripts/test-all.cjs --no-retry
 *   node scripts/test-all.cjs --no-static     # skip lint + type-check
 *
 * Exit code is 1 if ANY module is red — do not pipe this into something that
 * swallows it.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SERVER = path.resolve(__dirname, "..");
const CLIENT = path.resolve(SERVER, "..", "client");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valueOf = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? null : args[i + 1];
};

const only = (valueOf("--only") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const allowRetry = !flag("--no-retry");
const serverOnly = flag("--server-only");
const skipStatic = flag("--no-static") || only.length > 0;
const clientOnly = flag("--client-only");
/**
 * Playwright is OPT-IN, not part of the default gate.
 *
 * Two reasons, both learned the hard way. It writes to the DEV database, so a
 * run leaves fixtures behind that the next person mistakes for real data; and
 * dev mail is a LIVE Mailtrap host, so a spec that assigns or mentions a
 * @beautybooth.com.bd account sends a real email to real staff. The unit gate
 * has neither hazard, and it is the one people should be able to run without
 * thinking. `--e2e` says "I know what this touches".
 */
const withE2E = flag("--e2e");

// ── which configs ───────────────────────────────────────────────────────────
// Everything matching jest.<name>.<c>js EXCEPT the root config, which is the
// one that lies.
const configs = fs
    .readdirSync(SERVER)
    .filter((f) => /^jest\..+\.c?js$/.test(f) && f !== "jest.config.js")
    .sort()
    .filter((f) => only.length === 0 || only.some((o) => f.includes(o)));

const nameOf = (cfg) => cfg.replace(/^jest\./, "").replace(/\.c?js$/, "").replace(/\.config$/, "");

// ── running one module ──────────────────────────────────────────────────────
const COUNTS = /Tests:\s+(?:(\d+) failed,\s+)?(?:(\d+) skipped,\s+)?(?:(\d+) todo,\s+)?(\d+) passed,\s+(\d+) total/;
const SUITES = /Test Suites:\s+(?:(\d+) failed,\s+)?(?:\d+ skipped,\s+)?(\d+) passed,\s+(\d+) total/;

/**
 * Run a binary through Node directly rather than through npx.
 *
 * Node 20+ on Windows refuses to spawn a `.cmd` without `shell: true` (EINVAL),
 * and a bare `npx` is ENOENT there — so the obvious `spawnSync("npx", …)` fails
 * instantly on this machine and every module reports "no summary". Calling the
 * package's own JS entrypoint with `process.execPath` sidesteps the shell
 * entirely and behaves the same on every platform.
 */
const runNode = (entry, argv, cwd) =>
    spawnSync(process.execPath, [entry, ...argv], {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });

const JEST_BIN = path.join(SERVER, "node_modules", "jest", "bin", "jest.js");
const VITEST_BIN = path.join(CLIENT, "node_modules", "vitest", "vitest.mjs");

// A line-by-line filter cannot say WHY a module failed: /error/i matches every
// test merely NAMED "…error envelope…", so the capture filled with green lines
// and pushed out the assertion diff — the one part worth keeping. Jest already
// prints a contiguous failure report; take that verbatim instead.
const failureReport = (out) => {
    const lines = out.split("\n");
    const start = lines.findIndex(
        (l) => l.includes("●") && !/●\s*Console/.test(l),
    );
    if (start === -1) {
        // No bullet at all: the run died before jest could report (a config
        // error, an OOM, a killed worker). Those messages ARE the evidence.
        return lines
            .filter((l) => /Cannot|ERR_|FATAL|heap|not found/i.test(l))
            .slice(0, 12);
    }
    // Jest prints the report, then resumes listing suites. Cut at that seam so
    // the evidence is the failure and nothing else, and strip the colour codes
    // — they are unreadable once the line is re-printed inside this summary.
    const report = [];
    for (const raw of lines.slice(start, start + 40)) {
        // ANSI colour codes ARE control characters; stripping them is the point.
        // eslint-disable-next-line no-control-regex
        const l = raw.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
        if (report.length && /^\s*(PASS|FAIL|Test Suites:|Tests:)\b/.test(l)) break;
        if (l.trim() !== "") report.push(l);
        if (report.length >= 22) break;
    }
    return report;
};

const runJest = (cfg) => {
    // jest writes its summary to stderr; capture both and merge.
    const r = runNode(JEST_BIN, ["-c", cfg, "--runInBand", "--silent"], SERVER);
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    const m = COUNTS.exec(out);
    const s = SUITES.exec(out);
    return {
        ok: r.status === 0,
        failed: m ? Number(m[1] || 0) : null,
        skipped: m ? Number(m[2] || 0) : null,
        passed: m ? Number(m[4] || 0) : null,
        total: m ? Number(m[5] || 0) : null,
        suites: s ? Number(s[3] || 0) : null,
        suitesFailed: s ? Number(s[1] || 0) : null,
        // Keep the tail so a red module explains itself without a re-run.
        tail: failureReport(out),
    };
};

const results = [];
const t0 = Date.now();

// ── static checks ───────────────────────────────────────────────────────────
/**
 * Lint and type-check BOTH packages before a single test runs.
 *
 * These were always meant to be part of the gate and were left to whoever
 * remembered to type them, which turns out to be the same failure the runner
 * itself exists to prevent. Twice now a check that nobody ran has been found
 * to be silently answering the wrong question:
 *
 *   - P1: `.eslintignore` excluded 321 files — the whole of `tests/`, every
 *     operator script — so `eslint .` reported 0 while 72 real violations sat
 *     behind the ignore list.
 *   - P2: the client's `tsc --noEmit` is a NO-OP. Its root tsconfig is a
 *     solution file (`"files": []` + references), and without `-b` there is
 *     nothing to compile, so it exits 0 with a deliberate type error present.
 *     Every 'client tsc clean' in this plan's records was vacuous.
 *
 * A check that is not in the gate is a check that can rot, exactly like a
 * config left out of the module list.
 *
 * They run FIRST and stop the run on failure. A tree that does not compile
 * makes the test results meaningless, and 108 minutes is far too long to
 * spend before finding that out. `--no-static` skips them; so does `--only`,
 * because that flag means 'I am iterating on one module'.
 */
const bin = (pkg, ...rest) => path.join(pkg, "node_modules", ...rest);
const STATIC_CHECKS = [
    {
        // `--max-warnings 0` on both packages: eslint exits 0 on a
        // warnings-only run, and "0 / 0" has been this plan's standard since
        // P1 — a warning nothing blocks on is a warning that accumulates.
        label: "eslint (server)",
        cwd: SERVER,
        entry: bin(SERVER, "eslint", "bin", "eslint.js"),
        argv: [".", "--max-warnings", "0"],
    },
    {
        // `-p tsconfig.tests.json` — the base config excludes `tests/`, so the
        // plain invocation says nothing about the 313 files in there.
        label: "tsc (server)",
        cwd: SERVER,
        entry: bin(SERVER, "typescript", "bin", "tsc"),
        argv: ["--noEmit", "-p", "tsconfig.tests.json"],
    },
    {
        label: "eslint (client)",
        cwd: CLIENT,
        entry: bin(CLIENT, "eslint", "bin", "eslint.js"),
        argv: [".", "--max-warnings", "0"],
    },
    {
        // `-b` is load-bearing, not decoration. See the note above.
        label: "tsc (client)",
        cwd: CLIENT,
        entry: bin(CLIENT, "typescript", "bin", "tsc"),
        argv: ["-b", "--noEmit"],
    },
];

if (!skipStatic) {
    console.log(`\n static checks\n`);
    const failedChecks = [];
    for (const check of STATIC_CHECKS) {
        process.stdout.write(`  ${check.label.padEnd(20)} … `);
        const r = runNode(check.entry, check.argv, check.cwd);
        const ok = r.status === 0;
        console.log(ok ? "pass" : "FAIL");
        if (!ok) {
            failedChecks.push({
                label: check.label,
                tail: `${r.stdout || ""}\n${r.stderr || ""}`
                    .split("\n")
                    .filter((l) => l.trim())
                    .slice(-15),
            });
        }
    }
    if (failedChecks.length) {
        for (const f of failedChecks) {
            console.log(`\n  ── ${f.label} ${"─".repeat(Math.max(0, 46 - f.label.length))}`);
            for (const line of f.tail) console.log("     " + line);
        }
        console.log("\n  NOT GREEN — static checks failed; no tests were run.\n");
        process.exit(1);
    }
}

if (!clientOnly) {
    console.log(`\n running ${configs.length} server module(s)\n`);
    for (const cfg of configs) {
        const label = nameOf(cfg);
        process.stdout.write(`  ${label.padEnd(20)} … `);
        let r = runJest(cfg);
        let flaky = false;
        // Keep WHY the first attempt failed. Naming a flaky module without its
        // reason is only half of "a flake nobody names is a flake nobody
        // investigates" — the retry's output is green by definition, so
        // discarding the first attempt threw away the only evidence there was.
        let firstFailure = null;
        if (!r.ok && allowRetry) {
            firstFailure = r.tail;
            process.stdout.write("retry … ");
            const again = runJest(cfg);
            flaky = again.ok;
            r = again;
        }
        results.push({ kind: "server", label, flaky, firstFailure, ...r });
        const counts = r.total === null ? "no summary" : `${r.passed}/${r.total}`;
        console.log(
            r.ok ? `${flaky ? "FLAKY-PASS" : "pass"}  ${counts}` : `FAIL  ${counts}`,
        );
    }
}

if (!serverOnly) {
    process.stdout.write(`\n  ${"client (vitest)".padEnd(20)} … `);
    const r = runNode(VITEST_BIN, ["run"], CLIENT);
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    // vitest prints "Tests  49 passed (49)" — but on a RED run the failures come
    // first ("Tests  2 failed | 47 passed (49)"), so each number is matched on
    // its own rather than assuming an order.
    const grab = (re) => {
        const m = re.exec(out);
        return m ? Number(m[1]) : null;
    };
    const passed = grab(/Tests\s+[^\n]*?(\d+) passed/);
    const total = grab(/Tests\s+[^\n]*?\((\d+)\)/);
    const clientFailed = grab(/Tests\s+(\d+) failed/) || 0;
    results.push({
        kind: "client",
        label: "client",
        ok: r.status === 0,
        passed,
        total,
        failed: clientFailed,
        flaky: false,
        tail: out.split("\n").filter((l) => /FAIL|✕|Error/i.test(l)).slice(0, 12),
    });
    console.log(r.status === 0 ? `pass  ${passed}/${total}` : `FAIL  ${passed}/${total}`);
}

if (withE2E) {
    const PW_BIN = path.join(
        CLIENT,
        "node_modules",
        "@playwright",
        "test",
        "cli.js",
    );
    for (const project of [
        "chromium",
        "desktop-guard",
        "mobile-390",
        "mobile-360",
    ]) {
        process.stdout.write(`\n  ${`e2e:${project}`.padEnd(20)} … `);
        const r = runNode(PW_BIN, ["test", `--project=${project}`], CLIENT);
        const out = `${r.stdout || ""}\n${r.stderr || ""}`;
        const grab = (re) => {
            const m = re.exec(out);
            return m ? Number(m[1]) : null;
        };
        const passed = grab(/(\d+) passed/) || 0;
        const failed = grab(/(\d+) failed/) || 0;
        results.push({
            kind: "e2e",
            label: `e2e:${project}`,
            ok: r.status === 0,
            passed,
            failed,
            total: passed + failed,
            flaky: false,
            tail: out
                .split("\n")
                .filter((l) => /✘|Error|expect\(/.test(l))
                .slice(0, 12),
        });
        console.log(
            (r.status === 0 ? "pass  " : "FAIL  ") + `${passed}/${passed + failed}`,
        );
    }
    // The mobile net rewrites its measurement file on every run; that churn is a
    // record of one machine on one day, not a result. Leave the tree clean.
    spawnSync("git", ["checkout", "--", "client/mobile-baseline.json"], {
        cwd: path.resolve(SERVER, ".."),
        encoding: "utf8",
    });
}

// ── verdict ─────────────────────────────────────────────────────────────────
const red = results.filter((r) => !r.ok);
const flakies = results.filter((r) => r.flaky);
const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
const mins = ((Date.now() - t0) / 60000).toFixed(1);

console.log("\n" + "─".repeat(64));
console.log(
    `  ${results.length} module(s) · ${sum("passed")} passed · ${sum("failed")} failed · ${mins} min`,
);
if (flakies.length) {
    console.log(
        `  FLAKY-PASS (green only on retry): ${flakies.map((f) => f.label).join(", ")}`,
    );
    for (const f of flakies) {
        if (!f.firstFailure?.length) continue;
        console.log(
            `\n  ── ${f.label}: what the FIRST attempt said ${"─".repeat(Math.max(0, 24 - f.label.length))}`,
        );
        for (const line of f.firstFailure) console.log("     " + line.trim());
    }
}
if (red.length) {
    console.log(`\n  RED: ${red.map((r) => r.label).join(", ")}\n`);
    for (const r of red) {
        console.log(`  ── ${r.label} ${"─".repeat(Math.max(0, 50 - r.label.length))}`);
        for (const line of r.tail) console.log("     " + line.trim());
    }
    console.log("\n  NOT GREEN.");
    process.exit(1);
}
console.log("  ALL GREEN.");
console.log("─".repeat(64) + "\n");
