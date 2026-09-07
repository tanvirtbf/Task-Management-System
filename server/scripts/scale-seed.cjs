#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * THE SCALE FIXTURE — §P13 tasks 1 and 2.
 *
 * The plan asks for "the slowest endpoints under a seeded 5,000-task workspace"
 * and for KI-24's cost measured at 500 / 2,000 / 5,000 tasks. Neither question
 * can be answered against the dev database: it holds 47 tasks and 9 comments,
 * and `EXPLAIN` on 9 rows tells you nothing, because InnoDB's optimiser will
 * happily table-scan a tiny table and be right to.
 *
 *   node scripts/scale-seed.cjs                      # 5,000 tasks
 *   node scripts/scale-seed.cjs --tasks=500
 *   node scripts/scale-seed.cjs --db=tms_scale_test --drop
 *
 * ── why it CLONES the dev database rather than building one ─────────────────
 * A hand-built fixture would need every FK, every seeded role and permission
 * row, and a login that works — and would drift from the real schema the first
 * time an upgrade landed. Cloning `taskmanagement` (16k rows, 5.4 MB) gives all
 * of that for free, including the 025 columns and the 9 triggers, and means the
 * measurements run against the SAME shape production has. The bulk rows are
 * then added on top.
 *
 * ── what it does NOT do ─────────────────────────────────────────────────────
 * It does not touch the dev database. Everything lands in a scratch copy, and
 * `--drop` removes it. `C:` is at 99% on this machine, so leaving a 100 MB
 * fixture behind is not free.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const argOf = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const SOURCE = process.env.DB_NAME || "taskmanagement";
const TARGET = argOf("db", "tms_scale_test");
const TASKS = Number(argOf("tasks", "5000"));
const DROP_ONLY = process.argv.includes("--drop");
const USER = process.env.DB_USERNAME || "root";
const PASS = process.env.DB_PASSWORD || "";

const BIN = (() => {
    const guess = "C:/Program Files/MySQL/MySQL Server 8.0/bin";
    return fs.existsSync(path.join(guess, "mysql.exe")) ? guess : "";
})();
const exe = (n) => (BIN ? path.join(BIN, `${n}.exe`) : n);

const mysql = (sqlText, db) => {
    const args = [`-u${USER}`, `-p${PASS}`, "-N", "-B", "-e", sqlText];
    if (db) args.push(db);
    const r = spawnSync(exe("mysql"), args, {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    if (r.status !== 0) {
        throw new Error(
            `mysql failed: ${(r.stderr || "")
                .replace(/Using a password[^\n]*\n?/g, "")
                .trim()}`,
        );
    }
    // Windows client emits CRLF; a trailing \r inside an identifier produces
    // errors from SQL that looks perfectly correct when printed.
    return (r.stdout || "").replace(/\r/g, "").trim();
};

const rows = (sqlText, db) =>
    mysql(sqlText, db)
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split("\t"));

if (DROP_ONLY) {
    mysql(`DROP DATABASE IF EXISTS \`${TARGET}\``);
    console.log(`dropped ${TARGET}`);
    process.exit(0);
}

// ── 1. clone ────────────────────────────────────────────────────────────────
console.log(`\nSCALE FIXTURE — ${SOURCE} → ${TARGET} (+${TASKS} tasks)\n`);
process.stdout.write("  clone     … ");
const dumpPath = path.join(os.tmpdir(), `${SOURCE}-scale.sql`);
const dump = spawnSync(
    exe("mysqldump"),
    [
        `-u${USER}`,
        `-p${PASS}`,
        "--routines",
        "--triggers",
        "--events",
        "--single-transaction",
        SOURCE,
    ],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
);
if (dump.status !== 0) {
    console.log("FAILED");
    console.error(dump.stderr);
    process.exit(1);
}
fs.writeFileSync(dumpPath, dump.stdout);
mysql(
    `DROP DATABASE IF EXISTS \`${TARGET}\`; CREATE DATABASE \`${TARGET}\` ` +
        `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
);
const restore = spawnSync(exe("mysql"), [`-u${USER}`, `-p${PASS}`, TARGET], {
    input: fs.readFileSync(dumpPath, "utf8"),
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
});
if (restore.status !== 0) {
    console.log("FAILED");
    console.error(restore.stderr);
    process.exit(1);
}
fs.unlinkSync(dumpPath);
console.log("ok");

// ── 2. read the scaffolding the clone already has ───────────────────────────
const [workspaceId] = rows(`SELECT id FROM workspaces LIMIT 1`, TARGET)[0];
const userIds = rows(
    `SELECT id FROM users WHERE workspace_id='${workspaceId}' AND status='active'`,
    TARGET,
).map((r) => r[0]);
// A list has no workspace of its own — it reaches one through its space.
const lists = rows(
    `SELECT l.id, COALESCE(MAX(t.task_number), 0)
       FROM lists l
       JOIN spaces s ON s.id = l.space_id
       LEFT JOIN tasks t ON t.primary_list_id = l.id
      WHERE s.workspace_id='${workspaceId}' GROUP BY l.id`,
    TARGET,
).map(([id, maxNo]) => ({ id, next: Number(maxNo) + 1 }));
const typeIds = rows(
    `SELECT id FROM task_types WHERE workspace_id='${workspaceId}'`,
    TARGET,
).map((r) => r[0]);
/** Statuses are scoped to a list, so each task must take one of ITS list's. */
const statusByList = new Map();
for (const [listId, statusId] of rows(
    `SELECT scope_id, id FROM statuses WHERE scope_id IN (${lists
        .map((l) => `'${l.id}'`)
        .join(",")})`,
    TARGET,
)) {
    if (!statusByList.has(listId)) statusByList.set(listId, []);
    statusByList.get(listId).push(statusId);
}
const usable = lists.filter((l) => (statusByList.get(l.id) || []).length > 0);
if (usable.length === 0 || userIds.length === 0 || typeIds.length === 0) {
    console.error(
        `REFUSED: clone has no usable scaffolding ` +
            `(lists-with-statuses=${usable.length}, users=${userIds.length}, types=${typeIds.length})`,
    );
    process.exit(1);
}
console.log(
    `  scaffold  … ok  ${usable.length} list(s) · ${userIds.length} user(s) · ${typeIds.length} type(s)`,
);

// ── 3. generate ─────────────────────────────────────────────────────────────
// Deterministic PRNG so a re-run produces the same fixture and two measurements
// are comparable. Math.random() would make every run its own experiment.
let seed = 20260907;
const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const esc = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

const dayOffset = (n) => {
    const d = new Date(Date.now() + n * 86400000);
    return d.toISOString().slice(0, 10);
};

/**
 * Run SQL through STDIN, not `-e`.
 *
 * A 500-row multi-row INSERT is ~100 KB of text, and Windows caps a process
 * command line at 32,767 characters — so `-e` fails with an EMPTY stderr, which
 * looks like a broken database rather than a too-long argument. Piping the
 * statement in has no such limit.
 */
const mysqlStdin = (sqlText, db) => {
    const args = [`-u${USER}`, `-p${PASS}`];
    if (db) args.push(db);
    const r = spawnSync(exe("mysql"), args, {
        input: sqlText,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    if (r.status !== 0) {
        throw new Error(
            `mysql failed: ${(r.stderr || "")
                .replace(/Using a password[^\n]*\n?/g, "")
                .trim()}`,
        );
    }
};

const batchInsert = (table, cols, values, chunk = 500) => {
    for (let i = 0; i < values.length; i += chunk) {
        const slice = values.slice(i, i + chunk);
        mysqlStdin(
            `INSERT INTO \`${table}\` (${cols.join(",")}) VALUES ${slice.join(",")};`,
            TARGET,
        );
    }
};

process.stdout.write("  tasks     … ");
const taskIds = [];
const taskRows = [];
for (let i = 0; i < TASKS; i++) {
    const list = usable[i % usable.length];
    const id = `scl_t_${i.toString(36)}_${seed.toString(36)}`;
    taskIds.push(id);
    const statuses = statusByList.get(list.id);
    // A third of tasks carry a due date, spread ±60 days, so date-range and
    // overdue queries have something to range over rather than a single value.
    const due = rnd() < 0.34 ? esc(dayOffset(Math.floor(rnd() * 120) - 60)) : "NULL";
    const done = rnd() < 0.3;
    taskRows.push(
        `(${esc(id)},${esc(workspaceId)},${esc(list.id)},${list.next++},` +
            `${esc(`Scale task ${i}`)},${esc(pick(statuses))},${Math.floor(rnd() * 5)},` +
            `${esc(pick(typeIds))},${due},${done ? "NOW()" : "NULL"},${esc(pick(userIds))})`,
    );
}
batchInsert(
    "tasks",
    [
        "id",
        "workspace_id",
        "primary_list_id",
        "task_number",
        "name",
        "status_id",
        "priority",
        "task_type_id",
        "due_date",
        "completed_at",
        "created_by",
    ],
    taskRows,
);
console.log(`ok  ${TASKS}`);

process.stdout.write("  assignees … ");
const seen = new Set();
const assigneeRows = [];
for (const id of taskIds) {
    const n = rnd() < 0.25 ? 2 : 1;
    for (let k = 0; k < n; k++) {
        const u = pick(userIds);
        const key = `${id}|${u}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assigneeRows.push(`(${esc(id)},${esc(u)},${esc(pick(userIds))})`);
    }
}
batchInsert(
    "task_assignees",
    ["task_id", "user_id", "assigned_by"],
    assigneeRows,
);
console.log(`ok  ${assigneeRows.length}`);

// Comments are SKEWED on purpose: a handful of tasks carry a long thread and
// most carry none. A flat 3-per-task would never exercise the comment index the
// way one 400-comment task does, and the skew is what real threads look like.
process.stdout.write("  comments  … ");
const commentRows = [];
for (let i = 0; i < taskIds.length; i++) {
    const n = i % 250 === 0 ? 400 : rnd() < 0.35 ? Math.floor(rnd() * 6) : 0;
    for (let k = 0; k < n; k++) {
        commentRows.push(
            `(${esc(`scl_c_${i}_${k}`)},${esc(taskIds[i])},${esc(pick(userIds))},` +
                `${esc(`Scale comment ${k} on task ${i}`)})`,
        );
    }
}
batchInsert("comments", ["id", "task_id", "author_id", "body"], commentRows);
console.log(`ok  ${commentRows.length}`);

process.stdout.write("  notifs    … ");
const notifRows = [];
for (let i = 0; i < Math.min(TASKS, 5000); i++) {
    notifRows.push(
        `(${esc(`scl_n_${i}`)},${esc(pick(userIds))},'assigned','task',` +
            `${esc(taskIds[i])},${esc(`Scale notification ${i}`)})`,
    );
}
batchInsert(
    "notifications",
    ["id", "user_id", "type", "entity_type", "entity_id", "title"],
    notifRows,
);
console.log(`ok  ${notifRows.length}`);

// ── 4. make the optimiser aware of what just landed ─────────────────────────
// Without this the index statistics still describe the 47-task database and
// every EXPLAIN below is a measurement of a stale histogram, not of the data.
process.stdout.write("  analyze   … ");
for (const t of ["tasks", "comments", "task_assignees", "notifications"]) {
    mysql(`ANALYZE TABLE \`${t}\``, TARGET);
}
console.log("ok");

const counts = rows(
    `SELECT 'tasks', COUNT(*) FROM tasks
     UNION ALL SELECT 'comments', COUNT(*) FROM comments
     UNION ALL SELECT 'assignees', COUNT(*) FROM task_assignees
     UNION ALL SELECT 'notifications', COUNT(*) FROM notifications`,
    TARGET,
);
console.log(
    `\n  ${TARGET}: ` + counts.map(([k, v]) => `${k}=${v}`).join(" · ") + "\n",
);
