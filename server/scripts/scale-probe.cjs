#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * §P13 task 2 — what the hot endpoints cost at 5,000 tasks.
 *
 *   node scripts/scale-probe.cjs --base=http://localhost:5599 --db=tms_scale_test
 *
 * Times the endpoints the plan names, then asks the DATABASE which statements
 * they actually ran and how long those took. The second half is the point:
 * an endpoint's wall-clock time tells you it is slow, and
 * `performance_schema.events_statements_summary_by_digest` tells you WHICH
 * query to look at — including the ones a repo issues in a loop, which no
 * amount of staring at the response time reveals.
 *
 * Digest stats are RESET before the run, so what comes back is this run only.
 * That is safe here because the process owns the scale database, and it would
 * not be on a shared server.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const argOf = (n, d) => {
    const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : d;
};

const BASE = argOf("base", "http://localhost:5599");
const DB = argOf("db", "tms_scale_test");
const EMAIL = argOf("email", "owner@company.local");
const PASSWORD = argOf("password", "Owner@12345");
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

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

(async () => {
    // ── log in ──────────────────────────────────────────────────────────────
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!login.ok) {
        console.error(`login failed: ${login.status} ${await login.text()}`);
        process.exit(1);
    }
    const { access_token: token } = await login.json();
    const H = { authorization: `Bearer ${token}` };

    // The biggest list in the fixture — measuring the empty one would prove
    // nothing about scale.
    const [listId, listCount] = mysql(
        `SELECT primary_list_id, COUNT(*) c FROM tasks GROUP BY 1 ORDER BY c DESC LIMIT 1`,
        DB,
    ).split("\t");
    const spaceId = mysql(
        `SELECT space_id FROM lists WHERE id='${listId}'`,
        DB,
    );

    const ENDPOINTS = [
        ["GET /lists/:id/tasks", `/api/v1/lists/${listId}/tasks`],
        ["GET /home/kpis", `/api/v1/home/kpis`],
        ["GET /home/agenda", `/api/v1/home/agenda`],
        ["GET /search?q=", `/api/v1/search?q=scale`],
        ["GET /tasks/my-work", `/api/v1/tasks/my-work`],
        ["GET /eng/home", `/api/v1/eng/home`],
        ["GET /spaces/:id/tasks", `/api/v1/spaces/${spaceId}/tasks`],
        ["GET /activity/recent", `/api/v1/activity/recent`],
    ];

    console.log(
        `\nP13 — hot endpoints at ${mysql(`SELECT COUNT(*) FROM tasks`, DB)} tasks ` +
            `(biggest list holds ${listCount})\n`,
    );

    // ── warm, then reset the digest table so it shows THIS run ──────────────
    for (const [, url] of ENDPOINTS) await fetch(`${BASE}${url}`, { headers: H });
    mysql(`TRUNCATE TABLE performance_schema.events_statements_summary_by_digest`);

    console.log("  endpoint                     status   median ms   bytes");
    for (const [label, url] of ENDPOINTS) {
        const times = [];
        let status = 0;
        let bytes = 0;
        for (let i = 0; i < 5; i++) {
            const t0 = performance.now();
            const res = await fetch(`${BASE}${url}`, { headers: H });
            const body = await res.text();
            times.push(performance.now() - t0);
            status = res.status;
            bytes = body.length;
        }
        console.log(
            `  ${label.padEnd(28)} ${String(status).padStart(4)}   ${median(times)
                .toFixed(1)
                .padStart(9)}   ${String(bytes).padStart(7)}`,
        );
    }

    // ── what the database actually ran ──────────────────────────────────────
    console.log(`\n  slowest statements this run (performance_schema digest)\n`);
    console.log(
        "  calls   total ms    avg ms   rows_ex/call  no_index  statement",
    );
    const digest = mysql(
        `SELECT COUNT_STAR,
                ROUND(SUM_TIMER_WAIT/1e9, 1),
                ROUND(AVG_TIMER_WAIT/1e9, 3),
                ROUND(SUM_ROWS_EXAMINED/COUNT_STAR, 0),
                SUM_NO_INDEX_USED,
                REPLACE(LEFT(DIGEST_TEXT, 150), '\\n', ' ')
           FROM performance_schema.events_statements_summary_by_digest
          WHERE SCHEMA_NAME = '${DB}' AND DIGEST_TEXT NOT LIKE 'TRUNCATE%'
          ORDER BY SUM_TIMER_WAIT DESC LIMIT 12`,
    );
    for (const line of digest.split("\n").filter(Boolean)) {
        const [calls, total, avg, rows, noIdx, text] = line.split("\t");
        console.log(
            `  ${calls.padStart(5)}  ${total.padStart(9)} ${avg.padStart(9)}   ` +
                `${rows.padStart(12)}  ${noIdx.padStart(8)}  ${text}`,
        );
    }

    // A statement that examined far more rows than it returned, or ran without
    // an index, is the shape §P13 task 2 calls a defect on a hot path.
    const noIndex = mysql(
        `SELECT COUNT(*) FROM performance_schema.events_statements_summary_by_digest
          WHERE SCHEMA_NAME='${DB}' AND SUM_NO_INDEX_USED > 0
            AND DIGEST_TEXT NOT LIKE 'TRUNCATE%'`,
    );
    console.log(`\n  statement digests that ran WITHOUT an index: ${noIndex}\n`);
})();
