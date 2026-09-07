#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * §P13 task 4 — the N+1 sweep, measured per request.
 *
 *   node scripts/nplus1-probe.cjs                 # report
 *   node scripts/nplus1-probe.cjs --assert        # exit 1 on a finding
 *
 * Reading repositories for `await` inside a `for` is how this is usually done,
 * and it misses the ones that hide behind a service and finds ones that are
 * batched two layers down. So this asks the database instead: reset the digest
 * table, issue exactly ONE request, and count the statements that ran.
 *
 * An N+1 has an unmistakable signature — one statement digest executed once per
 * ROW rather than once per request. Batched hydration shows up as a single
 * `... WHERE x IN (...)` no matter how many rows come back, which is why the
 * threshold below is on the repeat count of a single digest and not on the
 * total, and why the payload row count is printed beside it: 40 executions of
 * one digest is fine for a 40-row page only if it is NOT proportional to it.
 *
 * Requires the API running against a seeded database:
 *   node scripts/scale-seed.cjs --tasks=5000 --db=tms_scale_test
 *   DB_NAME_OVERRIDE=tms_scale_test PORT=5599 npx tsx src/server.ts
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const argOf = (n, d) => {
    const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : d;
};
const ASSERT = process.argv.includes("--assert");
const BASE = argOf("base", "http://localhost:5599");
const DB = argOf("db", "tms_scale_test");
const EMAIL = argOf("email", "owner@company.local");
const PASSWORD = argOf("password", "Owner@12345");

/** One digest repeated more than this in a single request is a finding. */
const REPEAT_LIMIT = Number(argOf("limit", "8"));

const USER = process.env.DB_USERNAME || "root";
const PASS = process.env.DB_PASSWORD || "";
const BIN = (() => {
    const g = "C:/Program Files/MySQL/MySQL Server 8.0/bin";
    return fs.existsSync(path.join(g, "mysql.exe")) ? g : "";
})();
const mysql = (sql, db) => {
    const args = [`-u${USER}`, `-p${PASS}`, "-N", "-B", "-e", sql];
    if (db) args.push(db);
    const r = spawnSync(BIN ? path.join(BIN, "mysql.exe") : "mysql", args, {
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error((r.stderr || "").trim());
    return (r.stdout || "").replace(/\r/g, "").trim();
};

(async () => {
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!login.ok) {
        console.error(`login failed: ${login.status}`);
        process.exit(1);
    }
    const { access_token: token } = await login.json();
    const H = { authorization: `Bearer ${token}` };

    const [listId] = mysql(
        `SELECT primary_list_id FROM tasks GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`,
        DB,
    ).split("\t");
    const taskId = mysql(
        `SELECT c.task_id FROM comments c GROUP BY c.task_id ORDER BY COUNT(*) DESC LIMIT 1`,
        DB,
    );

    const ENDPOINTS = [
        ["GET /lists/:id/tasks", `/api/v1/lists/${listId}/tasks`],
        ["GET /tasks/:id", `/api/v1/tasks/${taskId}`],
        ["GET /tasks/:id/comments", `/api/v1/tasks/${taskId}/comments`],
        ["GET /tasks/:id/activity", `/api/v1/tasks/${taskId}/activity`],
        ["GET /tasks/my-work", `/api/v1/tasks/my-work`],
        ["GET /home/kpis", `/api/v1/home/kpis`],
        ["GET /home/agenda", `/api/v1/home/agenda`],
        ["GET /activity/recent", `/api/v1/activity/recent`],
        ["GET /notifications", `/api/v1/notifications`],
        ["GET /eng/home", `/api/v1/eng/home`],
        ["GET /search?q=", `/api/v1/search?q=scale`],
    ];

    console.log(`\nP13 — statements per REQUEST (N+1 sweep), limit ${REPEAT_LIMIT}\n`);
    console.log("  endpoint                     stmts  worst  rows  digest");

    const findings = [];
    for (const [label, url] of ENDPOINTS) {
        // Warm first: a cold request also runs auth/permission bootstrapping
        // that has nothing to do with the endpoint's own hydration.
        await fetch(`${BASE}${url}`, { headers: H });
        mysql(`TRUNCATE TABLE performance_schema.events_statements_summary_by_digest`);

        const res = await fetch(`${BASE}${url}`, { headers: H });
        const body = await res.text();
        let rows = 0;
        try {
            const j = JSON.parse(body);
            rows = Array.isArray(j)
                ? j.length
                : Array.isArray(j?.data)
                  ? j.data.length
                  : 1;
        } catch {
            rows = 0;
        }

        const total = Number(
            mysql(
                `SELECT COALESCE(SUM(COUNT_STAR),0) FROM performance_schema.events_statements_summary_by_digest
                  WHERE SCHEMA_NAME='${DB}' AND DIGEST_TEXT NOT LIKE 'TRUNCATE%'`,
            ),
        );
        const worst = mysql(
            `SELECT COUNT_STAR, LEFT(REPLACE(DIGEST_TEXT,'\\n',' '), 78)
               FROM performance_schema.events_statements_summary_by_digest
              WHERE SCHEMA_NAME='${DB}' AND DIGEST_TEXT NOT LIKE 'TRUNCATE%'
              ORDER BY COUNT_STAR DESC LIMIT 1`,
        );
        const [worstCount, worstText] = worst ? worst.split("\t") : ["0", "-"];

        console.log(
            `  ${label.padEnd(28)} ${String(total).padStart(5)}  ${String(worstCount).padStart(5)}` +
                `  ${String(rows).padStart(4)}  ${worstText ?? ""}`,
        );
        if (Number(worstCount) > REPEAT_LIMIT) {
            findings.push({ label, count: Number(worstCount), rows, worstText });
        }
    }

    if (findings.length === 0) {
        console.log(
            `\n  No digest ran more than ${REPEAT_LIMIT}× in a single request — ` +
                `hydration is batched on every path probed.\n`,
        );
    } else {
        console.log(`\n  ${findings.length} possible N+1:\n`);
        for (const f of findings) {
            console.log(
                `    ${f.label}: one statement ran ${f.count}× for ${f.rows} row(s)\n      ${f.worstText}`,
            );
        }
        console.log();
    }
    if (ASSERT && findings.length > 0) process.exit(1);
})();
