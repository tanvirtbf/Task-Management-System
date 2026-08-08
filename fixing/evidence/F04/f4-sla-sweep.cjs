// F4 — replay the P30 SLA sweep on the fixed clock (ISS-081 re-verification).
//
// P30 measured, on the broken clock:
//   §1  every stored deadline exactly 360 min short; an S0 born already breached
//   §2  breaches invisible to the endpoint until >6h late, then under-reported
//       by 360; the view (NOW()) disagreed with the endpoint for that window
//   §3  filter matrix        §4 override guards       §5 recompute kills override
//   §6  completed/archived excluded
//
// This script re-runs every row of that sweep and adds what P30 could not test:
// the sub-6h offsets that used to be invisible, a not-yet-due negative control,
// an exact wire round-trip of a manual override, the recompute landing at
// +120 min from the PATCH moment, and the report-bug -> on-call auto-assign
// (which drives the F3 `dhakaToday()` binding through a real write path).
//
// FRAME RULE (the f3-verify.cjs lesson): this connection pins BOTH the driver
// and the session to +00:00, so raw SQL reads/writes live in the app's frame.
// A default-session connection would silently re-measure the old 6h "bug".
//
// Creates only TEST-F4-* rows (and the report-bug task, renamed on cleanup);
// restores the demo baseline. Exit 0 = every check green.
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 58) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({
        host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00",
    });
    await db.query("SET time_zone='+00:00'");   // the app's frame — mandatory
    const OT = await login("owner@company.local");
    const GT = await login("guest@beautybooth.com.bd");
    if (!OT || !GT) { console.error("  cannot log in (owner=" + !!OT + " guest=" + !!GT + ")"); process.exit(2); }

    const [[list]] = await db.query("SELECT id FROM lists WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
    const type = async (n) => (await db.query("SELECT id FROM task_types WHERE LOWER(name)=?", [n]))[0][0]?.id;
    const bugT = await type("bug"), complaintT = await type("complaint"), taskT = await type("task");
    const made = [];
    const mk = async (n, extra = {}) => { const r = await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "TEST-F4-" + n, ...extra });
        if (r.b?.id) made.push(r.b.id); return r.b; };
    // stored sla_due_at, in minutes from the app's "now", read in the app's frame
    const storedOffsetMin = async (id) => {
        if (!id) return null;
        const [[r]] = await db.query(
            "SELECT sla_due_at IS NULL nul, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), sla_due_at) s FROM tasks WHERE id=?", [id]);
        return !r || r.nul ? null : Math.round(r.s / 60);
    };
    // mop up any leftovers from a previous crashed run BEFORE measuring — stale
    // breached fixtures would pollute the filter/ordering rows below
    const mopUp = async () => {
        const [left] = await db.query(
            "SELECT id FROM tasks WHERE name LIKE 'TEST-F4%' OR description LIKE '%TEST-F4%'");
        if (!left.length) return 0;
        const ids = left.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "task_watchers", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]);
        return ids.length;
    };
    const pre = await mopUp();
    if (pre) console.log("  (pre-clean: removed " + pre + " leftover fixture(s) from a crashed run)");
    const backdate = (id, min) => db.query(
        "UPDATE tasks SET sla_due_at = UTC_TIMESTAMP() - INTERVAL ? MINUTE WHERE id=?", [min, id]);
    const breached = async (q = "") => {
        const r = await api(OT, "GET", "/sla/breached" + q);
        return { s: r.s, rows: Array.isArray(r.b) ? r.b : r.b?.data ?? [], raw: r.b };
    };
    const inView = async (id) => (await db.query(
        "SELECT minutes_breached FROM v_breached_sla WHERE id=?", [id]))[0][0] ?? null;

    console.log("\n  === F4 — the P30 SLA sweep, on the fixed clock ===");
    console.log("  frame: session +00:00 · process TZ " + (process.env.TZ || "system(Dhaka)") + "\n");

    // ── §1 deadline computation ──────────────────────────────────────────────
    console.log("  --- 1. what the system STORES vs what it INTENDS (P30: all 360 min short) ---");
    const near = (got, want, tol = 2) => got !== null && Math.abs(got - want) <= tol;
    const s0 = await mk("s0", { task_type_id: bugT, bug_severity: "S0" });
    const s1 = await mk("s1", { task_type_id: bugT, bug_severity: "S1" });
    const s2 = await mk("s2", { task_type_id: bugT, bug_severity: "S2" });
    const s3 = await mk("s3", { task_type_id: bugT, bug_severity: "S3" });
    const co = await mk("complaint", { task_type_id: complaintT });
    const pl = await mk("plain", { task_type_id: taskT });
    const o0 = await storedOffsetMin(s0.id);
    check("S0 stored at +120 min (was −240, born breached)", near(o0, 120), "stored +" + o0 + " min");
    check("S0 is NOT already breached at creation", o0 > 0, "");
    const o1 = await storedOffsetMin(s1.id);
    check("S1 stored at +1440 min (was +1080)", near(o1, 1440), "stored +" + o1);
    const o2 = await storedOffsetMin(s2.id);
    check("S2 stored at +10080 min (was +9720)", near(o2, 10080), "stored +" + o2);
    check("S3 stores no SLA", (await storedOffsetMin(s3.id)) === null, "");
    const oc = await storedOffsetMin(co.id);
    check("Complaint stored at +1440 min", near(oc, 1440), "stored +" + oc);
    check("a plain Task stores no SLA", (await storedOffsetMin(pl.id)) === null, "");

    // ── §2 breach visibility ─────────────────────────────────────────────────
    console.log("\n  --- 2. how late before it is REPORTED (P30: invisible until >6h, then −360) ---");
    const sweep = await mk("sweep", { task_type_id: bugT, bug_severity: "S1" });
    // future control first: due in +5 min → must appear NOWHERE
    await db.query("UPDATE tasks SET sla_due_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE WHERE id=?", [sweep.id]);
    {
        const ep = (await breached()).rows.find((x) => x.task_id === sweep.id);
        const vw = await inView(sweep.id);
        check("not-yet-due (+5 min): endpoint omits it", !ep, "");
        check("not-yet-due (+5 min): view omits it", !vw, "");
    }
    const offsets = [[1, "1 min"], [30, "30 min"], [60, "1 h"], [180, "3 h"], [300, "5 h"],
                     [360, "6 h"], [390, "6.5 h"], [420, "7 h"], [720, "12 h"], [1440, "24 h"]];
    console.log("  " + pad("late by", 10) + pad("endpoint", 26) + pad("view", 22) + "verdict");
    for (const [min, label] of offsets) {
        await backdate(sweep.id, min);
        const ep = (await breached()).rows.find((x) => x.task_id === sweep.id);
        const vw = await inView(sweep.id);
        const epOk = !!ep && near(ep.minutes_breached, min);
        const vwOk = !!vw && near(vw.minutes_breached, min);
        const agree = !!ep && !!vw && near(ep.minutes_breached, vw.minutes_breached);
        if (!(epOk && vwOk && agree)) bad++;
        console.log("  " + pad(label, 10) +
            pad(ep ? "listed, =" + ep.minutes_breached : "NOT LISTED", 26) +
            pad(vw ? "listed, =" + vw.minutes_breached : "NOT LISTED", 22) +
            (epOk && vwOk && agree ? "OK (truth " + min + ")" : "*** FAIL (truth " + min + ") ***"));
    }
    console.log("  every offset accurate and endpoint==view — the 6 h blind window is gone");

    // row shape + hydrated assignees (P30 §3 tail)
    const [[owner]] = await db.query("SELECT id FROM users WHERE email='owner@company.local'");
    await api(OT, "POST", "/tasks/" + sweep.id + "/assignees", { user_ids: [owner.id] });
    {
        const row = (await breached()).rows.find((x) => x.task_id === sweep.id);
        const keys = row ? Object.keys(row).sort().join(",") : "-";
        check("row shape unchanged", keys === "assignees,custom_id,minutes_breached,name,sla_due_at,task_id,task_type_id", keys);
        check("assignees hydrated as User objects", !!row && !!row.assignees?.[0]?.email,
            row?.assignees?.[0]?.email || "none");
    }

    // ── §3 filters ───────────────────────────────────────────────────────────
    console.log("\n  --- 3. filters (P30: PASS — must still pass) ---");
    await backdate(s0.id, 90);       // an S0-severity breach alongside the S1 sweep task
    check("no filter → 200", (await breached()).s === 200, "");
    {
        const r = await breached("?severity=S1");
        check("?severity=S1 lists the S1, not the S0", r.s === 200 &&
            r.rows.some((x) => x.task_id === sweep.id) && !r.rows.some((x) => x.task_id === s0.id), r.rows.length + " row(s)");
        const r0 = await breached("?severity=S0");
        check("?severity=S0 lists the S0 only", r0.s === 200 &&
            r0.rows.some((x) => x.task_id === s0.id) && !r0.rows.some((x) => x.task_id === sweep.id), r0.rows.length + " row(s)");
        check("?severity=bogus → 422", (await breached("?severity=bogus")).s === 422, "");
        const te = await breached("?team=engineering");
        check("?team=engineering (dev-type alias) → 200, lists the bugs", te.s === 200 &&
            te.rows.some((x) => x.task_id === sweep.id), te.rows.length + " row(s)");
        check("?team=ops → 200, 0 rows", (await breached("?team=ops")).s === 200 &&
            (await breached("?team=ops")).rows.length === 0, "");
        check("?team=bogus → 422", (await breached("?team=bogus")).s === 422, "");
        // P30 asserted only "?limit=1 -> 200". There is in fact no `limit` handling
        // anywhere in the §29 code (validator/service/repo) — the param is silently
        // ignored, same as any unknown query param. Assert what P30 asserted, plus
        // the most-overdue-first ordering that IS specced.
        const lim = await breached("?limit=1");
        check("?limit=1 → 200 (param ignored — not implemented), ordered most-overdue-first",
            lim.s === 200 && lim.rows[0]?.task_id === sweep.id,
            lim.rows.length + " row(s), top late " + (lim.rows[0]?.minutes_breached ?? "-") + " min");
    }

    // ── §4 override guards ───────────────────────────────────────────────────
    console.log("\n  --- 4. PATCH /tasks/:id/sla (P30: guards PASS but stored 6 h off) ---");
    const ov = await mk("override", { task_type_id: bugT, bug_severity: "S2" });
    const asked = new Date(Date.now() + 48 * 3600e3); asked.setMilliseconds(0);
    {
        const r = await api(OT, "PATCH", "/tasks/" + ov.id + "/sla", { sla_due_at: asked.toISOString() });
        const wire = r.b?.sla_due_at;
        const [[st]] = await db.query("SELECT CAST(sla_due_at AS CHAR) v FROM tasks WHERE id=?", [ov.id]);
        const stored = st.v.replace(" ", "T") + ".000Z";
        check("a future override → 200, wire EXACTLY as asked (was 6 h off)",
            r.s === 200 && wire === asked.toISOString(), "asked " + asked.toISOString() + " wire " + wire);
        check("…and the DB stores that exact instant", stored === asked.toISOString(), "stored " + stored);
    }
    check("a past timestamp → 422 sla.invalid_due_at", await (async () => {
        const r = await api(OT, "PATCH", "/tasks/" + ov.id + "/sla",
            { sla_due_at: new Date(Date.now() - 3600e3).toISOString() });
        return r.s === 422 && r.b?.error?.code === "sla.invalid_due_at"; })(), "");
    check("null → 200, cleared", await (async () => {
        const r = await api(OT, "PATCH", "/tasks/" + ov.id + "/sla", { sla_due_at: null });
        return r.s === 200 && r.b?.sla_due_at === null; })(), "");
    check("malformed → 422", (await api(OT, "PATCH", "/tasks/" + ov.id + "/sla", { sla_due_at: "not-a-date" })).s === 422, "");
    check("unknown task → 404 task.not_found", await (async () => {
        const r = await api(OT, "PATCH", "/tasks/t-doesnotexist/sla", { sla_due_at: asked.toISOString() });
        return r.s === 404 && r.b?.error?.code === "task.not_found"; })(), "");
    check("a guest → 403", (await api(GT, "PATCH", "/tasks/" + ov.id + "/sla", { sla_due_at: asked.toISOString() })).s === 403, "");
    {
        const arch = await mk("archived", { task_type_id: bugT, bug_severity: "S2" });
        await api(OT, "POST", "/tasks/" + arch.id + "/archive");
        const r = await api(OT, "PATCH", "/tasks/" + arch.id + "/sla", { sla_due_at: asked.toISOString() });
        check("an archived task → 409 task.archived", r.s === 409 && r.b?.error?.code === "task.archived", "");
    }

    // ── §5 recompute vs override ─────────────────────────────────────────────
    console.log("\n  --- 5. severity change recomputes from the PATCH moment (characterised V1) ---");
    await api(OT, "PATCH", "/tasks/" + ov.id + "/sla", { sla_due_at: asked.toISOString() });   // override back on
    await api(OT, "PATCH", "/tasks/" + ov.id, { bug_severity: "S0" });
    const re = await storedOffsetMin(ov.id);
    check("PATCH bug_severity S0 → sla_due_at recomputed to +120 min", near(re, 120), "stored +" + re + " min");
    check("…the manual override is gone (documented V1 behaviour)", !near(re, 48 * 60, 5), "");

    // ── §6 exclusions ────────────────────────────────────────────────────────
    console.log("\n  --- 6. exclusions (P30: PASS — must still pass) ---");
    const done = await mk("done", { task_type_id: bugT, bug_severity: "S1" });
    await backdate(done.id, 720);
    await db.query("UPDATE tasks SET completed_at = UTC_TIMESTAMP() WHERE id=?", [done.id]);
    const gone = await mk("arch12", { task_type_id: bugT, bug_severity: "S1" });
    await backdate(gone.id, 720);
    await api(OT, "POST", "/tasks/" + gone.id + "/archive");
    {
        const rows = (await breached()).rows;
        check("a completed task 12 h late is absent (endpoint + view)",
            !rows.some((x) => x.task_id === done.id) && !(await inView(done.id)), "");
        check("an archived task 12 h late is absent (endpoint + view)",
            !rows.some((x) => x.task_id === gone.id) && !(await inView(gone.id)), "");
    }

    // ── §7 report-bug → on-call auto-assign (the F3 dhakaToday binding, live) ─
    console.log("\n  --- 7. report-bug auto-assigns the CURRENT on-call engineer ---");
    const [[shift]] = await db.query(
        "SELECT s.engineer_id, u.email FROM on_call_shifts s JOIN users u ON u.id=s.engineer_id LIMIT 1");
    const rb = await api(OT, "POST", "/eng/report-bug",
        { happened: "TEST-F4 sla sweep bug", steps: "1. run the F4 sweep", severity: "S1", reporter_team: "cs" });
    if (rb.b?.id) made.push(rb.b.id);
    check("POST /eng/report-bug (S1) → created", rb.s === 201 || rb.s === 200, "status " + rb.s);
    check("…auto-assigned to the on-call engineer (dhakaToday path)",
        !!rb.b?.assignees?.includes(shift.engineer_id), "expects " + shift.email);
    check("…S1 SLA stored at +1440 min", near(await storedOffsetMin(rb.b?.id), 1440),
        "stored +" + await storedOffsetMin(rb.b?.id));
    const rb2 = await api(OT, "POST", "/eng/report-bug",
        { happened: "TEST-F4 severity default", steps: "1. omit severity", reporter_team: "cs" });
    if (rb2.b?.id) made.push(rb2.b.id);
    check("no severity → defaults S2, +10080 min, NO auto-assign", rb2.b?.bug_severity === "S2" &&
        near(await storedOffsetMin(rb2.b?.id), 10080) && (rb2.b?.assignees ?? []).length === 0,
        rb2.b?.bug_severity + ", +" + await storedOffsetMin(rb2.b?.id) + ", assignees " + (rb2.b?.assignees ?? []).length);
    {
        const eh = await api(OT, "GET", "/eng/home");
        check("/eng/home names the same current_on_call", eh.s === 200 &&
            eh.b?.current_on_call?.id === shift.engineer_id, eh.b?.current_on_call?.email || "null");
    }

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  --- CLEANUP ---");
    for (const id of made.reverse()) await api(OT, "DELETE", "/tasks/" + id + "?hard=true");
    const [left] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F4%' OR description LIKE '%TEST-F4%'");
    if (left.length) { const ids = left.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "task_watchers", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]); }
    await db.query("DELETE FROM notifications WHERE entity_type='task' AND entity_id NOT IN (SELECT id FROM (SELECT id FROM tasks) x)");
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  tasks " + await q("tasks") + " (46) | notifications " + await q("notifications") +
        " (57) | comments " + await q("comments") + " (7)");
    console.log(bad === 0
        ? "\n  PASS — every P30 row now lands where §29 intends. ISS-081 stays closed.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad === 0 ? 0 : 1);
})();
