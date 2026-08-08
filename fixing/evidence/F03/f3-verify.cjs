// F3 — verify which Block A issues the clock fix actually closed.
const B = "http://127.0.0.1:5711/api/v1";
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const ok = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const pad = (s, n) => String(s).padEnd(n);
const verdict = (id, label, fixed, detail) =>
    console.log("  " + pad(id, 10) + pad(label, 46) + pad(fixed ? "FIXED" : "*** STILL BROKEN ***", 22) + (detail || ""));

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root", database: "taskmanagement" });
    const OT = await login("owner@company.local");
    if (!OT) { console.error("  cannot log in — API down?"); process.exit(1); }
    const [[bugList]] = await db.query("SELECT id FROM lists WHERE name='Bug Triage'");
    const [[bugType]] = await db.query("SELECT id FROM task_types WHERE name='Bug'");
    const made = [];
    const mk = async (n, extra = {}) => { const r = await ok(OT, "POST", "/tasks",
        { primary_list_id: bugList.id, name: "TEST-F3V-" + n, task_type_id: bugType.id, ...extra });
        if (r.b?.id) made.push(r.b.id); return r.b; };

    console.log("  === Block A issue verification, on the fixed clock ===\n");

    // ISS-001 — covered by the probe (exit 0). Restate the control here.
    const [[clk]] = await db.query("SELECT CAST(NOW() AS CHAR) n, @@session.time_zone tz");
    const T0 = await mk("iss001");
    const [[c0]] = await db.query("SELECT CAST(created_at AS CHAR) v FROM tasks WHERE id=?", [T0.id]);
    const wire0 = (await ok(OT, "GET", "/tasks/" + T0.id)).b.created_at;
    const drift001 = Math.abs(new Date(wire0) - new Date(c0.v.replace(" ", "T") + "Z")) / 3600e3;
    verdict("ISS-001", "timestamps round-trip with no drift", drift001 < 0.05,
        "stored " + c0.v + " -> wire " + wire0);

    // ISS-052 — updated_at must never precede created_at
    const T1 = await mk("iss052");
    const [[u1]] = await db.query("SELECT CAST(created_at AS CHAR) c FROM tasks WHERE id=?", [T1.id]);
    const [[arif]] = await db.query("SELECT id FROM users WHERE email='arif@beautybooth.com.bd'");
    await ok(OT, "POST", "/tasks/" + T1.id + "/assignees", { user_ids: [arif.id] });
    const [[u2]] = await db.query("SELECT CAST(updated_at AS CHAR) u FROM tasks WHERE id=?", [T1.id]);
    verdict("ISS-052", "updated_at >= created_at after an assign", u2.u >= u1.c,
        "created " + u1.c + " updated " + u2.u);

    // ISS-081 — an S0 must be created +120 min in the FUTURE, not -240
    const s0 = await mk("iss081-S0", { bug_severity: "S0" });
    const [[sla]] = await db.query(
        "SELECT TIMESTAMPDIFF(MINUTE, created_at, sla_due_at) m, (sla_due_at < NOW()) already FROM tasks WHERE id=?", [s0.id]);
    verdict("ISS-081a", "an S0 bug's SLA is +120 min, not already breached", sla.m >= 118 && sla.m <= 122 && !sla.already,
        "stored +" + sla.m + " min, already breached: " + !!sla.already);

    // ISS-081 (b) — the breach report and the view must agree, and minutes_breached must be true
    await db.query("UPDATE tasks SET sla_due_at = DATE_SUB(NOW(), INTERVAL 60 MINUTE) WHERE id=?", [s0.id]);
    const br = await ok(OT, "GET", "/sla/breached");
    const arr = Array.isArray(br.b) ? br.b : br.b?.data ?? [];
    const hit = arr.find((x) => x.task_id === s0.id);
    const [[vw]] = await db.query("SELECT COUNT(*) n FROM v_breached_sla WHERE id=?", [s0.id]);
    verdict("ISS-081b", "a 60-min-late task: endpoint reports ~60 min", !!hit && Math.abs(hit.minutes_breached - 60) <= 2,
        hit ? "minutes_breached=" + hit.minutes_breached + " (truth 60)" : "NOT LISTED");
    verdict("ISS-081c", "endpoint and v_breached_sla agree", (!!hit) === (vw.n === 1),
        "endpoint " + (hit ? "lists" : "omits") + " it, view " + (vw.n ? "lists" : "omits") + " it");

    // ISS-063 — the 15-minute comment edit window
    const [[mktList]] = await db.query("SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Marketing' AND l.archived_at IS NULL LIMIT 1");
    const T2 = (await ok(OT, "POST", "/tasks", { primary_list_id: mktList.id, name: "TEST-F3V-iss063" })).b;
    made.push(T2.id);
    const cm = (await ok(OT, "POST", "/tasks/" + T2.id + "/comments", { body: "TEST-F3V window" })).b;
    let lastOk = 0, firstNo = null;
    for (const m of [5, 10, 14, 16, 20, 60]) {
        await db.query("UPDATE comments SET created_at = DATE_SUB(NOW(), INTERVAL ? MINUTE) WHERE id=?", [m, cm.id]);
        const r = await ok(OT, "PATCH", "/comments/" + cm.id, { body: "TEST-F3V edited at -" + m });
        if (r.s === 200) lastOk = m; else if (firstNo === null) firstNo = m;
    }
    verdict("ISS-063", "the comment edit window is 15 min, not 6h15m", lastOk <= 15 && firstNo <= 16,
        "editable to " + lastOk + " min, refused from " + firstNo + " min");

    // ISS-058 — is workspaces.timezone read by anything yet? (expected: still NO — that is F5)
    const [[ws]] = await db.query("SELECT timezone FROM workspaces LIMIT 1");
    verdict("ISS-058", "workspaces.timezone drives 'today' (F5's job)", false,
        "still " + JSON.stringify(ws.timezone) + " and read by nothing — NOT in F3's scope");

    console.log("\n  === CLEANUP ===");
    for (const id of made.reverse()) await ok(OT, "DELETE", "/tasks/" + id + "?hard=true");
    const [ts] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F3V%'");
    if (ts.length) { const tid = ts.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [tid]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [tid]);
        await db.query("DELETE FROM tasks WHERE id IN (?)", [tid]); }
    await db.query("DELETE FROM notifications WHERE entity_type='task' AND entity_id NOT IN (SELECT id FROM (SELECT id FROM tasks) x)");
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  tasks " + await q("tasks") + " (46) | comments " + await q("comments") + " (7) | notifications " + await q("notifications"));
    await db.end(); process.exit(0);
})();
