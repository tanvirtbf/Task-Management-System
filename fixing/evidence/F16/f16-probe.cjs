// F16 — orphans and cascades: the three repros, then the P37 orphan sweep.
//
//   ISS-073  hard-deleting a task left its notifications in every inbox,
//            pointing at a 404 (the ONLY child table that orphaned).
//   ISS-022  hard-deleting a task stranded its R2 objects forever — the FK
//            cascade removed the attachment rows before the r2-purge job (which
//            reads soft-deleted rows) could ever learn the objects existed.
//   ISS-041  un-archiving a space did not restore the lists archiving it took
//            down; a space came back EMPTY (Marketing's three boards were
//            invisible for ninety minutes in P8).
//
// Ends with P37's full 24-query orphan sweep — the phase's acceptance bar is
// 24 of 24 clean.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const fs = require("node:fs");
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 300); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const pad = (s, n) => String(s).padEnd(n);
let bad = 0;
const check = (label, ok, detail) => { if (!ok) bad++;
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 58) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const one = async (q, p) => (await db.query(q, p))[0][0];
    const OT = await login("owner@company.local");
    const TOKEN = fs.readFileSync("E:/Task Management System/server/.env", "utf8")
        .split(/\r?\n/).find((l) => l.startsWith("INTERNAL_JOB_TOKEN="))?.slice(19).trim();

    console.log("\n  === F16 — orphans and cascades ===\n");

    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const [[arif]] = await db.query("SELECT id FROM users WHERE email LIKE 'arif@%'");

    // ── ISS-073 + ISS-022 share one fixture: parent + child, notified + filed ─
    console.log("  --- fixture: parent + child, each with a notification and a file ---");
    const P = (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name: "F16 orphan parent" })).b;
    const K = (await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "F16 orphan child", parent_task_id: P.id })).b;
    await api(OT, "POST", "/tasks/" + P.id + "/assignees", { user_ids: [arif.id] });
    await api(OT, "POST", "/tasks/" + K.id + "/assignees", { user_ids: [arif.id] });
    const up = async (taskId, name) => {
        const r = await fetch(B + "/tasks/" + taskId + "/attachments", { method: "POST",
            headers: { Authorization: "Bearer " + OT, "Content-Type": "image/png", "X-Filename": name },
            body: Buffer.from("F16 bytes for " + name) });
        return (await j(r))?.id;
    };
    const attP = await up(P.id, "parent.png");
    const attK = await up(K.id, "child.png");
    const attSoft = await up(P.id, "already-trashed.png");
    const softDel = await api(OT, "DELETE", "/attachments/" + attSoft);
    const notifs = async () => (await one(
        "SELECT COUNT(*) n FROM notifications WHERE entity_type='task' AND entity_id IN (?,?)",
        [P.id, K.id])).n;
    const attRows = async () => (await one(
        "SELECT COUNT(*) n FROM attachments WHERE task_id IN (?,?)", [P.id, K.id])).n;
    const keys = [];
    for (const a of [attP, attK, attSoft]) {
        const r = await one("SELECT storage_key FROM attachments WHERE id=?", [a]);
        if (r) keys.push(r.storage_key);
    }
    check("2 task-notifications + 3 attachment rows exist",
        (await notifs()) >= 2 && (await attRows()) === 3 && softDel.s === 204,
        "notifs " + await notifs() + ", rows " + await attRows() + " (1 soft-deleted)");

    console.log("\n  --- ISS-073 + ISS-022: the hard delete ---");
    const feedBefore = await api(OT, "GET", "/notifications?limit=50");
    const del = await api(OT, "DELETE", "/tasks/" + P.id + "?hard=true");
    check("hard delete (204) takes the whole subtree", del.s === 204, "got " + del.s);
    check("notifications for BOTH tasks are gone (was: stayed forever)",
        (await notifs()) === 0, "remaining " + await notifs());
    check("attachment rows cascaded (as before)", (await attRows()) === 0, "");
    const [qrows] = await db.query("SELECT storage_key FROM r2_purge_queue");
    const queuedKeys = qrows.map((r) => r.storage_key);
    check("ALL 3 R2 keys queued — incl. the child's and the soft-deleted one",
        keys.length === 3 && keys.every((k) => queuedKeys.includes(k)),
        queuedKeys.length + " queued");

    console.log("\n  --- the r2-purge job drains the queue ---");
    const dry = await j(await fetch(B + "/jobs/r2-purge?dry_run=true", { method: "POST",
        headers: { "X-Internal-Token": TOKEN } }));
    check("dry run REPORTS the queue without draining it",
        dry.wouldDrainQueue === 3 && (await one("SELECT COUNT(*) n FROM r2_purge_queue")).n === 3,
        "wouldDrainQueue " + dry.wouldDrainQueue);
    const real = await j(await fetch(B + "/jobs/r2-purge", { method: "POST",
        headers: { "X-Internal-Token": TOKEN } }));
    check("real run drains 3 (R2 objects deleted first, rows second)",
        real.queueDrained === 3 && real.r2Errors === 0,
        "queueDrained " + real.queueDrained + ", r2Errors " + real.r2Errors);
    check("queue empty afterwards", (await one("SELECT COUNT(*) n FROM r2_purge_queue")).n === 0, "");

    // ── ISS-041 ──────────────────────────────────────────────────────────────
    console.log("\n  --- ISS-041: unarchive restores what archive took down ---");
    const SP = (await api(OT, "POST", "/spaces", { name: "F16 Cascade Space" })).b;
    const L1 = (await api(OT, "POST", "/lists", { space_id: SP.id, name: "F16 list one" })).b;
    const L2 = (await api(OT, "POST", "/lists", { space_id: SP.id, name: "F16 list two" })).b;
    const lstate = async () => {
        const r1 = await one("SELECT archived_at FROM lists WHERE id=?", [L1.id]);
        const r2 = await one("SELECT archived_at FROM lists WHERE id=?", [L2.id]);
        return { l1: !!r1.archived_at, l2: !!r2.archived_at };
    };
    // archive L1 INDEPENDENTLY first — the discriminator case
    const a1 = await api(OT, "POST", "/lists/" + L1.id + "/archive");
    await new Promise((r) => setTimeout(r, 1200)); // a different TIMESTAMP second
    const as1 = await api(OT, "POST", "/spaces/" + SP.id + "/archive");
    let st = await lstate();
    check("archive: space cascade took L2 (L1 was already archived)",
        (a1.s === 204 || a1.s === 200) && as1.s === 204 && st.l1 && st.l2,
        JSON.stringify(st));
    const us1 = await api(OT, "POST", "/spaces/" + SP.id + "/unarchive");
    st = await lstate();
    check("unarchive: L2 is BACK (was: space came back empty)",
        us1.s === 204 && st.l2 === false, "l2 archived=" + st.l2);
    check("…and the INDEPENDENTLY archived L1 STAYS archived", st.l1 === true,
        "l1 archived=" + st.l1);
    const act = await one(
        "SELECT context FROM workspace_activity WHERE entity_id=? AND action='unarchived' ORDER BY created_at DESC LIIMIT 1"
            .replace("LIIMIT", "LIMIT"), [SP.id]);
    const ctx = typeof act?.context === "string" ? JSON.parse(act.context) : act?.context;
    check("the audit row says how many lists came back", ctx?.lists_restored === 1,
        "lists_restored " + ctx?.lists_restored);

    // ── the P37 orphan sweep, all 24 ─────────────────────────────────────────
    console.log("\n  --- P37's 24-query orphan sweep, re-run ---");
    const SWEEP = [
        ["tasks with a dead list", "SELECT COUNT(*) n FROM tasks t WHERE NOT EXISTS (SELECT 1 FROM lists l WHERE l.id=t.primary_list_id)"],
        ["tasks with a dead status", "SELECT COUNT(*) n FROM tasks t WHERE NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id=t.status_id)"],
        ["tasks with a dead type", "SELECT COUNT(*) n FROM tasks t WHERE t.task_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_types y WHERE y.id=t.task_type_id)"],
        ["tasks with a dead parent", "SELECT COUNT(*) n FROM tasks t WHERE t.parent_task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id=t.parent_task_id)"],
        ["lists with a dead space", "SELECT COUNT(*) n FROM lists l WHERE NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id=l.space_id)"],
        ["statuses (scope=list) with a dead list", "SELECT COUNT(*) n FROM statuses s WHERE s.scope_type='list' AND NOT EXISTS (SELECT 1 FROM lists l WHERE l.id=s.scope_id)"],
        ["comments with a dead task", "SELECT COUNT(*) n FROM comments c WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=c.task_id)"],
        ["checklists with a dead task", "SELECT COUNT(*) n FROM checklists c WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=c.task_id)"],
        ["checklist_items with a dead checklist", "SELECT COUNT(*) n FROM checklist_items i WHERE NOT EXISTS (SELECT 1 FROM checklists c WHERE c.id=i.checklist_id)"],
        ["attachments with a dead task", "SELECT COUNT(*) n FROM attachments a WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=a.task_id)"],
        ["task_assignees with a dead task", "SELECT COUNT(*) n FROM task_assignees x WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=x.task_id)"],
        ["task_assignees with a dead user", "SELECT COUNT(*) n FROM task_assignees x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=x.user_id)"],
        ["task_activity with a dead task", "SELECT COUNT(*) n FROM task_activity a WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=a.task_id)"],
        ["NOTIFICATIONS pointing at a dead task", "SELECT COUNT(*) n FROM notifications nf WHERE nf.entity_type='task' AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=nf.entity_id)"],
        ["notifications pointing at a dead comment", "SELECT COUNT(*) n FROM notifications nf WHERE nf.entity_type='comment' AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.id=nf.entity_id)"],
        ["notifications with a dead user", "SELECT COUNT(*) n FROM notifications nf WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=nf.user_id)"],
        ["task_dependencies with a dead task", "SELECT COUNT(*) n FROM task_dependencies d WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=d.task_id) OR NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id=d.related_task_id)"],
        ["form_fields with a dead form", "SELECT COUNT(*) n FROM form_fields f WHERE NOT EXISTS (SELECT 1 FROM forms fo WHERE fo.id=f.form_id)"],
        ["form_submissions with a dead form", "SELECT COUNT(*) n FROM form_submissions s WHERE NOT EXISTS (SELECT 1 FROM forms fo WHERE fo.id=s.form_id)"],
        ["department_reports with a dead space", "SELECT COUNT(*) n FROM department_reports r WHERE NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id=r.space_id)"],
        ["task_reviews with a dead task", "SELECT COUNT(*) n FROM task_reviews r WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=r.task_id)"],
        ["spaces with a dead head", "SELECT COUNT(*) n FROM spaces s WHERE s.head_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=s.head_user_id)"],
        ["sessions with a dead user", "SELECT COUNT(*) n FROM sessions se WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=se.user_id)"],
        ["tasks whose sprint is gone", "SELECT COUNT(*) n FROM tasks t WHERE t.sprint_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sprints sp WHERE sp.id=t.sprint_id)"],
    ];
    let clean = 0;
    for (const [label, q] of SWEEP) {
        const n = (await one(q)).n;
        if (n === 0) clean++; else { bad++; }
        console.log("  " + pad(label, 44) + n + (n === 0 ? "     clean" : "     *** ORPHANS ***"));
    }
    console.log("  -> " + clean + " of " + SWEEP.length + " clean" +
        (clean === SWEEP.length ? "  (P37 scored 23 of 24 — the notification row was the one)" : ""));

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    const [strayLists] = await db.query("SELECT id FROM lists WHERE name LIKE 'F16 %'");
    for (const lid of [...new Set([L1.id, L2.id, ...strayLists.map((r) => r.id)])]) {
        await db.query("DELETE FROM statuses WHERE scope='list' AND scope_id=?", [lid]).catch(() => {});
        await db.query("DELETE FROM lists WHERE id=?", [lid]).catch(() => {});
    }
    await db.query("DELETE FROM spaces WHERE id=? OR name LIKE 'F16 %'", [SP.id]).catch(() => {});
    const [strays] = await db.query("SELECT id FROM tasks WHERE name LIKE 'F16 %'");
    for (const r of strays) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers", "notifications", "attachments"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.id]).catch(() => {});
    }
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  tasks " + await q("tasks") + " (46) | lists " + await q("lists") +
        " (13) | spaces " + await q("spaces") + " (6) | notif " + await q("notifications") +
        " (57) | queue " + await q("r2_purge_queue") + " (0)");
    console.log(bad === 0
        ? "\n  PASS — nothing orphans: not inbox entries, not R2 bytes, not a department's boards.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
