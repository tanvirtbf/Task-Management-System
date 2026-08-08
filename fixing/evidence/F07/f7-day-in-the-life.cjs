// F7 — the P39 "BeautyBooth day-in-the-life" re-run, on the fully gated tree.
//
// P39 scored 22/22 on the ungated build. This replays all eight scenarios as
// the same cast (owner, department heads, engineers, a department-only user, a
// guest-of-sorts) and asserts a superset of the original lines. It is the
// plan's "nobody lost their job function" check: every step that used to
// return 2xx must STILL return 2xx now that 34 routes are gated and 6 services
// compose — because the seeded grants were built to reproduce today exactly.
//
// ISS-025 protocol (same as P39): the two form_submissions columns are ADDED
// for the public-form scenario and DROPPED again afterwards, so the
// deliberately-preserved dev drift (rule X9) stays reproducible.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 300); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const pub = async (m, p, b) => { const r = await fetch(B + p, { method: m,
    headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
    return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const pad = (s, n) => String(s).padEnd(n);
let ok = 0, bad = 0;
const step = (label, pass, detail) => { pass ? ok++ : bad++;
    console.log("  " + pad(pass ? "OK  " : "FAIL", 6) + pad(label, 62) + (detail ?? "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00", multipleStatements: false });
    await db.query("SET time_zone='+00:00'");

    // ── cast + fixtures resolved from the live demo DB ───────────────────────
    const [[owner]] = await db.query("SELECT * FROM users WHERE email='owner@company.local'");
    const heads = {};
    const [hs] = await db.query(
        "SELECT s.id sid, s.name sname, u.email FROM spaces s JOIN users u ON u.id=s.head_user_id");
    for (const h of hs) heads[h.sname] = { spaceId: h.sid, email: h.email };
    const listIn = async (sname) => (await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name=? AND l.archived_at IS NULL ORDER BY l.created_at LIMIT 1",
        [sname]))[0][0]?.id;
    const statusOf = async (listId, group) => (await db.query(
        "SELECT id FROM statuses WHERE scope_id=? AND status_group=? LIMIT 1", [listId, group]))[0][0]?.id;
    const typeId = async (n) => (await db.query(
        "SELECT id FROM task_types WHERE LOWER(name)=?", [n]))[0][0]?.id;
    const [[arif]] = await db.query("SELECT id FROM users WHERE email LIKE 'arif@%'");
    const [[jhankar]] = await db.query("SELECT id, email FROM users WHERE email LIKE 'jhankar@%'");

    const OT = await login("owner@company.local");
    const csHeadT = await login(heads["Customer Service"].email);
    const ofHeadT = await login(heads["Orders & Fulfillment"].email);
    const invHeadT = await login(heads["Product & Inventory"].email);
    const mktHeadT = await login(heads["Marketing"].email);
    const engHeadT = await login(heads["Engineering"].email);
    const arifT = await login("arif@beautybooth.com.bd");
    const jhankarT = await login(jhankar.email);
    const madeTasks = [];
    const track = (r) => { if (r?.b?.id) madeTasks.push(r.b.id); return r; };

    console.log("\n  === F7 — day-in-the-life re-run (P39 was 22/22 on the ungated build) ===");

    // ── ISS-025 columns ON (X9: restored at the end) ─────────────────────────
    await db.query("ALTER TABLE form_submissions ADD COLUMN encrypted_at TIMESTAMP NULL DEFAULT NULL").catch(() => {});
    await db.query("ALTER TABLE form_submissions ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL").catch(() => {});

    // ═════ 1. Customer Service — public complaint form, end to end ═══════════
    console.log("\n  --- 1. CS: complaint by public form -> assigned -> resolved -> reviewed ---");
    const csList = await listIn("Customer Service");
    // form.manage is a PRE-EXISTING admin-only gate (unchanged by F7); the CS head is a legacy
    // member, so the form steps run as the owner — the rest of the scenario stays with the head.
    const form = await api(OT, "POST", "/forms", { list_id: csList, title: "F7 Complaint intake" });
    step("an admin publishes the complaint form (201)", form.s === 201, "got " + form.s);
    const f1 = await api(OT, "POST", "/forms/" + form.b?.id + "/fields",
        { field_kind: "task_attr", field_key: "name", label: "What happened?" });
    const f2 = await api(OT, "POST", "/forms/" + form.b?.id + "/fields",
        { field_kind: "task_attr", field_key: "description", label: "Details" });
    step("adds two questions (201, 201)", f1.s === 201 && f2.s === 201, f1.s + " " + f2.s);
    const slug = form.b?.public_slug;
    const pubForm = await pub("GET", "/public/forms/" + slug);
    const fieldCount = (pubForm.b?.fields ?? []).length;
    step("a CUSTOMER opens the public link (200, 2 fields)", pubForm.s === 200 && fieldCount === 2,
        pubForm.s + ", " + fieldCount + " fields");
    const sub = await pub("POST", "/public/forms/" + slug + "/submit",
        { data: { name: "F7X order arrived damaged", description: "box crushed" } });
    const csTask = sub.b?.task_id ?? sub.b?.id;
    if (csTask) madeTasks.push(csTask);
    step("the customer submits -> a task is created (201)", sub.s === 201 && !!csTask, sub.s + " task " + (csTask ?? "none"));
    const asg = await api(csHeadT, "POST", "/tasks/" + csTask + "/assignees", { user_ids: [arif.id] });
    step("CS head assigns it to Arif (204)", asg.s === 204 || asg.s === 200, "got " + asg.s);
    const c1 = await api(arifT, "POST", "/tasks/" + csTask + "/comments", { body: "Looking into it now" });
    step("Arif comments (201)", c1.s === 201, "got " + c1.s);
    const c2 = await api(csHeadT, "POST", "/tasks/" + csTask + "/comments", { body: "@arif please refund if damaged" });
    const [[notif]] = await db.query(
        "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND entity_id=?", [arif.id, csTask]);
    step("head replies with @arif -> Arif is notified", c2.s === 201 && notif.n > 0,
        c2.s + ", notifications " + notif.n);
    const bytes = Buffer.from("F7 fake customer photo");
    const up = await fetch(B + "/tasks/" + csTask + "/attachments", { method: "POST",
        headers: { Authorization: "Bearer " + arifT, "Content-Type": "image/png", "X-Filename": "damage.png" },
        body: bytes });
    step("Arif attaches the customer's photo (201)", up.status === 201, "got " + up.status);
    const pri = await api(csHeadT, "PATCH", "/tasks/" + csTask, { priority: 4 });
    step("escalates the priority to 4 (200)", pri.s === 200, "got " + pri.s);
    const csDone = await statusOf(csList, "done");
    const res1 = await api(arifT, "PATCH", "/tasks/" + csTask, { status_id: csDone });
    step("resolves it (200)", res1.s === 200, "got " + res1.s);
    const rev = await api(csHeadT, "POST", "/tasks/" + csTask + "/review", { status: "approved" });
    const after = (await api(OT, "GET", "/tasks/" + csTask)).b;
    step("CS head reviews and approves (201) + denorm/counters right",
        rev.s === 201 && after?.review_status === "approved" &&
        after?.comments_count === 2 && after?.attachments_count === 1,
        rev.s + " · " + after?.review_status + " · c=" + after?.comments_count + " a=" + after?.attachments_count);

    // ═════ 2. Orders & Fulfilment — checklist, subtask, cross-space dep ══════
    console.log("\n  --- 2. O&F: checklist + subtask + cross-space dependency ---");
    const ofList = await listIn("Orders & Fulfillment");
    const t1 = track(await api(ofHeadT, "POST", "/tasks",
        { primary_list_id: ofList, name: "F7X Order #4471 short-shipped", due_date: new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10) }));
    step("O&F head raises the order task (201)", t1.s === 201, "got " + t1.s);
    const ck = await api(ofHeadT, "POST", "/tasks/" + t1.b.id + "/checklists", { name: "F7X Short-ship steps" });
    const items = await api(ofHeadT, "POST", "/checklists/" + ck.b?.id + "/items/bulk",
        { texts: ["Verify manifest", "Contact courier", "Refund delta"] });
    step("adds a 3-step checklist via bulk (201)", ck.s === 201 && (items.s === 201 || items.s === 200),
        ck.s + " " + items.s);
    const sub2 = track(await api(ofHeadT, "POST", "/tasks",
        { primary_list_id: ofList, name: "F7X recount pallet", parent_task_id: t1.b.id }));
    step("creates a subtask (201)", sub2.s === 201, "got " + sub2.s);
    const invList = await listIn("Product & Inventory");
    const t2 = track(await api(invHeadT, "POST", "/tasks",
        { primary_list_id: invList, name: "F7X stock check SKU-118" }));
    step("Inventory head raises a task in THEIR space (201)", t2.s === 201, "got " + t2.s);
    // F22 note: the stored edge is (task_id BLOCKS related_task_id). This
    // scenario's own labels call t2 "the blocker" (the order waits on the
    // stock check), so the edge is t2 -> t1. The original fixture had it
    // backwards — invisible while ISS-011 left the rule unenforced, an
    // immediate 409 the moment F22 made `task.cannot_complete_blocked` real.
    const dep = await api(ofHeadT, "POST", "/task-dependencies",
        { task_id: t2.b.id, related_task_id: t1.b.id, type: "blocks" });
    step("O&F links the order to the Inventory task (201)", dep.s === 201, "got " + dep.s);
    const invDone = await statusOf(invList, "done");
    const d1 = await api(invHeadT, "PATCH", "/tasks/" + t2.b.id, { status_id: invDone });
    step("Inventory completes the blocker (200)", d1.s === 200, "got " + d1.s);
    const ofDone = await statusOf(ofList, "done");
    const d2 = await api(ofHeadT, "PATCH", "/tasks/" + t1.b.id, { status_id: ofDone });
    step("O&F completes the order task (200)", d2.s === 200, "got " + d2.s);
    const firstItem = (Array.isArray(items.b) ? items.b : items.b?.items ?? [])[0];
    const tick = await api(ofHeadT, "POST", "/checklist-items/" + (firstItem?.id ?? "ci-none") + "/toggle", {});
    step("ticks a checklist step (200)", tick.s === 200, "got " + tick.s);

    // ═════ 3. Marketing — template -> campaign ═══════════════════════════════
    console.log("\n  --- 3. Marketing: template -> campaign -> two assignees -> scheduled ---");
    const mktList = await listIn("Marketing");
    const plainType = await typeId("task");
    const tpl = await api(OT, "POST", "/templates", {
        type: "task", name: "F7X Campaign kit",
        structure: { taskTypeId: plainType, checklistName: "Launch steps", checklistItems: [
            { text: "Brief", dueOffsetDays: 0 },
            { text: "Creatives", dueOffsetDays: 2 },
            { text: "Schedule", dueOffsetDays: 4 } ] } });
    step("admin saves a campaign template (201)", tpl.s === 201, "got " + tpl.s + " " + JSON.stringify(tpl.b?.error?.details ?? "").slice(0, 80));
    const applied = track(await api(mktHeadT, "POST", "/templates/" + tpl.b?.id + "/apply",
        { list_id: mktList }));
    const checks = applied.b?.id
        ? (await api(mktHeadT, "GET", "/tasks/" + applied.b.id + "/checklists")).b
        : [];
    const itemTotal = (Array.isArray(checks) ? checks : checks?.data ?? [])
        .reduce((s, c) => s + (c.items?.length ?? 0), 0);
    step("Marketing head applies it -> checklist materialises (201, 3 items)",
        applied.s === 201 && itemTotal === 3, applied.s + ", items " + itemTotal);
    const [[sadia]] = await db.query("SELECT id FROM users WHERE email LIKE 'sadia@%'");
    const two = await api(mktHeadT, "POST", "/tasks/" + applied.b?.id + "/assignees",
        { user_ids: [arif.id, sadia?.id ?? owner.id] });
    step("assigns two people (204)", two.s === 204 || two.s === 200, "got " + two.s);
    const nextMon = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
    const sched = await api(mktHeadT, "PATCH", "/tasks/" + applied.b?.id,
        { start_date: nextMon, due_date: nextMon });
    step("schedules start + due next week (200)", sched.s === 200, "got " + sched.s);

    // ═════ 4. Engineering — bug -> sprint -> on-call -> S0 -> postmortem ═════
    console.log("\n  --- 4. Engineering: bug -> sprint -> on-call -> S0 auto-assign -> postmortem ---");
    const bug = track(await api(csHeadT, "POST", "/eng/report-bug",
        { happened: "F7X checkout button dead", steps: "1. add to cart 2. pay", severity: "S1", reporter_team: "cs" }));
    const [[bugRow]] = bug.b?.id
        ? await db.query("SELECT sla_due_at IS NOT NULL sla FROM tasks WHERE id=?", [bug.b.id])
        : [[{ sla: 0 }]];
    step("a CS person reports an S1 bug (201, SLA set)", bug.s === 201 && !!bugRow.sla,
        bug.s + ", sla " + (bugRow.sla ? "set" : "MISSING"));
    const [[sprint]] = await db.query("SELECT id FROM sprints WHERE status='active' LIMIT 1");
    const intoSprint = await api(engHeadT, "POST", "/sprints/" + sprint.id + "/tasks", { task_ids: [bug.b?.id] });
    step("eng head pulls it into the active sprint (204)", intoSprint.s === 204 || intoSprint.s === 200,
        "got " + intoSprint.s);
    const pr = await api(jhankarT, "PATCH", "/tasks/" + bug.b?.id,
        { branch_name: "fix/f7x-checkout", pr_url: "https://github.com/bb/app/pull/999", pr_status: "open", story_points: 3 });
    step("engineer fills branch/PR/points (200)", pr.s === 200, "got " + pr.s);
    const monday = (() => { const d = new Date(Date.now() + 6 * 3600e3);
        const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow);
        return d.toISOString().slice(0, 10); })();
    const oc = await api(engHeadT, "PUT", "/on-call/" + monday, { engineer_id: jhankar.id });
    step("an engineer is put on call for this week (200)", oc.s === 200 || oc.s === 201, "got " + oc.s);
    const s0 = track(await api(csHeadT, "POST", "/eng/report-bug",
        { happened: "F7X site down", steps: "1. open the site", severity: "S0", reporter_team: "cs" }));
    step("an S0 arrives -> auto-assigned to the on-call engineer",
        s0.s === 201 && (s0.b?.assignees ?? []).includes(jhankar.id),
        s0.s + ", assignees " + JSON.stringify(s0.b?.assignees ?? []));
    const engList = await listIn("Engineering");
    const incType = await typeId("incident");
    const inc = track(await api(engHeadT, "POST", "/tasks",
        { primary_list_id: engList, name: "F7X payment gateway incident", task_type_id: incType }));
    step("an incident is opened (201)", inc.s === 201, "got " + inc.s);
    const pmEarly = await api(engHeadT, "POST", "/eng/incidents/" + inc.b?.id + "/postmortem",
        { items: { "Timeline reconstructed": true } });
    step("postmortem while still open -> 409 incident.not_resolved",
        pmEarly.s === 409, "got " + pmEarly.s + " " + (pmEarly.b?.error?.code ?? ""));
    const engDone = await statusOf(engList, "done");
    const incDone = await api(engHeadT, "PATCH", "/tasks/" + inc.b?.id, { status_id: engDone });
    const pm = await api(engHeadT, "POST", "/eng/incidents/" + inc.b?.id + "/postmortem",
        { items: { "Timeline reconstructed": true, "Root cause identified": true } });
    step("resolved, then the postmortem is filed (200)", incDone.s === 200 && pm.s === 200,
        incDone.s + " " + pm.s);

    // ═════ 5. Weekly management cycle ════════════════════════════════════════
    console.log("\n  --- 5. Weekly management: generate -> head reads -> note -> ack -> outsider 403 ---");
    const csSpace = heads["Customer Service"].spaceId;
    const lastMon = (() => { const d = new Date(Date.now() + 6 * 3600e3);
        const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow - 7);
        return d.toISOString().slice(0, 10); })();
    const gen = await api(OT, "POST", "/reports/generate", { space_id: csSpace, week_start: lastMon });
    const repId = gen.b?.id ?? (await db.query(
        "SELECT id FROM department_reports WHERE space_id=? AND week_start=?", [csSpace, lastMon]))[0][0]?.id;
    step("owner generates the CS weekly report (200/201)", gen.s === 200 || gen.s === 201,
        "got " + gen.s + " " + JSON.stringify(gen.b?.error ?? "").slice(0, 60));
    const readHead = await api(csHeadT, "GET", "/reports/" + repId);
    step("the CS head reads it (200)", readHead.s === 200, "got " + readHead.s);
    const note = await api(csHeadT, "PATCH", "/reports/" + repId, { head_note: "F7X week in review" });
    step("the head adds a note (200)", note.s === 200, "got " + note.s);
    const ack = await api(OT, "POST", "/reports/" + repId + "/ack", {});
    step("owner acknowledges (200)", ack.s === 200 || ack.s === 201 || ack.s === 204, "got " + ack.s);
    const outsider = await api(jhankarT, "GET", "/reports/" + repId);
    step("an ordinary member is refused (403 report.forbidden)", outsider.s === 403,
        "got " + outsider.s + " " + (outsider.b?.error?.code ?? ""));

    // ═════ 6. New hire ═══════════════════════════════════════════════════════
    console.log("\n  --- 6. New hire: invite -> cannot be assigned while invited ---");
    const inv = await api(OT, "POST", "/users/invite",
        { email: "f7x.newhire@test.local", first_name: "New", last_name: "Hire", role: "member" });
    const invitedId = inv.b?.id ?? inv.b?.user?.id;
    step("owner invites a new member (201, invited state)", inv.s === 201, "got " + inv.s);
    const assignInvited = await api(csHeadT, "POST", "/tasks/" + csTask + "/assignees",
        { user_ids: [invitedId] });
    step("assigning work to the invited user -> 422 task.invalid_assignee",
        assignInvited.s === 422, "got " + assignInvited.s + " " + (assignInvited.b?.error?.code ?? ""));

    // ═════ 7. Department-only account ════════════════════════════════════════
    console.log("\n  --- 7. Department-only account: sees exactly one department ---");
    const csOnlyT = await login("cs.only@beautybooth.com.bd");
    const spacesSeen = await api(csOnlyT, "GET", "/spaces");
    const names = (Array.isArray(spacesSeen.b) ? spacesSeen.b : spacesSeen.b?.data ?? []).map((s) => s.name);
    step("spaces visible = exactly [Customer Service]",
        names.length === 1 && names[0] === "Customer Service", JSON.stringify(names));
    const mktTaskRead = await api(csOnlyT, "GET", "/tasks/" + applied.b?.id);
    step("reading a Marketing task -> 404 (invisible, not forbidden)", mktTaskRead.s === 404, "got " + mktTaskRead.s);
    const [[openCs]] = await db.query(
        `SELECT COUNT(*) n FROM tasks t JOIN lists l ON l.id=t.primary_list_id
         JOIN statuses st ON st.id=t.status_id
         WHERE l.space_id=? AND t.archived_at IS NULL AND st.status_group NOT IN ('done','closed')`, [csSpace]);
    const kpis = await api(csOnlyT, "GET", "/home/kpis");
    step("their Open Team Tasks KPI counts only CS open tasks",
        kpis.s === 200 && kpis.b?.openTeamTasks?.value === openCs.n,
        "kpi " + kpis.b?.openTeamTasks?.value + " vs db " + openCs.n);
    const engHome = await api(csOnlyT, "GET", "/eng/home");
    step("Eng Home still opens (SCAN-M5 nav gap — logged, by design until F26)", engHome.s === 200, "got " + engHome.s);

    // ═════ 8. Offboarding ════════════════════════════════════════════════════
    console.log("\n  --- 8. Offboarding: deactivate -> sessions dead -> work retained ---");
    const leaverId = "u-F7-leaver";
    await db.query(
        "INSERT INTO users (id, workspace_id, first_name, last_name, email, password_hash, role, status) VALUES (?,?,?,?,?,?,'member','active')",
        [leaverId, owner.workspace_id, "F7", "Leaver", "f7x.leaver@test.local", owner.password_hash]);
    const { execSync } = require("node:child_process");
    execSync('npx tsx -e "import { initDb } from \'./src/db/client\'; import { syncUserSystemRole } from \'./src/rbac/bootstrap\'; (async()=>{const db=await initDb(); await syncUserSystemRole(db, \'' + owner.workspace_id + '\', \'' + leaverId + '\', \'member\'); process.exit(0);})();"',
        { cwd: "E:/Task Management System/server", stdio: "ignore" });
    await login("f7x.leaver@test.local");
    await api(OT, "POST", "/tasks/" + t1.b.id + "/assignees", { user_ids: [leaverId] });
    const deact = await api(OT, "POST", "/users/" + leaverId + "/deactivate", {});
    step("owner deactivates the leaver (204)", deact.s === 204 || deact.s === 200, "got " + deact.s);
    const [[leaver]] = await db.query("SELECT status FROM users WHERE id=?", [leaverId]);
    step("status = deactivated", leaver.status === "deactivated", leaver.status);
    const [[sess]] = await db.query(
        "SELECT COUNT(*) n FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()", [leaverId]);
    step("live sessions revoked (0 remaining)", sess.n === 0, sess.n + " live");
    const [[asgn]] = await db.query("SELECT COUNT(*) n FROM task_assignees WHERE user_id=?", [leaverId]);
    step("their task assignments RETAINED", asgn.n >= 1, asgn.n + " assignment(s)");
    const dead = await login("f7x.leaver@test.local").catch(() => null);
    step("they can no longer sign in", !dead, dead ? "TOKEN ISSUED?!" : "login refused");

    // ═════ cleanup — the demo DB back to its baseline ════════════════════════
    console.log("\n  === CLEANUP ===");
    for (const id of madeTasks.reverse()) await api(OT, "DELETE", "/tasks/" + id + "?hard=true").catch(() => {});
    const [leftTasks] = await db.query("SELECT id FROM tasks WHERE name LIKE 'F7X%' OR name LIKE '%F7X%'");
    if (leftTasks.length) { const ids = leftTasks.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "task_watchers", "comments", "checklist_items", "checklists", "attachments", "task_reviews", "task_dependencies"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM task_dependencies WHERE related_task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]); }
    if (form.b?.id) {
        await db.query("DELETE FROM form_submissions WHERE form_id=?", [form.b.id]).catch(() => {});
        await db.query("DELETE FROM form_fields WHERE form_id=?", [form.b.id]).catch(() => {});
        await db.query("DELETE FROM forms WHERE id=?", [form.b.id]).catch(() => {});
    }
    if (tpl.b?.id) await api(OT, "DELETE", "/templates/" + tpl.b.id).catch(() => {});
    await db.query("DELETE FROM on_call_shifts WHERE week_start=? AND engineer_id=?", [monday, jhankar.id]).catch(() => {});
    const [[genRep]] = await db.query(
        "SELECT COUNT(*) n FROM department_reports WHERE space_id=? AND week_start=?", [csSpace, lastMon]);
    if (genRep.n && repId) await db.query(
        "UPDATE department_reports SET head_note=NULL WHERE id=?", [repId]).catch(() => {});
    for (const email of ["f7x.newhire@test.local", "f7x.leaver@test.local"]) {
        const [[u]] = await db.query("SELECT id FROM users WHERE email=?", [email]);
        if (u) {
            for (const t of ["user_roles", "sessions", "notifications", "task_assignees", "invitations", "workspace_activity"])
                await db.query("DELETE FROM " + t + " WHERE " + (t === "workspace_activity" ? "actor_id" : "user_id") + "=?", [u.id]).catch(() => {});
            await db.query("DELETE FROM invitations WHERE email=?", [email]).catch(() => {});
            await db.query("DELETE FROM users WHERE id=?", [u.id]);
        }
    }
    // notifications fan out to entity types the per-task sweep misses
    // (mention->comment, form_submitted->form, assigned->deleted-task) — sweep
    // everything this run created by time window:
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 3 HOUR");
    // ISS-025 drift restored (X9)
    // F17 RETIRED the ISS-025 add/drop protocol: the columns are now PERMANENT
    // (upgrades/008). Dropping them here would REINTRODUCE the drift.
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  users " + await q("users") + " (15) | tasks " + await q("tasks") + " (46) | forms " + await q("forms") +
        " (0) | on_call " + await q("on_call_shifts") + " (1) | reports " + await q("department_reports") + " (12)");
    const [cols] = await db.query("DESCRIBE form_submissions");
    console.log("  form_submissions cols " + cols.length + " (8 — ISS-025 drift restored)");

    console.log("\n  SCORE: " + ok + " passed, " + bad + " failed  (P39 baseline: 22/22)");
    console.log(bad === 0 ? "  PASS — nobody lost a job function.\n" : "  *** REGRESSIONS ***\n");
    await db.end();
    process.exit(bad === 0 ? 0 : 1);
})();
