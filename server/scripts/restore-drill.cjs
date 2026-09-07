#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * THE RESTORE DRILL — §P12 task 5.
 *
 * "A backup nobody has restored is a backup nobody has."
 *
 * Takes a real `mysqldump` of a database, restores it into a scratch copy, and
 * proves the copy is EQUIVALENT — not merely that the commands exited 0, which
 * is all a dump script normally tells you. Then it drops the scratch copy.
 *
 *   node scripts/restore-drill.cjs                  # drill the dev DB
 *   node scripts/restore-drill.cjs --db=other       # drill another one
 *   node scripts/restore-drill.cjs --keep           # leave the copy behind
 *
 * ── what it compares, and why each one ──────────────────────────────────────
 * A dump can succeed and still lose things, quietly and in ways nothing else in
 * this project would notice:
 *
 *   · TRIGGERS — nine of them maintain the denormalised counters
 *     (`tasks.attachments_count`, the checklist totals), and a restore without
 *     them looks perfect and then drifts silently. (`--triggers` is mysqldump's
 *     DEFAULT — it is passed explicitly here so nobody has to remember that,
 *     and the check was verified by re-running with `--skip-triggers`, which
 *     turns the drill red.)
 *   · VIEWS — `v_breached_sla` and `v_current_on_call` are hand-written in a
 *     migration and invisible to the ORM. F3 found the live DB and schema.sql
 *     had already drifted to two different wrong answers once.
 *   · ROUTINES and EVENTS — omitted by default for the same reason as triggers.
 *   · FOREIGN KEYS — including the two ON DELETE RESTRICT paths the test plan
 *     calls out; a restore that lost them would accept deletes the product
 *     depends on refusing.
 *   · ROW COUNTS, per table — the actual point.
 *
 * ── why a SCRATCH copy and not drop-and-restore-in-place ────────────────────
 * The plan says "drop it, restore it". Restoring into a scratch database proves
 * exactly the same thing — the dump contains everything needed to rebuild — and
 * does not put the dev database's baseline (47/6/9/27/15, which every phase of
 * this campaign verifies) behind a step that might fail. If the restore is
 * broken, the honest outcome is a red drill, not a destroyed database.
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
const KEEP = process.argv.includes("--keep");

const SOURCE = argOf("db", process.env.DB_NAME || "taskmanagement");
const COPY = argOf("into", `${SOURCE}_restore_drill`);
const USER = process.env.DB_USERNAME || "root";
const PASS = process.env.DB_PASSWORD || "";

/** Windows-friendly: prefer the bundled client, fall back to PATH. */
const BIN = (() => {
    const guess = "C:/Program Files/MySQL/MySQL Server 8.0/bin";
    return fs.existsSync(path.join(guess, "mysql.exe")) ? guess : "";
})();
const exe = (name) => (BIN ? path.join(BIN, `${name}.exe`) : name);

const mysql = (sqlText, db) => {
    const args = [`-u${USER}`, `-p${PASS}`, "-N", "-B", "-e", sqlText];
    if (db) args.push(db);
    const r = spawnSync(exe("mysql"), args, {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    if (r.status !== 0) {
        throw new Error(
            `mysql failed: ${(r.stderr || "").replace(/Using a password[^\n]*\n?/g, "").trim()}`,
        );
    }
    // Strip CR: the Windows client emits CRLF, and a table name carrying a
    // trailing \r produces `ERROR 1103 Incorrect table name` from a query that
    // looks perfectly correct when printed.
    return (r.stdout || "").replace(/\r/g, "").trim();
};

const rows = (sqlText, db) =>
    mysql(sqlText, db)
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split("\t"));

// ── 1. dump ──────────────────────────────────────────────────────────────────
const dumpPath = path.join(os.tmpdir(), `${SOURCE}-restore-drill.sql`);
console.log(`\nRESTORE DRILL — ${SOURCE} → ${COPY}\n`);
process.stdout.write("  dump      … ");
const dump = spawnSync(
    exe("mysqldump"),
    [
        `-u${USER}`,
        `-p${PASS}`,
        "--routines",
        "--triggers",
        "--events",
        "--single-transaction",
        "--add-drop-table",
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
const mb = (fs.statSync(dumpPath).size / 1024 / 1024).toFixed(1);
console.log(`ok  (${mb} MB)`);

// ── 2. restore into a scratch copy ───────────────────────────────────────────
process.stdout.write("  restore   … ");
mysql(
    `DROP DATABASE IF EXISTS \`${COPY}\`; CREATE DATABASE \`${COPY}\` ` +
        `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
);
const restore = spawnSync(exe("mysql"), [`-u${USER}`, `-p${PASS}`, COPY], {
    input: fs.readFileSync(dumpPath, "utf8"),
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
});
if (restore.status !== 0) {
    console.log("FAILED");
    console.error(restore.stderr);
    process.exit(1);
}
console.log("ok");

// ── 3. compare ───────────────────────────────────────────────────────────────
const problems = [];
const compare = (label, a, b) => {
    const missing = a.filter((x) => !b.includes(x));
    const extra = b.filter((x) => !a.includes(x));
    const ok = missing.length === 0 && extra.length === 0;
    console.log(
        `  ${label.padEnd(10)}… ${ok ? "ok" : "MISMATCH"}  ${a.length} object(s)` +
            (ok
                ? ""
                : `\n      missing in copy: ${missing.join(", ") || "-"}` +
                  `\n      only in copy:    ${extra.join(", ") || "-"}`),
    );
    if (!ok) problems.push(label);
};

const names = (sqlText) => rows(sqlText).map((r) => r[0]);

compare(
    "tables",
    names(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${SOURCE}' AND TABLE_TYPE='BASE TABLE' ORDER BY 1`,
    ),
    names(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${COPY}' AND TABLE_TYPE='BASE TABLE' ORDER BY 1`,
    ),
);
compare(
    "views",
    names(
        `SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA='${SOURCE}' ORDER BY 1`,
    ),
    names(
        `SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA='${COPY}' ORDER BY 1`,
    ),
);
compare(
    "triggers",
    names(
        `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${SOURCE}' ORDER BY 1`,
    ),
    names(
        `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${COPY}' ORDER BY 1`,
    ),
);
compare(
    "fkeys",
    names(
        `SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='${SOURCE}' ORDER BY 1`,
    ),
    names(
        `SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='${COPY}' ORDER BY 1`,
    ),
);
compare(
    "routines",
    names(
        `SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${SOURCE}' ORDER BY 1`,
    ),
    names(
        `SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${COPY}' ORDER BY 1`,
    ),
);

// ── row counts, table by table ───────────────────────────────────────────────
// One statement per table rather than a GROUP_CONCAT-built union: the first
// attempt at this silently exceeded `group_concat_max_len`, produced truncated
// SQL, and reported "0 tables compared" — a green-looking answer from a query
// that never ran.
const tables = names(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${SOURCE}' AND TABLE_TYPE='BASE TABLE' ORDER BY 1`,
);
let totalRows = 0;
const rowMismatch = [];
for (const t of tables) {
    const a = Number(mysql(`SELECT COUNT(*) FROM \`${SOURCE}\`.\`${t}\``));
    const b = Number(mysql(`SELECT COUNT(*) FROM \`${COPY}\`.\`${t}\``));
    totalRows += a;
    if (a !== b) rowMismatch.push(`${t}: ${a} vs ${b}`);
}
console.log(
    `  rows      … ${rowMismatch.length === 0 ? "ok" : "MISMATCH"}  ` +
        `${tables.length} table(s), ${totalRows} row(s)` +
        (rowMismatch.length ? `\n      ${rowMismatch.join("\n      ")}` : ""),
);
if (rowMismatch.length) problems.push("rows");
if (tables.length === 0) {
    problems.push("rows");
    console.log(
        "      REFUSED: zero tables compared — the drill proved nothing",
    );
}

// ── queries, not just objects ────────────────────────────────────────────────
// Everything above compares NAMES. A view can be listed in
// `information_schema.VIEWS` and still be unusable — MySQL marks a view broken
// only when you SELECT from it, and a restore is exactly where a definer or a
// column reference goes missing. The plan's task 5 asks for "the full gate
// against the restored copy"; the gate runs on per-module private databases
// built from canonical SQL, so it cannot be pointed at this one. Running the
// product's real read shapes against both copies is the honest equivalent: it
// proves the restore is USABLE, not merely present.
const PROBES = [
    ["v_breached_sla", "SELECT COUNT(*) FROM v_breached_sla"],
    ["v_current_on_call", "SELECT COUNT(*) FROM v_current_on_call"],
    [
        "tasks × lists × spaces",
        `SELECT COUNT(*) FROM tasks t
           JOIN lists l ON l.id = t.primary_list_id
           JOIN spaces s ON s.id = l.space_id`,
    ],
    [
        "checklist rollup",
        `SELECT COALESCE(SUM(checklist_items_total), 0),
                COALESCE(SUM(checklist_items_done), 0) FROM tasks`,
    ],
    [
        "rbac role × permission",
        `SELECT COUNT(*) FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id`,
    ],
];
const probeMismatch = [];
for (const [label, q] of PROBES) {
    let a;
    let b;
    try {
        a = mysql(q, SOURCE);
        b = mysql(q, COPY);
    } catch (err) {
        probeMismatch.push(`${label}: ${err.message}`);
        continue;
    }
    if (a !== b) probeMismatch.push(`${label}: ${a} vs ${b}`);
}
console.log(
    `  queries   … ${probeMismatch.length === 0 ? "ok" : "MISMATCH"}  ` +
        `${PROBES.length} probe(s)` +
        (probeMismatch.length
            ? `\n      ${probeMismatch.join("\n      ")}`
            : ""),
);
if (probeMismatch.length) problems.push("queries");

// ── 4. clean up ──────────────────────────────────────────────────────────────
if (!KEEP) {
    mysql(`DROP DATABASE IF EXISTS \`${COPY}\``);
    fs.unlinkSync(dumpPath);
} else {
    console.log(`\n  kept: database ${COPY}, dump ${dumpPath}`);
}

console.log(
    problems.length === 0
        ? "\n  RESTORED CLEAN — the backup rebuilds this database exactly.\n"
        : `\n  DRILL FAILED: ${problems.join(", ")}\n`,
);
process.exit(problems.length === 0 ? 0 : 1);
