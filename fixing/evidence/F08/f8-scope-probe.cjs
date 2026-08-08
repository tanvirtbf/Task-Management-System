// F8 — ISS-047 verification: grant SCOPES now narrow writes.
//
// The star witness is the issue's own account: marketing.only@ holds
// `task.edit` at scope OWN (space-assigned -> ownSpaceIds=[Marketing]).
// Before F8 they edited anyone's task; now:
//   - their own task                    -> 200
//   - a task they are ASSIGNED to       -> 200 (own includes assignee)
//   - someone else's task, same space   -> 403 task.forbidden / not_own
//     (the P42 gotcha respected: the target is INSIDE their visible space,
//      so visibility answers "yes" and the scope check is what refuses)
// Plus: space-scoped create/assign/archive narrowing via a probe role, bulk
// fail-atomicity, seeded roles unchanged, and the no-actor carve-out (the
// public form submit still creates its task).
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 64) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const OT = await login("owner@company.local");
    const MT = await login("marketing.only@beautybooth.com.bd");
    check("logins (owner + marketing.only@)", !!OT && !!MT, "");
    const [[mkt]] = await db.query("SELECT id FROM spaces WHERE name='Marketing'");
    const [[mktList]] = await db.query(
        "SELECT id FROM lists WHERE space_id=? AND archived_at IS NULL LIMIT 1", [mkt.id]);
    const [[csList]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const [[mo]] = await db.query("SELECT id FROM users WHERE email='marketing.only@beautybooth.com.bd'");
    const made = [];

    console.log("\n  === F8 — does a grant's SCOPE narrow the write? (ISS-047) ===\n");

    console.log("  --- 1. the issue's own account: task.edit @ own ---");
    // their own task (they hold task.create @ space:Marketing)
    const own = await api(MT, "POST", "/tasks", { primary_list_id: mktList.id, name: "TEST-F8-own" });
    if (own.b?.id) made.push(own.b.id);
    check("creates their own Marketing task (201)", own.s === 201, "got " + own.s);
    const editOwn = await api(MT, "PATCH", "/tasks/" + own.b?.id, { priority: 2 });
    check("edits THEIR OWN task (200)", editOwn.s === 200, "got " + editOwn.s);

    // someone else's Marketing task — the exact ISS-047 target class
    const [[foreign]] = await db.query(
        `SELECT t.id, t.priority FROM tasks t WHERE t.primary_list_id IN
         (SELECT id FROM lists WHERE space_id=?) AND t.created_by<>? AND t.archived_at IS NULL
         AND t.id NOT IN (SELECT task_id FROM task_assignees WHERE user_id=?) LIMIT 1`,
        [mkt.id, mo.id, mo.id]);
    const editForeign = await api(MT, "PATCH", "/tasks/" + foreign.id, { priority: 3 });
    const [[still]] = await db.query("SELECT priority FROM tasks WHERE id=?", [foreign.id]);
    check("someone else's task in their VISIBLE space -> 403 (was 200!)",
        editForeign.s === 403, "got " + editForeign.s + " " + (editForeign.b?.error?.code ?? ""));
    check("…reason is not_own, code task.forbidden",
        editForeign.b?.error?.code === "task.forbidden" &&
        JSON.stringify(editForeign.b?.error?.details ?? []).includes("not_own"), "");
    check("…and the value did NOT change", still.priority === foreign.priority,
        "db " + still.priority + " vs " + foreign.priority);

    // assigned-but-not-creator: own includes assignee
    await api(OT, "POST", "/tasks/" + foreign.id + "/assignees", { user_ids: [mo.id] });
    const editAssigned = await api(MT, "PATCH", "/tasks/" + foreign.id, { priority: foreign.priority });
    check("the SAME task once ASSIGNED to them -> 200 (own = creator|assignee)",
        editAssigned.s === 200, "got " + editAssigned.s);
    await api(OT, "DELETE", "/tasks/" + foreign.id + "/assignees/" + mo.id);

    console.log("\n  --- 2. bulk is fail-atomic on scope ---");
    const blk = await api(MT, "POST", "/tasks/bulk", { ids: [own.b?.id, foreign.id], patch: { priority: 2 } });
    check("bulk [own, foreign] -> 403, nothing written", blk.s === 403, "got " + blk.s);
    const blkOwn = await api(MT, "POST", "/tasks/bulk", { ids: [own.b?.id], patch: { priority: 1 } });
    check("bulk [own] -> 200", blkOwn.s === 200, "got " + blkOwn.s);

    console.log("\n  --- 3. space-scoped create/assign/archive via a probe role ---");
    const roleId = (await api(OT, "POST", "/roles", { name: "F8 Probe Scoped" })).b?.id;
    const put = await api(OT, "PUT", "/roles/" + roleId + "/permissions", { permissions: [
        { key: "space.view", scope: "all" }, { key: "task.view", scope: "all" },
        { key: "task.create", scope: "space" }, { key: "task.assign", scope: "space" },
        { key: "task.archive", scope: "own" }, { key: "task.delete", scope: "own" },
    ] });
    check("probe role built (create/assign @space, archive/delete @own)", put.s === 200, "got " + put.s);
    const [[ownerRow]] = await db.query("SELECT workspace_id, password_hash FROM users WHERE email='owner@company.local'");
    const pid = "u-F8-probe";
    await db.query(
        "INSERT INTO users (id, workspace_id, first_name, last_name, email, password_hash, role, status) VALUES (?,?,?,?,?,?,'member','active')",
        [pid, ownerRow.workspace_id, "F8", "Probe", "f8.probe@test.local", ownerRow.password_hash]);
    // space-scoped assignment to Marketing ONLY (contract: {role_id, space_id})
    const asgRole = await api(OT, "POST", "/users/" + pid + "/roles",
        { role_id: roleId, space_id: mkt.id });
    check("space-scoped assignment created (201)", asgRole.s === 201, "got " + asgRole.s);
    // A second, WORKSPACE-WIDE viewer role: without it the space assignment
    // clamps `space.view` too, and the outside-space probes die as 404s at the
    // visibility layer (the D-9 deny-by-404 — the P42 gotcha the plan warns
    // about) before the scope check ever runs. With workspace-wide sight, the
    // 403 below is provably the SCOPE check refusing, nothing else.
    const viewerId = (await api(OT, "POST", "/roles", { name: "F8 Probe Viewer" })).b?.id;
    await api(OT, "PUT", "/roles/" + viewerId + "/permissions", { permissions: [
        { key: "space.view", scope: "all" }, { key: "task.view", scope: "all" },
    ] });
    const asgViewer = await api(OT, "POST", "/users/" + pid + "/roles", { role_id: viewerId });
    check("workspace-wide viewer role attached (sees everything)", asgViewer.s === 201, "got " + asgViewer.s);
    const PT = await login("f8.probe@test.local");

    const inMkt = await api(PT, "POST", "/tasks", { primary_list_id: mktList.id, name: "TEST-F8-probe-mkt" });
    if (inMkt.b?.id) made.push(inMkt.b.id);
    check("create INSIDE the assigned space -> 201", inMkt.s === 201, "got " + inMkt.s);
    const inCs = await api(PT, "POST", "/tasks", { primary_list_id: csList.id, name: "TEST-F8-probe-cs" });
    if (inCs.b?.id) made.push(inCs.b.id);
    check("create OUTSIDE it (visible list) -> 403 out_of_scope", inCs.s === 403,
        "got " + inCs.s + " " + (inCs.b?.error?.code ?? ""));

    const [[csTask]] = await db.query(
        `SELECT t.id FROM tasks t JOIN lists l ON l.id=t.primary_list_id
         JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND t.archived_at IS NULL LIMIT 1`);
    const asgMkt = await api(PT, "POST", "/tasks/" + inMkt.b?.id + "/assignees", { user_ids: [mo.id] });
    check("assign on a task in the assigned space -> 204", asgMkt.s === 204 || asgMkt.s === 200, "got " + asgMkt.s);
    const asgCs = await api(PT, "POST", "/tasks/" + csTask.id + "/assignees", { user_ids: [mo.id] });
    check("assign outside it -> 403", asgCs.s === 403, "got " + asgCs.s);

    const archOwn = await api(PT, "POST", "/tasks/" + inMkt.b?.id + "/archive", {});
    check("archive their OWN task (own scope) -> 204", archOwn.s === 204, "got " + archOwn.s);
    const archForeign = await api(PT, "POST", "/tasks/" + foreign.id + "/archive", {});
    check("archive someone ELSE's -> 403 not_own", archForeign.s === 403, "got " + archForeign.s);
    const delForeign = await api(PT, "DELETE", "/tasks/" + foreign.id);
    check("delete someone else's (own-scoped task.delete) -> 403", delForeign.s === 403, "got " + delForeign.s);

    console.log("\n  --- 4. seeded roles: unchanged (scope 'all') ---");
    const [[scopes]] = await db.query(
        `SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
         WHERE r.role_key IN ('owner','admin','member','guest') AND rp.scope <> 'all'`);
    check("every system-role grant is scope=all in the DB", scopes.n === 0, scopes.n + " non-all rows");
    const AT = await login("arif@beautybooth.com.bd");   // plain member
    const memberEdit = await api(AT, "PATCH", "/tasks/" + foreign.id, { priority: foreign.priority });
    check("a plain member still edits anyone's task (200 — behaviour unchanged)",
        memberEdit.s === 200, "got " + memberEdit.s);

    console.log("\n  --- 5. the no-actor carve-out: public form submit still creates ---");
    await db.query("ALTER TABLE form_submissions ADD COLUMN encrypted_at TIMESTAMP NULL DEFAULT NULL").catch(() => {});
    await db.query("ALTER TABLE form_submissions ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL").catch(() => {});
    const form = await api(OT, "POST", "/forms", { list_id: csList.id, title: "F8 probe form" });
    await api(OT, "POST", "/forms/" + form.b?.id + "/fields",
        { field_kind: "task_attr", field_key: "name", label: "What" });
    const subm = await fetch(B + "/public/forms/" + form.b?.public_slug + "/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { name: "TEST-F8 public submit" } }) });
    const subBody = await j(subm);
    if (subBody?.task_id) made.push(subBody.task_id);
    check("anonymous submit -> 201 (assertScoped skips no-actor contexts)",
        subm.status === 201, "got " + subm.status);

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    for (const id of made) await api(OT, "DELETE", "/tasks/" + id + "?hard=true").catch(() => {});
    const [left] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F8%'");
    if (left.length) { const ids = left.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]); }
    if (form.b?.id) {
        await db.query("DELETE FROM form_submissions WHERE form_id=?", [form.b.id]).catch(() => {});
        await db.query("DELETE FROM form_fields WHERE form_id=?", [form.b.id]).catch(() => {});
        await db.query("DELETE FROM forms WHERE id=?", [form.b.id]).catch(() => {});
    }
    // F17 RETIRED the ISS-025 add/drop protocol (upgrades/008): the columns are permanent now.
    // F17 RETIRED the ISS-025 add/drop protocol (upgrades/008): the columns are permanent now.
    if (roleId) await api(OT, "DELETE", "/roles/" + roleId).catch(() => {});
    if (viewerId) await api(OT, "DELETE", "/roles/" + viewerId).catch(() => {});
    await db.query("DELETE FROM user_roles WHERE user_id=?", [pid]).catch(() => {});
    await db.query("DELETE FROM sessions WHERE user_id=?", [pid]).catch(() => {});
    await db.query("DELETE FROM notifications WHERE user_id=?", [pid]).catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE actor_id=?", [pid]).catch(() => {});
    await db.query("DELETE FROM users WHERE id=?", [pid]);
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR");
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    const [[cols]] = await db.query(
        "SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema='taskmanagement' AND table_name='form_submissions'");
    console.log("  users " + await q("users") + " (15) | tasks " + await q("tasks") + " (46) | roles " +
        (await db.query("SELECT COUNT(*) n FROM roles WHERE archived_at IS NULL"))[0][0].n +
        " (5) | notif " + await q("notifications") + " (57) | fs-cols " + cols.n + " (8)");
    console.log(bad === 0
        ? "\n  PASS — scopes narrow writes; seeded roles untouched; no-actor paths alive. ISS-047 closed.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
