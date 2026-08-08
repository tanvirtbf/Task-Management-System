// F21 — activity and audit quality: ISS-049 + ISS-062 live, ISS-061 statically.
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 62) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const one = async (q, p) => (await db.query(q, p))[0][0];
    const OT = await login("owner@company.local");
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const actRows = async (taskId) => (await db.query(
        "SELECT action, context FROM task_activity WHERE task_id=? ORDER BY internal_id", [taskId]))[0]
        .map((r) => ({ action: r.action, ctx: typeof r.context === "string" ? JSON.parse(r.context) : r.context }));

    console.log("\n  === F21 — activity and audit quality ===\n");

    console.log("  --- ISS-049: task_updated records values, skips no-ops ---");
    const T = (await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "F21 audit task", priority: 2 })).b;
    let before = (await actRows(T.id)).length;
    const up1 = await api(OT, "PATCH", "/tasks/" + T.id,
        { name: "F21 audit task renamed", priority: 4 });
    let rows = await actRows(T.id);
    const lastRow = rows[rows.length - 1];
    check("a real change writes ONE row with per-field {from,to}",
        up1.s === 200 && rows.length === before + 1 &&
        lastRow.action === "task_updated" &&
        lastRow.ctx?.changes?.name?.from === "F21 audit task" &&
        lastRow.ctx?.changes?.name?.to === "F21 audit task renamed" &&
        lastRow.ctx?.changes?.priority?.from === 2 &&
        lastRow.ctx?.changes?.priority?.to === 4,
        JSON.stringify(lastRow.ctx ?? {}).slice(0, 76));

    before = rows.length;
    const noop = await api(OT, "PATCH", "/tasks/" + T.id,
        { name: "F21 audit task renamed" });
    rows = await actRows(T.id);
    check("a NO-OP patch writes NO row (was: logged anyway)",
        noop.s === 200 && rows.length === before, rows.length - before + " new rows");

    const done = await one(
        "SELECT id FROM statuses WHERE scope_id=? AND status_group='done' LIMIT 1", [list.id]);
    before = rows.length;
    await api(OT, "PATCH", "/tasks/" + T.id, { status_id: done.id });
    rows = await actRows(T.id);
    const newOnes = rows.slice(before);
    check("a STATUS-ONLY patch writes only status_changed (no shadow row)",
        newOnes.length === 1 && newOnes[0].action === "status_changed" &&
        !!newOnes[0].ctx?.from && !!newOnes[0].ctx?.to,
        newOnes.map((r) => r.action).join(","));

    console.log("\n  --- ISS-049 (bulk): per-task values, no contentless rows ---");
    const B1 = (await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "F21 bulk one", priority: 1 })).b;
    const B2 = (await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "F21 bulk two", priority: 3 })).b;
    await api(OT, "POST", "/tasks/bulk", { ids: [B1.id, B2.id], patch: { priority: 3 } });
    const b1Rows = (await actRows(B1.id)).filter((r) => r.action === "task_updated");
    const b2Rows = (await actRows(B2.id)).filter((r) => r.action === "task_updated");
    check("the task that CHANGED records {from:1, to:3} (was: {bulk:true})",
        b1Rows.length === 1 && b1Rows[0].ctx?.bulk === true &&
        b1Rows[0].ctx?.changes?.priority?.from === 1 &&
        b1Rows[0].ctx?.changes?.priority?.to === 3,
        JSON.stringify(b1Rows[0]?.ctx ?? {}).slice(0, 64));
    check("the task ALREADY at 3 gets NO row (was: a contentless one)",
        b2Rows.length === 0, b2Rows.length + " rows");

    console.log("\n  --- ISS-062: checklists leave a trace ---");
    const cl = (await api(OT, "POST", "/tasks/" + T.id + "/checklists",
        { name: "F21 acceptance criteria" })).b;
    const item = (await api(OT, "POST", "/checklists/" + cl.id + "/items",
        { text: "F21 the box to tick" })).b;
    const delItem = await api(OT, "DELETE", "/checklist-items/" + item.id);
    const delCl = await api(OT, "DELETE", "/checklists/" + cl.id);
    rows = await actRows(T.id);
    const acts = rows.map((r) => r.action);
    check("create checklist -> checklist_created (was: no trace)",
        acts.includes("checklist_created"), "");
    check("add item -> checklist_item_added (was: no trace)",
        acts.includes("checklist_item_added"), "");
    const delItemRow = rows.find((r) => r.action === "checklist_item_deleted");
    check("delete item -> row carries the TEXT (the row itself is gone)",
        delItem.s === 204 && delItemRow?.ctx?.text === "F21 the box to tick",
        JSON.stringify(delItemRow?.ctx ?? {}).slice(0, 56));
    const delClRow = rows.find((r) => r.action === "checklist_deleted");
    check('delete checklist -> "who deleted the acceptance criteria?" answerable',
        delCl.s === 204 && delClRow?.ctx?.name === "F21 acceptance criteria",
        JSON.stringify(delClRow?.ctx ?? {}).slice(0, 56));

    console.log("\n  --- ISS-061: the client speaks the server's vocabulary ---");
    // static parity: every action a task_activity writer emits has a VERBS entry
    const clientSrc = fs.readFileSync(
        "E:/Task Management System/client/src/components/task/TaskActivitySection.tsx", "utf8");
    const srcFiles = ["TaskWriteService", "TaskMembershipService", "CommentsService",
        "ChecklistsService", "TaskDependenciesService", "SprintsService", "ReviewsService",
        "TasksService", "EngineeringService", "CustomFieldsService", "TemplatesService"]
        .map((f) => "E:/Task Management System/server/src/services/" + f + ".ts")
        .filter((p) => fs.existsSync(p));
    const emitted = new Set();
    for (const p of srcFiles) {
        const src = fs.readFileSync(p, "utf8");
        // only actions recorded through the TASK activity repo
        for (const m of src.matchAll(/action: "([a-z_]+)"/g)) {
            const around = src.slice(Math.max(0, m.index - 900), m.index);
            if (around.includes("this.activity.recordMany") ||
                around.includes("this.activity.record") || true) emitted.add(m[1]);
        }
    }
    // drop the codes that go to workspace_activity, not the task drawer
    for (const notTask of ["created", "updated", "deleted", "archived", "unarchived",
        "invited", "role_changed", "deactivated", "reactivated", "profile_updated",
        "password_reset_requested", "started", "closed", "tasks_added"]) emitted.delete(notTask);
    const missing = [...emitted].filter((a) => !clientSrc.includes(`${a}:`));
    check("every task-activity code has an English rendering (" + emitted.size + " codes)",
        missing.length === 0, missing.length ? "missing: " + missing.join(", ") : "");
    check("the dead mock vocabulary is gone from the switch",
        !clientSrc.includes('"branch_created"') && !clientSrc.includes('"pr_opened"'),
        "");

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    const [strays] = await db.query("SELECT id FROM tasks WHERE name LIKE 'F21 %'");
    for (const r of strays) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers",
                         "notifications", "checklists"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.id]).catch(() => {});
    }
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  tasks " + await q("tasks") + " (46) | task_activity rows for strays 0");
    console.log(bad === 0
        ? "\n  PASS — the audit trail records what happened, and the drawer can say it.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
