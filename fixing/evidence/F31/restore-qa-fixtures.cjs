// F31 — restore the P45-era e2e fixtures in taskmanagement_qa.
//
// The 13 .pw.ts specs were written in P45/P46 against hand-seeded rows with
// HARDCODED ids. The three P45X tasks have since been cleaned away (their ids
// are pinned in tasks-views.pw.ts), so the harness cannot stand up without
// them. Idempotent: existing rows are left alone.
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");

const LIST = "l-63STZdlEZ2QOoWk61X-kOw"; // "QA List B"
const ALPHA = "t-i-lZYwQtOsh0FCDoUV27rw";
const GAMMA = "t-SM8n-5khukenNA_4jHueAQ";
const BETA = "t-p45x-beta-restored0001"; // id not pinned by any spec

(async () => {
    const db = await mysql.createConnection({
        host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement_qa", timezone: "+00:00",
    });
    const [[ws]] = await db.query("SELECT id FROM workspaces LIMIT 1");
    const [[owner]] = await db.query("SELECT id FROM users WHERE email='owner@company.local'");
    const [types] = await db.query("SELECT id,name FROM task_types");
    const T = Object.fromEntries(types.map((t) => [t.name, t.id]));
    const [sts] = await db.query(
        "SELECT id,name FROM statuses WHERE scope_type='list' AND scope_id=? ORDER BY position", [LIST]);
    const S = Object.fromEntries(sts.map((s) => [s.name, s.id]));
    const [[mx]] = await db.query(
        "SELECT COALESCE(MAX(task_number),0) n FROM tasks WHERE primary_list_id=?", [LIST]);
    let num = mx.n;

    const mk = async (id, name, typeName, statusName, extra = {}) => {
        const [[have]] = await db.query("SELECT COUNT(*) c FROM tasks WHERE id=?", [id]);
        if (have.c) { console.log("  keep  " + name); return; }
        num += 1;
        await db.query(
            `INSERT INTO tasks (id, workspace_id, primary_list_id, task_number, name,
                                status_id, task_type_id, priority, created_by, bug_severity)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [id, ws.id, LIST, num, name, S[statusName], T[typeName], 0, owner.id,
             extra.severity ?? null]);
        console.log("  seed  " + name + "  (#" + num + ", " + typeName + ", " + statusName + ")");
    };

    // Unassigned ON PURPOSE — the Me-Mode spec depends on them hiding.
    await mk(ALPHA, "P45X Alpha task", "Task", "To Do");
    await mk(BETA, "P45X Beta task", "Task", "In Progress");
    await mk(GAMMA, "P45X Gamma bug", "Bug", "To Do", { severity: "S2" });

    // settings-eng needs ≥1 bug in the REAL Bug Triage list so /eng resolves it.
    const [[bt]] = await db.query(
        "SELECT COUNT(*) c FROM tasks WHERE primary_list_id='l-9krS0i8aig7nbSdVZEh0VQ' AND archived_at IS NULL");
    console.log("  bug-triage live tasks: " + bt.c + (bt.c ? "" : "   <-- seeding one"));
    if (!bt.c) {
        const [[bmx]] = await db.query(
            "SELECT COALESCE(MAX(task_number),0) n FROM tasks WHERE primary_list_id='l-9krS0i8aig7nbSdVZEh0VQ'");
        const [bsts] = await db.query(
            "SELECT id FROM statuses WHERE scope_type='list' AND scope_id='l-9krS0i8aig7nbSdVZEh0VQ' ORDER BY position LIMIT 1");
        await db.query(
            `INSERT INTO tasks (id, workspace_id, primary_list_id, task_number, name,
                                status_id, task_type_id, priority, created_by, bug_severity)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            ["t-f31-bugtriage-rep0001", ws.id, "l-9krS0i8aig7nbSdVZEh0VQ", bmx.n + 1,
             "F31 representative bug", bsts[0].id, T["Bug"], 1, owner.id, "S2"]);
        console.log("  seeded the representative bug");
    }
    // Post-pass repairs, run UNCONDITIONALLY (the seeding above is skip-if-
    // present, so re-runs land here):
    //  - GAMMA needs an SLA — the P45 Bug-drawer spec asserts the SLA panel,
    //    which renders only when sla_due_at is set. A direct INSERT bypasses
    //    computeSlaDueAt, so stamp one explicitly.
    //  - the Bug Triage representative must be NAMED "P46 KI-13 bug": the
    //    KI-13 spec clicks it by text on /eng.
    await db.query(
        "UPDATE tasks SET sla_due_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 DAY) WHERE id=? AND sla_due_at IS NULL",
        [GAMMA]);
    await db.query(
        "UPDATE tasks SET name='P46 KI-13 bug' WHERE id='t-f31-bugtriage-rep0001' AND name<>'P46 KI-13 bug'");
    // (if a P46-era bug with that name already lives in bug-triage, the rename
    //  above is a no-op on our row and the spec finds the original)
    console.log("  post-pass: GAMMA sla stamped, KI-13 name ensured");
    await db.end();
    console.log("  done");
})().catch((e) => { console.error("RESTORE ERROR " + e.message); process.exit(1); });
