// F14 — destructive-command guards and config: the five repros.
//
//   ISS-002  `db:seed:demo` hard-coded `cross-env NODE_ENV=dev`, defeating the
//            very IS_PROD guard meant to stop a production run.
//   ISS-079  `?dry_run=1` silently meant FALSE and RAN the destructive job.
//            (Found the expensive way: a tester typed it and lost a row.)
//   ISS-003  a missing REFRESH_TOKEN_SECRET booted a server that reported
//            READY and failed every login with a 500.
//   ISS-004  COOKIE_SECRET was dead config that looked mandatory.
//   ISS-090  9 vars Config reads were absent from .env / .env.example.
//
// The destructive paths are proven WITHOUT destroying anything: the seed guards
// are exercised by running the real script and asserting it refuses (exit 1,
// row counts unchanged), and `dry_run` is exercised against a job whose
// preview/real split is observable.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const fs = require("fs");
const { spawnSync } = require("node:child_process");
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const SRV = "E:/Task Management System/server";
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 300); } };
const pad = (s, n) => String(s).padEnd(n);
let bad = 0;
const check = (label, ok, detail) => { if (!ok) bad++;
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 60) + (detail || "")); };

const runSeed = (env) => {
    const r = spawnSync("npx", ["tsx", "src/db/seed-demo.ts"], {
        cwd: SRV, encoding: "utf8", shell: true,
        env: { ...process.env, ...env },
    });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const countTasks = async () =>
        (await db.query("SELECT COUNT(*) n FROM tasks"))[0][0].n;

    console.log("\n  === F14 — destructive-command guards and config ===\n");

    console.log("  --- ISS-002: the demo seed's refusals ---");
    const pkg = JSON.parse(fs.readFileSync(SRV + "/package.json", "utf8"));
    check("npm script no longer hard-codes NODE_ENV=dev",
        !pkg.scripts["db:seed:demo"].includes("cross-env"),
        pkg.scripts["db:seed:demo"]);

    const before = await countTasks();
    const g1 = runSeed({ NODE_ENV: "prod", ALLOW_DEMO_SEED: "1" });
    check("guard 1 — NODE_ENV=prod refuses (even with ALLOW_DEMO_SEED=1)",
        g1.code === 1 && /REFUSING/.test(g1.out),
        "exit " + g1.code);
    const g2 = runSeed({ NODE_ENV: "dev", ALLOW_DEMO_SEED: "" });
    check("guard 2 — no ALLOW_DEMO_SEED refuses", g2.code === 1 && /REFUSING/.test(g2.out),
        "exit " + g2.code);

    // guard 3: plant a "stranger" account so the DB looks like a real workspace
    const [[owner]] = await db.query("SELECT * FROM users WHERE email='owner@company.local'");
    await db.query(
        "INSERT INTO users (id, workspace_id, first_name, last_name, email, password_hash, role, status) VALUES ('u-F14-stranger',?,?,?,?,?,'member','active')",
        [owner.workspace_id, "F14", "Stranger", "someone@a-real-company.example", owner.password_hash]);
    const g3 = runSeed({ NODE_ENV: "dev", ALLOW_DEMO_SEED: "1" });
    check("guard 3 — a DB holding non-demo accounts refuses (env-independent)",
        g3.code === 1 && /did not create/.test(g3.out), "exit " + g3.code);
    const after = await countTasks();
    check("…and all three refusals truncated NOTHING", after === before,
        "tasks " + before + " -> " + after);
    await db.query("DELETE FROM users WHERE id='u-F14-stranger'");

    console.log("\n  --- ISS-079: ?dry_run parsing ---");
    const [[form]] = await db.query("SELECT id FROM forms LIMIT 1");
    const jobUrl = (q) => B + "/jobs/session-cleanup" + q;
    const TOKEN = fs.readFileSync(SRV + "/.env", "utf8")
        .split(/\r?\n/).find((l) => l.startsWith("INTERNAL_JOB_TOKEN="))?.slice(19).trim();
    const runJob = async (q) => {
        const r = await fetch(jobUrl(q), { method: "POST",
            headers: { "X-Internal-Token": TOKEN, "Content-Type": "application/json" } });
        return { s: r.status, b: await j(r) };
    };
    console.log("  " + pad("query", 22) + pad("status", 8) + "dry_run reported");
    for (const [q, wantDry] of [["?dry_run=true", true], ["?dry_run=1", true],
                                ["?dry_run=yes", true], ["?dry_run=TRUE", true],
                                ["?dry_run=on", true], ["?dry_run", true],
                                ["?dry_run=false", false], ["?dry_run=0", false],
                                ["", false]]) {
        const r = await runJob(q);
        const got = r.b?.dry_run;
        const ok = r.s === 200 && got === wantDry;
        if (!ok) bad++;
        console.log("  " + pad(q || "(absent)", 22) + pad(r.s, 8) +
            String(got) + (ok ? "" : "   *** want " + wantDry + " ***"));
    }
    console.log("  (?dry_run=1 / yes / TRUE / bare all reported FALSE and RAN the job before F14)");
    const bogus = await runJob("?dry_run=maybe");
    check("an unparseable value is a clean 422, never a silent real run",
        bogus.s === 422 && JSON.stringify(bogus.b).includes("dry_run"),
        "got " + bogus.s + " " + (bogus.b?.error?.details?.[0]?.issue ?? "").slice(0, 46));

    console.log("\n  --- ISS-003: a missing REFRESH_TOKEN_SECRET must NOT boot ---");
    const boot = spawnSync("npx", ["tsx", "src/server.ts"], {
        cwd: SRV, encoding: "utf8", shell: true, timeout: 90_000,
        env: { ...process.env, NODE_ENV: "dev", PORT: "5731", REFRESH_TOKEN_SECRET: "" },
    });
    const bootOut = (boot.stdout ?? "") + (boot.stderr ?? "");
    check("boot refused with a named reason (was: READY, then 500 on every login)",
        boot.status !== 0 && /REFRESH_TOKEN_SECRET is missing/.test(bootOut),
        "exit " + boot.status);
    check("…and it never reported Listening", !/Listening on/.test(bootOut), "");

    console.log("\n  --- ISS-004 / ISS-090: config hygiene ---");
    const env = fs.readFileSync(SRV + "/.env", "utf8");
    const ex = fs.readFileSync(SRV + "/.env.example", "utf8");
    const cfg = fs.readFileSync(SRV + "/src/config/index.ts", "utf8");
    const app = fs.readFileSync(SRV + "/src/app.ts", "utf8");
    check("COOKIE_SECRET gone from config, app, .env and .env.example",
        !cfg.includes("COOKIE_SECRET") && !app.includes("Config.COOKIE_SECRET") &&
        !/^COOKIE_SECRET=/m.test(env) && !/^COOKIE_SECRET=/m.test(ex), "");
    for (const dead of ["SECRET_KEY", "REDIS_URL", "CLOUDFLARE_TOKEN_VALUE"]) {
        check("dead key removed: " + pad(dead, 24),
            !new RegExp("^" + dead + "=", "m").test(env) &&
            !new RegExp("^" + dead + "=", "m").test(ex), "");
    }
    for (const documented of ["SMTP_HOST", "EMAIL_FROM", "OPENAI_MAX_OUTPUT_TOKENS"]) {
        check("now documented in .env.example: " + pad(documented, 24),
            ex.includes(documented), "");
    }
    // every var Config destructures should now be findable in .env.example
    const destructured = [...cfg.matchAll(/^\s{4}([A-Z][A-Z0-9_]+),\s*$/gm)].map((m) => m[1]);
    const missing = destructured.filter((v) => !ex.includes(v));
    check("every var Config reads appears in .env.example",
        missing.length === 0, missing.length ? "missing: " + missing.join(", ") : destructured.length + " vars checked");

    console.log("\n  === CLEANUP ===");
    await db.query("DELETE FROM users WHERE id='u-F14-stranger'").catch(() => {});
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  tasks " + await q("tasks") + " (46) | users " + await q("users") + " (15)");
    console.log(bad === 0
        ? "\n  PASS — the seed refuses three ways, dry_run cannot silently disengage,\n"
          + "  a secretless boot is refused, and the config is honest.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
