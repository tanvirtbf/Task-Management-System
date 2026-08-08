#!/usr/bin/env node
/**
 * F1 — THE CLOCK PROBE
 *
 * The single before/after instrument for Block A (ISS-001, ISS-052, ISS-058, ISS-063, ISS-081).
 *
 * It answers one question per column: **when the application writes a known instant, does the
 * database hold that instant, and does the API give it back?**
 *
 * Three independent observations per write:
 *   asked  — the instant the caller intended (a JS Date, ISO)
 *   stored — what MySQL actually holds, read as a raw string (no driver conversion)
 *   wire   — what the API returns to a client
 *
 * A healthy system has drift 0 everywhere. Today the app-written columns drift by 6 hours
 * because Drizzle formats/parses TIMESTAMP as UTC while the MySQL session is +06:00.
 *
 * USAGE
 *   node fixing/evidence/F01/clock-probe.cjs               # against TZ=Asia/Dhaka (the dev default)
 *   TZ=UTC node fixing/evidence/F01/clock-probe.cjs        # the case that proves the fix is real
 *   node fixing/evidence/F01/clock-probe.cjs --json out.json
 *
 * REQUIREMENTS: an API on API_PORT (default 5711) pointed at DB_NAME (default taskmanagement).
 * Creates only TEST-F01-* rows and removes every one of them before exiting.
 */

const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");

const API_PORT = process.env.API_PORT || "5711";
const B = `http://127.0.0.1:${API_PORT}/api/v1`;
const DB = { host: "127.0.0.1", user: "root", password: "root", database: process.env.DB_NAME || "taskmanagement" };
const HOUR = 3600e3;

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;

const pad = (s, n) => String(s ?? "").padEnd(n);
const lpad = (s, n) => String(s ?? "").padStart(n);

/** A MySQL DATETIME string ("2026-07-30 16:02:07") is a WALL CLOCK with no zone. Parse it as
 *  Dhaka (+06:00) — the frame D2 chose — so it can be compared to a real instant. */
const storedAsInstant = (s) => (s ? new Date(s.replace(" ", "T") + "+06:00") : null);

/** Drift in hours between two instants, rounded to 2dp (so a 6.00 is unmistakable). */
const driftH = (a, b) => (a && b ? Math.round(((a.getTime() - b.getTime()) / HOUR) * 100) / 100 : null);

const results = [];
const record = (column, writtenBy, asked, stored, wire, note) => {
    const sInst = storedAsInstant(stored);
    const wInst = wire ? new Date(wire) : null;
    results.push({
        column, writtenBy,
        asked: asked ? asked.toISOString() : null,
        stored, wire,
        driftStored: asked && sInst ? driftH(sInst, asked) : null,   // DB vs intent
        driftWire: sInst && wInst ? driftH(wInst, sInst) : null,     // API vs DB
        note: note || "",
    });
};

(async () => {
    const db = await mysql.createConnection(DB);
    const OT = await login("owner@company.local");
    if (!OT) { console.error("FATAL: cannot log in — is the API up on " + API_PORT + "?"); process.exit(1); }

    // ── environment ──────────────────────────────────────────────────────────
    const [[tz]] = await db.query(
        "SELECT @@session.time_zone stz, @@global.time_zone gtz, CAST(NOW() AS CHAR) now_, CAST(UTC_TIMESTAMP() AS CHAR) utc_");
    const nowJs = new Date();
    console.log("=".repeat(100));
    console.log("F1 CLOCK PROBE   db=" + DB.database + "   api=:" + API_PORT + "   run=" + nowJs.toISOString());
    console.log("=".repeat(100));
    console.log("\n--- 1. THE SIX SETTINGS THAT MUST AGREE (plan §2) ---");
    const settings = [
        ["process TZ", process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone, "Asia/Dhaka"],
        ["MySQL session time_zone", tz.stz, "+06:00 or SYSTEM(=Dhaka)"],
        ["MySQL global time_zone", tz.gtz, "-"],
        ["MySQL NOW()", tz.now_, "= Dhaka wall clock"],
        ["MySQL UTC_TIMESTAMP()", tz.utc_, "= NOW() - 6h"],
        ["node new Date()", nowJs.toISOString(), "-"],
    ];
    settings.forEach(([k, v, want]) => console.log("  " + pad(k, 26) + pad(v, 34) + "expect: " + want));
    const nowGap = driftH(new Date(tz.now_.replace(" ", "T") + "+06:00"), nowJs);
    console.log("  " + pad("NOW() vs node clock", 26) + lpad(nowGap, 6) + " h   " +
        (Math.abs(nowGap) < 0.05 ? "AGREE" : "*** THE TWO CLOCKS DISAGREE ***"));

    // ── fixtures ─────────────────────────────────────────────────────────────
    // Seed-independent fixtures: never hardcode a demo space/list NAME here — the
    // demo DB gets re-seeded between phases and a stale name crashes the gate.
    const [[sp]] = await db.query(
        "SELECT id FROM spaces WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
    const tt = (await api(OT, "GET", "/task-types")).b.data.find((x) => x.name === "Task");
    const bugType = (await api(OT, "GET", "/task-types")).b.data.find((x) => x.name === "Bug");
    if (!sp || !tt || !bugType) {
        console.error("  fixtures missing (space=" + !!sp + " Task=" + !!tt + " Bug=" + !!bugType +
            ") — is the demo seed loaded?");
        process.exit(2);
    }
    const L = (await api(OT, "POST", "/lists", { space_id: sp.id, name: "TEST-F01-list", default_task_type_id: tt.id })).b;
    if (!L?.id) { console.error("  could not create the probe list:", JSON.stringify(L).slice(0, 200)); process.exit(2); }
    // any list that accepts a Bug — the probe writes its own bug tasks there
    const [[bugList]] = await db.query(
        "SELECT id FROM lists WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
    const [[arif]] = await db.query("SELECT id FROM users WHERE email='arif@beautybooth.com.bd'");
    const made = [];
    const mk = async (n, extra = {}, list = L.id) => { const r = await api(OT, "POST", "/tasks",
        { primary_list_id: list, name: "TEST-F01-" + n, ...extra }); if (r.b?.id) made.push(r.b.id); return r.b; };
    const one = async (sql, args) => (await db.query(sql, args))[0][0];

    console.log("\n--- 2. WRITE A KNOWN INSTANT, READ IT BACK THREE WAYS ---");
    console.log("  " + pad("column", 30) + pad("by", 8) + pad("asked (UTC)", 22) + pad("stored (raw SQL)", 21) +
        lpad("DB drift", 10) + lpad("wire drift", 11));
    console.log("  " + "-".repeat(100));

    // (a) tasks.sla_due_at — written by the app through PATCH /tasks/:id/sla
    {
        const T = await mk("sla", { bug_severity: "S2" }, bugList.id);
        const asked = new Date(Date.now() + 24 * HOUR);
        await api(OT, "PATCH", "/tasks/" + T.id + "/sla", { sla_due_at: asked.toISOString() });
        const row = await one("SELECT CAST(sla_due_at AS CHAR) v FROM tasks WHERE id=?", [T.id]);
        const wire = (await api(OT, "GET", "/tasks/" + T.id)).b.sla_due_at;
        record("tasks.sla_due_at", "app", asked, row.v, wire, "PATCH /tasks/:id/sla");
    }
    // (b) tasks.completed_at — set by the service when a task reaches a done status
    {
        const T = await mk("completed");
        const sts = (await api(OT, "GET", "/lists/" + L.id + "/statuses")).b;
        const done = (Array.isArray(sts) ? sts : sts.data).find((x) => x.status_group === "done");
        const at = new Date();
        await api(OT, "PATCH", "/tasks/" + T.id, { status_id: done.id });
        const row = await one("SELECT CAST(completed_at AS CHAR) v FROM tasks WHERE id=?", [T.id]);
        const wire = (await api(OT, "GET", "/tasks/" + T.id)).b.completed_at;
        record("tasks.completed_at", "app", at, row.v, wire, "set on status -> done");
    }
    // (c) tasks.archived_at
    {
        const T = await mk("archived");
        const at = new Date();
        await api(OT, "POST", "/tasks/" + T.id + "/archive");
        const row = await one("SELECT CAST(archived_at AS CHAR) v FROM tasks WHERE id=?", [T.id]);
        record("tasks.archived_at", "app", at, row.v, null, "POST /archive (not on the wire)");
        await api(OT, "POST", "/tasks/" + T.id + "/unarchive");
    }
    // (d) tasks.created_at — MySQL CURRENT_TIMESTAMP, the control
    {
        const at = new Date();
        const T = await mk("created");
        const row = await one("SELECT CAST(created_at AS CHAR) v FROM tasks WHERE id=?", [T.id]);
        const wire = (await api(OT, "GET", "/tasks/" + T.id)).b.created_at;
        record("tasks.created_at", "MySQL", at, row.v, wire, "CURRENT_TIMESTAMP default — the CONTROL");
    }
    // (e) tasks.updated_at — ISS-052: two writers, two clocks
    {
        const T = await mk("updated");
        const beforeWire = (await api(OT, "GET", "/tasks/" + T.id)).b.updated_at;
        await new Promise((r) => setTimeout(r, 1100));
        const at = new Date();
        await api(OT, "POST", "/tasks/" + T.id + "/assignees", { user_ids: [arif.id] });   // -> touchUpdatedAt (Drizzle)
        const rowA = await one("SELECT CAST(updated_at AS CHAR) v FROM tasks WHERE id=?", [T.id]);
        const wireA = (await api(OT, "GET", "/tasks/" + T.id)).b.updated_at;
        record("tasks.updated_at [assign]", "app", at, rowA.v, wireA, "touchUpdatedAt — Drizzle writes it");
        await new Promise((r) => setTimeout(r, 1100));
        const at2 = new Date();
        await api(OT, "PATCH", "/tasks/" + T.id, { priority: 2 });                          // -> MySQL ON UPDATE
        const rowB = await one("SELECT CAST(updated_at AS CHAR) v FROM tasks WHERE id=?", [T.id]);
        const wireB = (await api(OT, "GET", "/tasks/" + T.id)).b.updated_at;
        record("tasks.updated_at [patch]", "MySQL", at2, rowB.v, wireB, "ON UPDATE CURRENT_TIMESTAMP");
        // ISS-052's real acceptance test: a row can never have been UPDATED before it was CREATED.
        // The two columns have different writers (MySQL default vs Drizzle touchUpdatedAt), so on a
        // broken clock they land ~6h apart in whichever direction the last write came from.
        const T2 = await mk("monotonic");
        const created = (await one("SELECT CAST(created_at AS CHAR) v FROM tasks WHERE id=?", [T2.id])).v;
        await api(OT, "POST", "/tasks/" + T2.id + "/assignees", { user_ids: [arif.id] });   // Drizzle writes updated_at
        const updated = (await one("SELECT CAST(updated_at AS CHAR) v FROM tasks WHERE id=?", [T2.id])).v;
        const gap = driftH(storedAsInstant(updated), storedAsInstant(created));
        record("updated_at >= created_at ?", "-", null, null, null,
            gap >= 0 ? "yes (" + gap + "h)"
                : "*** NO — created " + created + ", then one assign set updated_at to " + updated +
                  " (" + gap + "h EARLIER than creation). ISS-052 ***");
        results[results.length - 1].iss052 = gap < 0;
    }
    // (f) comments.created_at (MySQL) + the 15-minute edit window (ISS-063)
    {
        const T = await mk("comment");
        const at = new Date();
        const c = (await api(OT, "POST", "/tasks/" + T.id + "/comments", { body: "TEST-F01 window" })).b;
        const row = await one("SELECT CAST(created_at AS CHAR) v FROM comments WHERE id=?", [c.id]);
        const wire = ((await api(OT, "GET", "/tasks/" + T.id + "/comments")).b || [])[0]?.created_at;
        record("comments.created_at", "MySQL", at, row.v, wire, "CURRENT_TIMESTAMP");
        // walk the window: how old can a comment be and still be editable?
        let lastOk = 0, firstNo = null;
        for (const m of [10, 16, 30, 60, 180, 360, 374, 375, 380]) {
            await db.query("UPDATE comments SET created_at = DATE_SUB(NOW(), INTERVAL ? MINUTE) WHERE id=?", [m, c.id]);
            const r = await api(OT, "PATCH", "/comments/" + c.id, { body: "TEST-F01 edited at -" + m });
            if (r.s === 200) lastOk = m; else if (firstNo === null) firstNo = m;
        }
        record("comment edit window", "-", null, null, null,
            "editable up to " + lastOk + " min, refused from " + firstNo + " min (intended: 15) — ISS-063");
    }
    // (g) notifications.snoozed_until — app-written
    {
        const T = await mk("notify");
        await api(OT, "POST", "/tasks/" + T.id + "/assignees", { user_ids: [arif.id] });
        const AT = await login("arif@beautybooth.com.bd");
        const n = ((await api(AT, "GET", "/notifications?limit=1")).b?.data || [])[0];
        if (n) {
            const asked = new Date(Date.now() + 5 * HOUR);
            await api(AT, "POST", "/notifications/" + n.id + "/snooze", { snoozed_until: asked.toISOString() });
            const row = await one("SELECT CAST(snoozed_until AS CHAR) v FROM notifications WHERE id=?", [n.id]);
            record("notifications.snoozed_until", "app", asked, row.v, null, "POST /snooze");
            await db.query("UPDATE notifications SET snoozed_until=NULL, is_read=0 WHERE id=?", [n.id]);
        }
    }
    // (h) sessions.expires_at — app-written, security-relevant
    {
        const at = new Date();
        const fresh = await login("arif@beautybooth.com.bd");
        const row = await one("SELECT CAST(expires_at AS CHAR) v, CAST(created_at AS CHAR) c FROM sessions ORDER BY created_at DESC LIMIT 1");
        record("sessions.expires_at", "app", null, row.v, null,
            "created_at=" + row.c + " (MySQL) — the two are written by different paths");
        record("sessions.created_at", "MySQL", at, row.c, null, "CURRENT_TIMESTAMP");
    }
    // (i) checklist_items.completed_at — app-written
    {
        const T = await mk("checklist");
        const cl = (await api(OT, "POST", "/tasks/" + T.id + "/checklists", { name: "TEST-F01 cl" })).b;
        const it = (await api(OT, "POST", "/checklists/" + cl.id + "/items", { text: "TEST-F01 item" })).b;
        const at = new Date();
        await api(OT, "POST", "/checklist-items/" + it.id + "/toggle");
        const row = await one("SELECT CAST(completed_at AS CHAR) v FROM checklist_items WHERE id=?", [it.id]);
        record("checklist_items.completed_at", "app", at, row.v, null, "POST /toggle");
    }
    // (j) DATE columns — the other half of ISS-001
    {
        const asked = "2026-08-10";
        const T = await mk("date", { due_date: asked, start_date: "2026-08-01" });
        const row = await one("SELECT CAST(due_date AS CHAR) d, CAST(start_date AS CHAR) s FROM tasks WHERE id=?", [T.id]);
        const w = (await api(OT, "GET", "/tasks/" + T.id)).b;
        results.push({ column: "tasks.due_date (DATE)", writtenBy: "app", asked, stored: row.d, wire: w.due_date,
            driftStored: row.d === asked ? 0 : "MISMATCH", driftWire: w.due_date === row.d ? 0 : "MISMATCH",
            note: "DATE has no zone — must round-trip byte-identically under ANY process TZ" });
        results.push({ column: "tasks.start_date (DATE)", writtenBy: "app", asked: "2026-08-01", stored: row.s, wire: w.start_date,
            driftStored: row.s === "2026-08-01" ? 0 : "MISMATCH", driftWire: w.start_date === row.s ? 0 : "MISMATCH", note: "" });
    }

    // ── report ───────────────────────────────────────────────────────────────
    for (const r of results) {
        if (r.asked === null && r.stored === null) { console.log("  " + pad(r.column, 30) + pad(r.writtenBy, 8) + r.note); continue; }
        console.log("  " + pad(r.column, 30) + pad(r.writtenBy, 8) +
            pad(r.asked ? String(r.asked).slice(0, 19).replace("T", " ") : "-", 22) +
            pad(r.stored ?? "-", 21) +
            lpad(r.driftStored === null ? "-" : (typeof r.driftStored === "number" ? r.driftStored.toFixed(2) + " h" : r.driftStored), 10) +
            lpad(r.driftWire === null ? "-" : (typeof r.driftWire === "number" ? r.driftWire.toFixed(2) + " h" : r.driftWire), 11) +
            (r.note ? "   " + r.note : ""));
    }

    console.log("\n--- 3. VERDICT ---");
    const drifted = results.filter((r) => typeof r.driftStored === "number" && Math.abs(r.driftStored) > 0.05);
    const wireDrifted = results.filter((r) => typeof r.driftWire === "number" && Math.abs(r.driftWire) > 0.05);
    const mismatch = results.filter((r) => r.driftStored === "MISMATCH" || r.driftWire === "MISMATCH");
    console.log("  columns whose STORED value differs from what was asked : " + drifted.length +
        (drifted.length ? "  -> " + drifted.map((d) => d.column + " (" + d.driftStored + "h)").join(", ") : ""));
    console.log("  columns whose WIRE value differs from what is stored   : " + wireDrifted.length +
        (wireDrifted.length ? "  -> " + wireDrifted.map((d) => d.column + " (" + d.driftWire + "h)").join(", ") : ""));
    console.log("  DATE columns that failed to round-trip                 : " + mismatch.length);
    const healthy = drifted.length === 0 && wireDrifted.length === 0 && mismatch.length === 0;
    console.log("\n  " + (healthy ? "PASS — every column round-trips with zero drift." :
        "FAIL — " + (drifted.length + wireDrifted.length + mismatch.length) + " observation(s) drift. This is ISS-001."));

    // ── cleanup ──────────────────────────────────────────────────────────────
    for (const id of made.reverse()) await api(OT, "DELETE", "/tasks/" + id + "?hard=true");
    const [ts] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F01%'");
    if (ts.length) { const tid = ts.map((r) => r.id);
        await db.query("DELETE FROM checklist_items WHERE checklist_id IN (SELECT id FROM checklists WHERE task_id IN (?))", [tid]);
        for (const t of ["checklists", "task_activity", "task_assignees", "task_watchers", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [tid]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [tid]);
        await db.query("DELETE FROM tasks WHERE id IN (?)", [tid]); }
    await api(OT, "POST", "/lists/" + L.id + "/archive"); await api(OT, "DELETE", "/lists/" + L.id);
    await db.query("DELETE FROM statuses WHERE scope_id=?", [L.id]);
    await db.query("DELETE FROM lists WHERE name LIKE 'TEST-F01%'");
    await db.query("DELETE FROM notifications WHERE entity_type='task' AND entity_id NOT IN (SELECT id FROM (SELECT id FROM tasks) x)");
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("\n--- 4. CLEANUP ---");
    // Parenthesised = the expected demo baseline. Re-set in F3 after the DB was
    // re-seeded (`ALLOW_DEMO_SEED=1 npm run db:seed:demo` + demo-role-accounts +
    // the department-report job). Update these together with the seed, or the
    // cleanup line reports a phantom leak.
    console.log("  tasks " + await q("tasks") + " (46) | lists " + await q("lists") + " (13) | statuses " + await q("statuses") +
        " (65) | comments " + await q("comments") + " (7) | notifications " + await q("notifications") + " (57)");

    const outIdx = process.argv.indexOf("--json");
    if (outIdx > -1 && process.argv[outIdx + 1]) {
        require("fs").writeFileSync(process.argv[outIdx + 1],
            JSON.stringify({ ranAt: nowJs.toISOString(), processTZ: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
                sessionTZ: tz.stz, healthy, results }, null, 1));
        console.log("  json -> " + process.argv[outIdx + 1]);
    }
    await db.end();
    process.exit(healthy ? 0 : 1);
})();
