// F5 — ISS-058: `workspaces.timezone` must actually decide "today".
//
// The issue's Expected line, verbatim: "changing the workspace timezone changes
// what 'due today' means." Before F5 it changed a string in a table.
//
// Deterministic at ANY wall-clock moment: Pacific/Kiritimati (UTC+14) and
// Pacific/Midway (UTC-11) are 25 hours apart, so at every instant at least one
// of them is on a different calendar day than Dhaka (UTC+6). For each zone the
// probe re-zones the workspace, plants tasks due on that zone's own today /
// yesterday / +3d, and asserts all three surfaces move together:
//   - GET /tasks/my-work        buckets (today / overdue / next)
//   - GET /home/kpis            dueToday + overdue counts
//   - GET /home/agenda          the no-param default date
// Then it proves THE SAME task changes bucket when only the timezone changes —
// the sentence the setting's UI has been silently promising all along.
//
// Restores timezone=Asia/Dhaka and the demo baseline. Exit 0 = ISS-058 closed.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
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

// today in an IANA zone — independent reimplementation (Intl, not the app's code)
const todayIn = (tz) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date());
    const g = (t) => p.find((x) => x.type === t).value;
    return g("year") + "-" + g("month") + "-" + g("day");
};
const addDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const OT = await login("owner@company.local");
    if (!OT) { console.error("  cannot log in"); process.exit(2); }
    const [[me]] = await db.query("SELECT id FROM users WHERE email='owner@company.local'");
    const [[list]] = await db.query("SELECT id FROM lists WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
    const made = [];
    const mk = async (n, due) => { const r = await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "TEST-F5-" + n, due_date: due });
        if (!r.b?.id) throw new Error("create failed: " + JSON.stringify(r.b).slice(0, 120));
        made.push(r.b.id);
        await api(OT, "POST", "/tasks/" + r.b.id + "/assignees", { user_ids: [me.id] });
        return r.b.id; };
    const setTz = async (tz) => {
        const r = await api(OT, "PATCH", "/workspace", { timezone: tz });
        if (r.s !== 200) throw new Error("PATCH /workspace tz=" + tz + " -> " + r.s + " " + JSON.stringify(r.b).slice(0, 120));
        return r.b?.timezone; };
    const bucketOf = async (id) => {
        const mw = await api(OT, "GET", "/tasks/my-work");
        const bk = mw.b?.data ?? mw.b ?? {};
        return Object.keys(bk).find((k) => Array.isArray(bk[k]) && bk[k].some((t) => t.id === id)) ?? "(none)"; };
    const kpis = async () => { const r = await api(OT, "GET", "/home/kpis");
        return { due: r.b?.dueToday?.value, over: r.b?.overdue?.value }; };
    const agendaHas = async (id) => { const r = await api(OT, "GET", "/home/agenda");
        const rows = Array.isArray(r.b) ? r.b : r.b?.data ?? []; return rows.some((t) => t.id === id); };

    const dhaka = todayIn("Asia/Dhaka"), kiri = todayIn("Pacific/Kiritimati"), mid = todayIn("Pacific/Midway");
    console.log("\n  === F5 — does workspaces.timezone decide `today`? (ISS-058) ===\n");
    console.log("  right now:  Dhaka " + dhaka + " · Kiritimati " + kiri + " · Midway " + mid);
    const differing = kiri !== dhaka ? "Pacific/Kiritimati" : "Pacific/Midway";
    console.log("  zone whose calendar differs from Dhaka at this instant: " + differing + "\n");

    // ── 1. each zone in turn: all three surfaces agree with that zone's calendar ─
    // The demo seed already contains owner-assigned tasks with real due dates,
    // so KPI assertions are DELTAS (before vs after planting the fixtures), and
    // agenda assertions are by task IDENTITY — both seed-proof.
    for (const tz of ["Asia/Dhaka", "Pacific/Kiritimati", "Pacific/Midway"]) {
        const echoed = await setTz(tz);
        const T = todayIn(tz);
        const k0 = await kpis();          // after re-zoning, before the fixtures
        const idT = await mk(tz.replace(/\W/g, "") + "-today", T);
        const idY = await mk(tz.replace(/\W/g, "") + "-yday", addDays(T, -1));
        const idN = await mk(tz.replace(/\W/g, "") + "-next", addDays(T, 3));
        const [bT, bY, bN] = [await bucketOf(idT), await bucketOf(idY), await bucketOf(idN)];
        const k = await kpis();
        const ag = await agendaHas(idT);
        console.log("  --- workspace timezone = " + tz + " (today there: " + T + ") ---");
        check("PATCH /workspace echoes the zone back", echoed === tz, echoed);
        check("due " + T + " → my-work bucket `today`", bT === "today", "got " + bT);
        check("due " + addDays(T, -1) + " → bucket `overdue`", bY === "overdue", "got " + bY);
        check("due " + addDays(T, 3) + " → bucket `next`", bN === "next", "got " + bN);
        check("home dueToday rose by exactly the 1 task due " + T, k.due === k0.due + 1,
            k0.due + " -> " + k.due);
        check("home overdue rose by exactly the 1 task due yesterday", k.over === k0.over + 1,
            k0.over + " -> " + k.over);
        check("agenda (no date param) defaults to " + tz + "'s today", ag, "");
        for (const id of [idT, idY, idN]) await api(OT, "DELETE", "/tasks/" + id + "?hard=true");
        console.log();
    }

    // ── 2. the sentence itself: one task, two zones, two buckets ────────────────
    console.log("  --- the same task, re-zoned: `due today` must change meaning ---");
    await setTz("Asia/Dhaka");
    const px = await mk("pivot", dhaka);                 // due = Dhaka's today
    const before = await bucketOf(px);
    const agB = await agendaHas(px);
    await setTz(differing);                              // only the timezone changes
    const after = await bucketOf(px);
    const agA = await agendaHas(px);
    const wantAfter = todayIn(differing) > dhaka ? "overdue" : "next";
    check("under Asia/Dhaka the task due " + dhaka + " is `today`", before === "today", "got " + before);
    check("…and today's agenda lists it", agB, "");
    check("under " + differing + " the SAME task is `" + wantAfter + "`", after === wantAfter, "got " + after);
    check("…and it has LEFT the default agenda", !agA, "");
    console.log("  -> changing the workspace timezone now changes what `due today` means.\n");

    // ── 3. restore + verify ─────────────────────────────────────────────────────
    const restored = await setTz("Asia/Dhaka");
    check("timezone restored to Asia/Dhaka", restored === "Asia/Dhaka", restored);
    for (const id of made) await api(OT, "DELETE", "/tasks/" + id + "?hard=true");
    const [left] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F5%'");
    if (left.length) { const ids = left.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]); }
    await db.query("DELETE FROM notifications WHERE entity_type='task' AND entity_id NOT IN (SELECT id FROM (SELECT id FROM tasks) x)");
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  cleanup: tasks " + await q("tasks") + " (46) | notifications " + await q("notifications") + " (57)");
    console.log(bad === 0 ? "\n  PASS — the timezone setting is no longer decorative. ISS-058 closed.\n"
                          : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad === 0 ? 0 : 1);
})();
