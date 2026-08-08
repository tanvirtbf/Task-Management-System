// F30 (ISS-088) — the P40 §4 EXPLAIN table, re-runnable before/after upgrade 013.
//
//   node fixing/evidence/F30/explain-probe.cjs [--db taskmanagement_perf] [--label before]
//
// Replicates the seven hot queries against the SAME 5,000-task perf fixture P40
// used, shaped exactly like the repos shape them (listByList, listByTask, the
// two activity feeds, plus the three P40 ran for context). PASS/FAIL is decided
// on the four ISS-088 rows only: after 013 none of them may say "Using
// filesort", and each must sit on its new index.
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");

const argOf = (flag, dflt) => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? process.argv[i + 1] : dflt;
};
const DB = argOf("--db", "taskmanagement_perf");
const LABEL = argOf("--label", "");

const pad = (s, n) => String(s ?? "").padEnd(n);

(async () => {
    const db = await mysql.createConnection({
        host: "127.0.0.1", user: "root", password: "root",
        database: DB, timezone: "+00:00",
    });

    // The fixture rows the queries anchor on — busiest list, a commented task,
    // an active task, the workspace.
    const [[list]] = await db.query(
        `SELECT l.id, (SELECT COUNT(*) FROM tasks WHERE primary_list_id = l.id) n
           FROM lists l ORDER BY n DESC LIMIT 1`);
    const [[ctask]] = await db.query(
        `SELECT task_id id FROM comments GROUP BY task_id ORDER BY COUNT(*) DESC LIMIT 1`);
    const [[atask]] = await db.query(
        `SELECT task_id id FROM task_activity GROUP BY task_id ORDER BY COUNT(*) DESC LIMIT 1`);
    const [[ws]] = await db.query(`SELECT id FROM workspaces LIMIT 1`);
    const [[user]] = await db.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);

    const QUERIES = [
        ["list tasks", true,
         `SELECT * FROM tasks WHERE primary_list_id = ? AND archived_at IS NULL
            ORDER BY internal_id ASC LIMIT 50`, [list.id]],
        ["task comments", true,
         `SELECT * FROM comments WHERE task_id = ?
            ORDER BY created_at ASC, internal_id ASC`, [ctask.id]],
        ["task activity", true,
         `SELECT * FROM task_activity WHERE task_id = ?
            ORDER BY internal_id DESC LIMIT 50`, [atask.id]],
        ["workspace activity", true,
         `SELECT * FROM workspace_activity WHERE workspace_id = ?
            ORDER BY internal_id DESC LIMIT 50`, [ws.id]],
        // P40 context rows — not ISS-088's, listed so the table stays comparable.
        ["my open tasks", false,
         `SELECT t.* FROM tasks t JOIN task_assignees a ON a.task_id = t.id
           WHERE a.user_id = ? AND t.archived_at IS NULL AND t.completed_at IS NULL`, [user.id]],
        ["search tasks (LIKE)", false,
         `SELECT * FROM tasks WHERE workspace_id = ? AND name LIKE '%Perf%' LIMIT 50`, [ws.id]],
        ["overdue count", false,
         `SELECT COUNT(*) FROM tasks WHERE workspace_id = ? AND archived_at IS NULL
            AND completed_at IS NULL AND due_date < CURDATE()`, [ws.id]],
    ];

    console.log("\n=== F30 EXPLAIN — " + DB + (LABEL ? " — " + LABEL : "") + " ===");
    console.log("  " + pad("query", 24) + pad("type", 8) + pad("key used", 40) + pad("rows", 8) + "Extra");

    let filesorts = 0;
    const expectedKeys = {
        "list tasks": "idx_tasks_list_internal",
        "task comments": "idx_comments_task_created_internal",
        "task activity": "idx_task_activity_task_internal",
        "workspace activity": "idx_workspace_activity_ws_internal",
    };
    let wrongKey = 0;

    for (const [name, iss088, sqlText, params] of QUERIES) {
        const [rows] = await db.query("EXPLAIN " + sqlText, params);
        const r = rows[0];
        const extra = r.Extra ?? "";
        const marks = [];
        if (iss088 && /filesort/i.test(extra)) { filesorts += 1; marks.push("<-- FILESORT"); }
        if (iss088 && LABEL === "after" && r.key !== expectedKeys[name]) {
            wrongKey += 1; marks.push("<-- expected " + expectedKeys[name]);
        }
        console.log("  " + pad(name, 24) + pad(r.type, 8) + pad(r.key, 40) + pad(r.rows, 8)
            + extra + (marks.length ? "   " + marks.join(" ") : ""));
    }

    const [sizes] = await db.query(
        `SELECT table_name t, table_rows r FROM information_schema.tables
          WHERE table_schema = ? AND table_name IN ('tasks','comments','task_activity','workspace_activity')`, [DB]);
    console.log("  volume: " + sizes.map((x) => x.t + "=" + x.r).join("  "));

    await db.end();
    if (LABEL === "after") {
        const okAll = filesorts === 0 && wrongKey === 0;
        console.log(okAll
            ? "\n  PASS — zero filesorts on the four ISS-088 queries; all four sit on their new index"
            : "\n  FAIL — filesorts=" + filesorts + " wrongKey=" + wrongKey);
        process.exit(okAll ? 0 : 1);
    }
    console.log("\n  (before run — filesorts on ISS-088 rows: " + filesorts + ")");
})().catch((e) => { console.error("PROBE ERROR " + e.message); process.exit(2); });
