// F19 — the notification system: ISS-064 + ISS-072, decisions D6–D8.
//
// Counting is DELTA-based (count before, produce, count after) with no
// timestamp binding anywhere — the first cut filtered on a bound JS Date and
// misread same-second rows. A short settle follows every producing call.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const fs = require("node:fs");
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 300); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const settle = () => new Promise((r) => setTimeout(r, 350));
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
    const TOKEN = fs.readFileSync("E:/Task Management System/server/.env", "utf8")
        .split(/\r?\n/).find((l) => l.startsWith("INTERNAL_JOB_TOKEN="))?.slice(19).trim();
    const [[owner]] = await db.query("SELECT id FROM users WHERE email='owner@company.local'");
    const [[arif]] = await db.query("SELECT id FROM users WHERE email LIKE 'arif@%'");
    const [[watcher]] = await db.query(
        "SELECT id, email, first_name FROM users WHERE email LIKE 'nusrat@%' LIMIT 1");
    const arifT = await login("arif@beautybooth.com.bd");
    const watcherT = await login(watcher.email);
    const baseNotif = (await one("SELECT COUNT(*) n FROM notifications")).n;

    const cnt = async (userId, type) => (await one(
        "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND type=?", [userId, type])).n;
    const snap = async (pairs) => {
        const out = {};
        for (const [name, uid, type] of pairs) out[name] = await cnt(uid, type);
        return out;
    };

    console.log("\n  === F19 — the notification system (D6-D8) ===\n");

    console.log("  --- 1. the surface: 7 types, no email channel ---");
    const [tcol] = await db.query(
        "SELECT column_type FROM information_schema.columns WHERE table_schema='taskmanagement' AND table_name='notifications' AND column_name='type'");
    const enumStr = tcol[0].COLUMN_TYPE ?? tcol[0].column_type;
    const enumCount = (enumStr.match(/'/g) || []).length / 2;
    check("notifications.type enum has 7 values (was 12)", enumCount === 7, enumCount + " values");
    const goneOk = ["due_soon", "overdue", "automation_failed", "pr_review", "incident_alert"]
        .every((g) => !enumStr.includes("'" + g + "'"));
    check("all five producerless types are gone from the enum", goneOk, "");
    const [ecol] = await db.query(
        "SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema='taskmanagement' AND table_name='user_notification_prefs' AND column_name='email_enabled'");
    check("user_notification_prefs.email_enabled column is GONE", ecol[0].n === 0, "");

    const prefs = await api(arifT, "GET", "/notifications/preferences");
    check("GET /preferences: exactly 7 types, no email_enabled anywhere",
        prefs.s === 200 && Object.keys(prefs.b ?? {}).length === 7 &&
        !JSON.stringify(prefs.b ?? {}).includes("email_enabled"),
        Object.keys(prefs.b ?? {}).length + " types");
    const putEmail = await api(arifT, "PUT", "/notifications/preferences",
        { comment: { in_app_enabled: true, email_enabled: false } });
    check("PUT with email_enabled -> 422 naming the removal",
        putEmail.s === 422 && JSON.stringify(putEmail.b).includes("email channel was removed"),
        "got " + putEmail.s);
    const putGone = await api(arifT, "PUT", "/notifications/preferences",
        { due_soon: { in_app_enabled: false } });
    check("PUT with a REMOVED type -> 422 unknown type", putGone.s === 422, "got " + putGone.s);

    // ── fixture ──────────────────────────────────────────────────────────────
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const T = (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name: "F19 notif task" })).b;
    let pre = await snap([["a_asg", arif.id, "assigned"]]);
    await api(OT, "POST", "/tasks/" + T.id + "/assignees", { user_ids: [arif.id] });
    const w = await api(watcherT, "POST", "/tasks/" + T.id + "/watchers/self");
    await settle();
    check("fixture: arif assigned (notified) + a watcher",
        (w.s === 204 || w.s === 200 || w.s === 201) &&
        (await cnt(arif.id, "assigned")) === pre.a_asg + 1, "watch " + w.s);

    console.log("\n  --- 2. ISS-064: a plain comment notifies the attached people ---");
    pre = await snap([["a", arif.id, "comment"], ["w", watcher.id, "comment"], ["o", owner.id, "comment"]]);
    const c1 = await api(OT, "POST", "/tasks/" + T.id + "/comments",
        { body: "F19 plain comment, no mentions" });
    await settle();
    check("comment 201 -> ASSIGNEE got type=comment",
        c1.s === 201 && (await cnt(arif.id, "comment")) === pre.a + 1, "got " + c1.s);
    check("…WATCHER got type=comment too", (await cnt(watcher.id, "comment")) === pre.w + 1, "");
    check("…the AUTHOR did not", (await cnt(owner.id, "comment")) === pre.o, "");

    // mention the WATCHER: they must get `mentioned` and NOT a second `comment`
    pre = await snap([["wm", watcher.id, "mentioned"], ["wc", watcher.id, "comment"],
                      ["ac", arif.id, "comment"]]);
    const c2 = await api(OT, "POST", "/tasks/" + T.id + "/comments",
        { body: "F19 hello @" + watcher.first_name + " please look" });
    await settle();
    check("a MENTIONED watcher gets `mentioned` only, never both",
        c2.s === 201 && (await cnt(watcher.id, "mentioned")) === pre.wm + 1 &&
        (await cnt(watcher.id, "comment")) === pre.wc,
        "mentioned +" + ((await cnt(watcher.id, "mentioned")) - pre.wm) +
        ", comment +" + ((await cnt(watcher.id, "comment")) - pre.wc));
    check("…while the (unmentioned) assignee still gets `comment`",
        (await cnt(arif.id, "comment")) === pre.ac + 1, "");

    console.log("\n  --- 3. the status_change producer ---");
    const done = await one(
        "SELECT id, name FROM statuses WHERE scope_id=? AND status_group='done' LIMIT 1", [list.id]);
    pre = await snap([["a", arif.id, "status_change"], ["w", watcher.id, "status_change"],
                      ["o", owner.id, "status_change"]]);
    const up = await api(OT, "PATCH", "/tasks/" + T.id, { status_id: done.id });
    await settle();
    check("status change 200 -> assignee notified",
        up.s === 200 && (await cnt(arif.id, "status_change")) === pre.a + 1, "got " + up.s);
    check("…watcher too", (await cnt(watcher.id, "status_change")) === pre.w + 1, "");
    check("…the actor not", (await cnt(owner.id, "status_change")) === pre.o, "");
    const [[lastN]] = await db.query(
        "SELECT title FROM notifications WHERE user_id=? AND type='status_change' ORDER BY internal_id DESC LIMIT 1", [arif.id]);
    check("the title names the task and the status",
        /moved "F19 notif task" to /.test(lastN?.title ?? ""), (lastN?.title ?? "").slice(0, 48));

    console.log("\n  --- 4. D7: preferences actually suppress ---");
    const off = await api(arifT, "PUT", "/notifications/preferences",
        { comment: { in_app_enabled: false } });
    check("arif turns `comment` OFF (200)", off.s === 200 && off.b?.comment?.in_app_enabled === false,
        "got " + off.s);
    pre = await snap([["a", arif.id, "comment"], ["w", watcher.id, "comment"]]);
    await api(OT, "POST", "/tasks/" + T.id + "/comments", { body: "F19 while arif is off" });
    await settle();
    check("new comment -> arif got NOTHING (was: toggle stored and ignored)",
        (await cnt(arif.id, "comment")) === pre.a, "delta " + ((await cnt(arif.id, "comment")) - pre.a));
    check("…but the watcher (still on) DID get it",
        (await cnt(watcher.id, "comment")) === pre.w + 1, "");
    const on = await api(arifT, "PUT", "/notifications/preferences",
        { comment: { in_app_enabled: true } });
    pre = await snap([["a", arif.id, "comment"]]);
    await api(OT, "POST", "/tasks/" + T.id + "/comments", { body: "F19 after arif is back on" });
    await settle();
    check("toggle back ON -> it flows again",
        on.s === 200 && (await cnt(arif.id, "comment")) === pre.a + 1, "");

    console.log("\n  --- 5. every surviving type, produced live ---");
    // assigned / mentioned / comment / status_change: proven above with deltas.
    // form_submitted -> the form creator
    pre = await snap([["o", owner.id, "form_submitted"]]);
    const form = (await api(OT, "POST", "/forms", { list_id: list.id, title: "F19 intake" })).b;
    await api(OT, "POST", "/forms/" + form.id + "/fields",
        { field_kind: "task_attr", field_key: "name", label: "What?" });
    await fetch(B + "/public/forms/" + form.public_slug + "/submit", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { name: "F19 submitted task" } }) });
    await settle();
    check("form_submitted produced (public submit -> creator)",
        (await cnt(owner.id, "form_submitted")) === pre.o + 1, "");
    // task_reviewed -> the assignees
    const [[csHead]] = await db.query(
        "SELECT u.email FROM spaces s JOIN users u ON u.id=s.head_user_id WHERE s.name='Customer Service'");
    const headT = await login(csHead.email);
    pre = await snap([["a", arif.id, "task_reviewed"]]);
    const rev = await api(headT, "POST", "/tasks/" + T.id + "/review", { status: "approved" });
    await settle();
    check("task_reviewed produced (head approves -> assignee)",
        rev.s === 201 && (await cnt(arif.id, "task_reviewed")) === pre.a + 1, "rev " + rev.s);
    // report_ready — free ONE space's last-week slot, run the real job, and the
    // regeneration both proves the producer AND restores the report baseline.
    const [[mkt]] = await db.query("SELECT id, head_user_id FROM spaces WHERE name='Marketing'");
    const [[oldRep]] = await db.query(
        "SELECT id FROM department_reports WHERE space_id=? ORDER BY week_start DESC LIMIT 1", [mkt.id]);
    await db.query("DELETE FROM department_reports WHERE id=?", [oldRep.id]);
    pre = await snap([["h", mkt.head_user_id, "report_ready"]]);
    const job = await j(await fetch(B + "/jobs/department-report", { method: "POST",
        headers: { "X-Internal-Token": TOKEN } }));
    await settle();
    check("report_ready produced (the real weekly job, regenerated slot)",
        job.ok === true && (await cnt(mkt.head_user_id, "report_ready")) === pre.h + 1,
        "generated " + (job.generated ?? "?"));

    // ── cleanup — id-anchored, no timestamp windows ──────────────────────────
    console.log("\n  === CLEANUP ===");
    await db.query("DELETE FROM user_notification_prefs WHERE user_id=?", [arif.id]).catch(() => {});
    await db.query("DELETE FROM form_submissions WHERE form_id=?", [form.id]).catch(() => {});
    await db.query("DELETE FROM form_fields WHERE form_id=?", [form.id]).catch(() => {});
    await db.query("DELETE FROM forms WHERE id=?", [form.id]).catch(() => {});
    const [strays] = await db.query(
        "SELECT id FROM tasks WHERE name LIKE 'F19 %'");
    for (const r of strays) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers",
                         "notifications", "task_reviews"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.id]).catch(() => {});
    }
    // every notification this run added beyond the baseline, newest-first
    const nowNotif = (await one("SELECT COUNT(*) n FROM notifications")).n;
    if (nowNotif > baseNotif) {
        await db.query(
            "DELETE FROM notifications ORDER BY internal_id DESC LIMIT " + (nowNotif - baseNotif));
    }
    await db.query(
        "DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  tasks " + await q("tasks") + " (46) | notif " + await q("notifications") +
        " (" + baseNotif + ") | reports " + await q("department_reports") + " (12) | forms " +
        await q("forms") + " (0) | prefs " + await q("user_notification_prefs") + " (0)");
    console.log(bad === 0
        ? "\n  PASS — 7 real types, all producible; preferences finally govern delivery.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
