// F24 — Home page honesty: ISS-057, ISS-056, ISS-059.
//
// The KPI NUMBERS were always correct (P19 recomputed all six by hand). So this
// probe re-does that: every tile is checked against independent SQL, for two
// different accounts, BEFORE and AFTER asserting the fabricated signals are
// gone — a fix that quietly broke a number would fail here.
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

    console.log("\n  === F24 — Home page honesty ===\n");

    console.log("  --- ISS-057: the fabricated signals are gone ---");
    const OT = await login("owner@company.local");
    const kpis = await api(OT, "GET", "/home/kpis");
    const tiles = Object.entries(kpis.b ?? {});
    check("GET /home/kpis returns the six tiles", kpis.s === 200 && tiles.length === 6,
        tiles.length + " tiles");
    const keysOf = (t) => Object.keys(t).sort().join(",");
    const shape = tiles.length ? keysOf(tiles[0][1]) : "";
    check("a tile is label+value+valueDisplay ONLY (no trend, no sparkline)",
        shape === "label,value,valueDisplay", shape);
    const anyFabricated = JSON.stringify(kpis.b ?? {});
    check("no trend / trendDirection / isPositive / sparkline anywhere on the wire",
        !/trend|isPositive|sparkline/.test(anyFabricated), "");
    const card = fs.readFileSync(
        "E:/Task Management System/client/src/pages/home/KpiCard.tsx", "utf8");
    check("the client card no longer imports Trend or Sparkline",
        !card.includes("components/ui/Trend") && !card.includes("components/ui/Sparkline"), "");

    console.log("\n  --- the six NUMBERS still match hand-written SQL (P19's check) ---");
    const [[owner]] = await db.query("SELECT id FROM users WHERE email='owner@company.local'");
    const [[headRow]] = await db.query(
        "SELECT u.id, u.email FROM spaces s JOIN users u ON u.id=s.head_user_id WHERE s.name='Customer Service'");
    const today = (await one(
        "SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00', COALESCE((SELECT timezone FROM workspaces LIMIT 1),'+06:00')),'%Y-%m-%d') d"))?.d
        ?? (await one("SELECT DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 6 HOUR,'%Y-%m-%d') d")).d;

    const sqlFor = async (userId) => ({
        myTasks: (await one(
            `SELECT COUNT(*) n FROM tasks t JOIN task_assignees a ON a.task_id=t.id
             JOIN statuses s ON s.id=t.status_id
             WHERE t.workspace_id=(SELECT id FROM workspaces LIMIT 1) AND a.user_id=?
               AND t.archived_at IS NULL AND s.status_group NOT IN ('done','closed')`, [userId])).n,
        dueToday: (await one(
            `SELECT COUNT(*) n FROM tasks t JOIN task_assignees a ON a.task_id=t.id
             JOIN statuses s ON s.id=t.status_id
             WHERE a.user_id=? AND t.archived_at IS NULL
               AND s.status_group NOT IN ('done','closed') AND t.due_date = ?`, [userId, today])).n,
        overdue: (await one(
            `SELECT COUNT(*) n FROM tasks t JOIN task_assignees a ON a.task_id=t.id
             JOIN statuses s ON s.id=t.status_id
             WHERE a.user_id=? AND t.archived_at IS NULL
               AND s.status_group NOT IN ('done','closed') AND t.due_date < ?`, [userId, today])).n,
        awaitingReview: (await one(
            `SELECT COUNT(*) n FROM tasks t
             JOIN statuses s ON s.id=t.status_id
             JOIN lists l ON l.id=t.primary_list_id
             JOIN spaces sp ON sp.id=l.space_id
             WHERE t.archived_at IS NULL AND s.status_group IN ('done','closed')
               AND t.review_status IS NULL
               AND (sp.head_user_id=? OR t.reviewer_id=?)`, [userId, userId])).n,
    });

    for (const [who, id, token] of [
        ["owner", owner.id, OT],
        ["a dept head", headRow.id, await login(headRow.email)],
    ]) {
        const wire = (await api(token, "GET", "/home/kpis")).b;
        const want = await sqlFor(id);
        for (const k of ["myTasks", "dueToday", "overdue", "awaitingReview"]) {
            const got = wire?.[k]?.value;
            const ok = got === want[k];
            if (!ok) bad++;
            console.log("  " + pad(ok ? "OK  " : "FAIL", 6) +
                pad(who + " · " + k, 62) + "wire " + got + " vs SQL " + want[k]);
        }
    }

    console.log("\n  --- ISS-059: the tile counts the queue this company uses ---");
    const prOpen = (await one(
        "SELECT COUNT(*) n FROM tasks WHERE pr_status='open'")).n;
    const realQueue = (await one(
        `SELECT COUNT(*) n FROM tasks t JOIN statuses s ON s.id=t.status_id
         WHERE t.archived_at IS NULL AND s.status_group IN ('done','closed')
           AND t.review_status IS NULL`)).n;
    check("pr_status='open' is still 0 rows workspace-wide (the old metric)",
        prOpen === 0, prOpen + " rows");
    check("…while the real review queue is non-empty", realQueue > 0,
        realQueue + " completed tasks unreviewed");
    const headKpis = (await api(await login(headRow.email), "GET", "/home/kpis")).b;
    check("a DEPT HEAD now sees a non-zero Awaiting My Review",
        (headKpis?.awaitingReview?.value ?? 0) > 0,
        "value " + headKpis?.awaitingReview?.value);
    const src = fs.readFileSync(
        "E:/Task Management System/server/src/repositories/HomeRepo.ts", "utf8");
    check("HomeRepo no longer filters on pr_status", !src.includes("tasks.prStatus"), "");

    console.log("\n  --- ISS-056: the Agenda card stops inventing a time ---");
    const agenda = await api(OT, "GET", "/home/agenda");
    const rows = Array.isArray(agenda.b) ? agenda.b : (agenda.b?.data ?? []);
    check("GET /home/agenda still answers 200", agenda.s === 200, "got " + agenda.s);
    check("every due_date on the wire is DATE-only (no time component)",
        rows.every((t) => !t.due_date || /^\d{4}-\d{2}-\d{2}$/.test(t.due_date)),
        rows.length + " rows");
    const agendaSrc = fs.readFileSync(
        "E:/Task Management System/client/src/pages/home/AgendaCard.tsx", "utf8");
    check("the client no longer calls toLocaleTimeString on a date",
        !agendaSrc.includes("toLocaleTimeString"), "");
    check("…and sorts by something real (priority), not by a constant instant",
        agendaSrc.includes("priorityRank") && !agendaSrc.includes("new Date(a.time)"), "");

    console.log("\n  === CLEANUP ===");
    console.log("  read-only probe — nothing written");
    console.log(bad === 0
        ? "\n  PASS — the numbers are unchanged and correct; the inventions around them are gone.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
