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
        tail: out.split("\n").filter((l) => /●|✕|Cannot|ERR|error/i.test(l)).slice(0, 12),
    };
};

const results = [];
const t0 = Date.now();

if (!clientOnly) {
    console.log(`\n running ${configs.length} server module(s)\n`);
    for (const cfg of configs) {
        const label = nameOf(cfg);
        process.stdout.write(`  ${label.padEnd(20)} … `);
        let r = runJest(cfg);
        let flaky = false;
        if (!r.ok && allowRetry) {
            process.stdout.write("retry … ");
            const again = runJest(cfg);
            if (again.ok) {
                flaky = true;
                r = again;
            } else {
                r = again;
            }
        }
        results.push({ kind: "server", label, flaky, ...r });
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
