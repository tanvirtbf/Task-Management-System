// F7 — the P5 two-pass enforcement probe, re-run on the gated tree.
//
// Phase A: the 17 route-gated keys. A probe user (legacy MEMBER) holds ONE
//   custom role whose grant set this script rewrites per key: minimal
//   (space.view+task.view) -> expect 403 auth.forbidden; minimal+KEY -> expect
//   anything BUT 403 (2xx, or the domain's own 404/409/422 — all prove the
//   gate passed and the request reached the domain logic).
// Phase B: the composed keys (D3.1). A second probe user (legacy ADMIN, again
//   holding only the custom role) proves each roles-grid toggle is REAL:
//   toggle off -> denied, toggle on -> allowed. Plus the two invariants:
//   compose cannot widen (a legacy member granted task.delete_hard is still
//   refused), and department heads keep dept-review with no report.view.
//
// Fixtures are created by the owner and removed; both probe users and the two
// custom roles are deleted; the demo DB returns to its baseline.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const pad = (s, n) => String(s).padEnd(n);
let bad = 0;
const check = (label, ok, detail) => { if (!ok) bad++;
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 66) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const OT = await login("owner@company.local");
    if (!OT) { console.error("no owner login"); process.exit(2); }
    const [[owner]] = await db.query("SELECT * FROM users WHERE email='owner@company.local'");
    const [[list]] = await db.query("SELECT id FROM lists WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");

    // ── probe users: direct rows (no system-role assignment), owner's hash ──
    const mkUser = async (email, role) => {
        const id = "u-F7-" + Math.random().toString(36).slice(2, 10);
        await db.query(
            "INSERT INTO users (id, workspace_id, first_name, last_name, email, password_hash, role, status) VALUES (?,?,?,?,?,?,?,'active')",
            [id, owner.workspace_id, "F7", "Probe", email, owner.password_hash, role]);
        return id;
    };
    const p1 = await mkUser("f7.probe.member@test.local", "member");
    const p2 = await mkUser("f7.probe.admin@test.local", "admin");
    const T1 = await login("f7.probe.member@test.local");
    const T2 = await login("f7.probe.admin@test.local");
    check("probe users log in (member + legacy-admin)", !!T1 && !!T2, "");

    // ── custom roles via the roles API ───────────────────────────────────────
    const mkRole = async (name) =>
        (await api(OT, "POST", "/roles", { name, description: "F7 probe role" })).b?.id;
    const setPerms = async (roleId, keys) => {
        const r = await api(OT, "PUT", "/roles/" + roleId + "/permissions",
            { permissions: keys.map((k) => ({ key: k, scope: "all" })) });
        if (r.s !== 200)
            throw new Error("setPerms " + r.s + ": " + JSON.stringify(r.b).slice(0, 200));
        return r;
    };
    const role1 = await mkRole("F7 Probe Minimal");
    const role2 = await mkRole("F7 Probe AdminToggle");
    check("custom roles created", !!role1 && !!role2, role1 + " " + role2);
    const assign = async (userId, roleId) =>
        api(OT, "POST", "/users/" + userId + "/roles", { role_id: roleId, scope_type: "workspace" });
    const a1 = await assign(p1, role1);
    const a2 = await assign(p2, role2);
    check("roles assigned workspace-wide", a1.s < 300 && a2.s < 300, a1.s + " " + a2.s);

    const MIN = ["space.view", "task.view"];

    // ── owner-made fixtures ──────────────────────────────────────────────────
    const fixtures = [];
    const mkTask = async (name) => { const r = await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "TEST-F7-" + name });
        fixtures.push(r.b.id); return r.b.id; };
    const tEdit = await mkTask("edit");
    const tArch = await mkTask("arch");
    const tDel = await mkTask("del");
    const tDep1 = await mkTask("dep1");
    const tDep2 = await mkTask("dep2");
    const tCmt = await mkTask("cmt");
    const [[sprint]] = await db.query("SELECT id FROM sprints WHERE status='active' LIMIT 1");

    console.log("\n  === PHASE A — the 17 route-gated keys, two passes each ===\n");
    console.log("  " + pad("PERMISSION", 24) + pad("no-grant", 12) + pad("with-grant", 12) + "VERDICT");

    // [key, method, path, body, allowPredicate]
    const A = [
        ["member.view", "GET", "/users", undefined],
        ["task.create", "POST", "/tasks", { primary_list_id: list.id, name: "TEST-F7-created" }],
        ["task.edit", "PATCH", "/tasks/" + tEdit, { name: "TEST-F7-edit-2" }],
        ["task.assign", "POST", "/tasks/" + tEdit + "/assignees", { user_ids: [p1] }],
        ["task.archive", "POST", "/tasks/" + tArch + "/archive", {}],
        ["task.delete", "DELETE", "/tasks/" + tDel, undefined],
        ["comment.create", "POST", "/tasks/" + tCmt + "/comments", { body: "TEST-F7 comment" }],
        ["checklist.manage", "POST", "/tasks/" + tCmt + "/checklists", { title: "TEST-F7 list" }],
        ["attachment.upload", "POST", "/uploads/sign", { task_id: tCmt, filename: "f7.txt", mime_type: "text/plain", size_bytes: 10 }],
        ["dependency.manage", "POST", "/task-dependencies", { task_id: tDep1, related_task_id: tDep2 }],
        ["customfield.set_value", "PUT", "/tasks/" + tEdit + "/custom-fields/cf-f7-missing", { value: "x" }],
        ["template.apply", "POST", "/templates/tpl-f7-missing/apply", { task_id: tEdit }],
        ["sprint.assign_tasks", "POST", "/sprints/" + (sprint?.id ?? "spr-none") + "/tasks", { task_id: tEdit }],
        ["bug.report", "POST", "/eng/report-bug", { happened: "TEST-F7 bug", steps: "1. probe", reporter_team: "cs" }],
        ["postmortem.manage", "POST", "/eng/incidents/inc-f7-missing/postmortem", { what_happened: "x" }],
        ["activity.view", "GET", "/activity", undefined],
        ["form.view_submissions", "GET", "/forms/form-f7-missing/submissions", undefined],
    ];

    const createdByProbe = [];
    for (const [key, method, path, body] of A) {
        await setPerms(role1, MIN);
        const deny = await api(T1, method, path, body);
        await setPerms(role1, [...MIN, key]);
        const allow = await api(T1, method, path, body);
        const denyOk = deny.s === 403;
        const allowOk = allow.s !== 403;
        if (allow.b?.id && key === "task.create") createdByProbe.push(allow.b.id);
        if (allow.b?.id && key === "bug.report") createdByProbe.push(allow.b.id);
        if (!(denyOk && allowOk)) bad++;
        console.log("  " + pad(key, 24) + pad(deny.s + (denyOk ? "" : " ***"), 12) +
            pad(allow.s + (allowOk ? "" : " ***"), 12) +
            (denyOk && allowOk ? "ENFORCED" : "*** BROKEN ***"));
    }
    await setPerms(role1, MIN);

    console.log("\n  === PHASE B — the composed toggles (D3.1) ===\n");
    const BASE2 = ["space.view", "task.view", "space.edit", "member.view"];

    // task.delete_hard — toggle off/on for a legacy admin. The ROUTE carries
    // `task.delete` (it is a delete route), so that key rides in the baseline;
    // what is toggled is the hard-branch compose in the service.
    const tHard = await mkTask("hard");
    await setPerms(role2, [...BASE2, "task.delete"]);
    const hardOff = await api(T2, "DELETE", "/tasks/" + tHard + "?hard=true");
    await setPerms(role2, [...BASE2, "task.delete", "task.delete_hard"]);
    const hardOn = await api(T2, "DELETE", "/tasks/" + tHard + "?hard=true");
    check("task.delete_hard: admin with toggle OFF is refused", hardOff.s === 403, "got " + hardOff.s);
    check("task.delete_hard: toggle ON deletes (204)", hardOn.s === 204, "got " + hardOn.s);

    // compose cannot widen — a legacy MEMBER holding BOTH task.delete (route)
    // and task.delete_hard (grant) is still refused by the legacy floor.
    const tHard2 = await mkTask("hard2");
    await setPerms(role1, [...MIN, "task.delete", "task.delete_hard"]);
    const widen = await api(T1, "DELETE", "/tasks/" + tHard2 + "?hard=true");
    check("compose cannot WIDEN: member + grant still refused (403)", widen.s === 403, "got " + widen.s);
    await setPerms(role1, MIN);

    // comment.delete_any — someone else's comment
    const cm = (await api(OT, "POST", "/tasks/" + tCmt + "/comments", { body: "TEST-F7 owner comment" })).b;
    await setPerms(role2, BASE2);
    const cdOff = await api(T2, "DELETE", "/comments/" + cm.id);
    await setPerms(role2, [...BASE2, "comment.delete_any"]);
    const cdOn = await api(T2, "DELETE", "/comments/" + cm.id);
    check("comment.delete_any: toggle OFF refused (403)", cdOff.s === 403, "got " + cdOff.s + " " + (cdOff.b?.error?.code ?? ""));
    check("comment.delete_any: toggle ON deletes (204)", cdOn.s === 204, "got " + cdOn.s);

    // member.edit_profile — someone else's profile vs own
    await setPerms(role2, BASE2);
    const epOff = await api(T2, "PATCH", "/users/" + p1, { first_name: "F7x" });
    const epSelf = await api(T2, "PATCH", "/users/" + p2, { first_name: "F7self" });
    await setPerms(role2, [...BASE2, "member.edit_profile"]);
    const epOn = await api(T2, "PATCH", "/users/" + p1, { first_name: "F7y" });
    check("member.edit_profile: toggle OFF, other's profile refused", epOff.s === 403, "got " + epOff.s);
    check("member.edit_profile: SELF-edit stays free with toggle OFF", epSelf.s === 200, "got " + epSelf.s);
    check("member.edit_profile: toggle ON edits another's profile", epOn.s === 200, "got " + epOn.s);

    // report.view — admin fast-path gated; heads unaffected
    await setPerms(role2, BASE2);
    const rlOff = await api(T2, "GET", "/reports");
    const [[someReport]] = await db.query("SELECT id FROM department_reports LIMIT 1");
    const rgOff = await api(T2, "GET", "/reports/" + someReport.id);
    await setPerms(role2, [...BASE2, "report.view"]);
    const rlOn = await api(T2, "GET", "/reports");
    const rgOn = await api(T2, "GET", "/reports/" + someReport.id);
    const lenOf = (r) => (Array.isArray(r.b) ? r.b : r.b?.data ?? []).length;
    check("report.view: toggle OFF -> head-scoped fallback (empty list)", rlOff.s === 200 && lenOf(rlOff) === 0,
        rlOff.s + ", " + lenOf(rlOff) + " row(s)");
    check("report.view: toggle OFF -> direct read refused (403)", rgOff.s === 403, "got " + rgOff.s);
    check("report.view: toggle ON -> all departments listed", rlOn.s === 200 && lenOf(rlOn) > 0,
        rlOn.s + ", " + lenOf(rlOn) + " row(s)");
    check("report.view: toggle ON -> direct read 200", rgOn.s === 200, "got " + rgOn.s);
    const HT = await login("nusrat@beautybooth.com.bd");   // marketing head, legacy member
    const rlHead = await api(HT, "GET", "/reports");
    check("a department head still sees their reports (no report.view)", rlHead.s === 200 && lenOf(rlHead) > 0,
        rlHead.s + ", " + lenOf(rlHead) + " row(s)");

    // space.head_assign — body-conditional; general edit unaffected
    const [[mkt]] = await db.query("SELECT id, head_user_id FROM spaces WHERE name='Marketing'");
    await setPerms(role2, BASE2);   // has space.edit, NOT head_assign
    const haOff = await api(T2, "PATCH", "/spaces/" + mkt.id, { head_user_id: p2 });
    const geOn = await api(T2, "PATCH", "/spaces/" + mkt.id, { name: "Marketing" });
    await setPerms(role2, [...BASE2, "space.head_assign"]);
    const haOn = await api(T2, "PATCH", "/spaces/" + mkt.id, { head_user_id: p2 });
    check("space.head_assign: toggle OFF -> head change refused (403)", haOff.s === 403,
        "got " + haOff.s + " " + (haOff.b?.error?.code ?? ""));
    check("space.head_assign: general edit unaffected (space.edit only)", geOn.s === 200, "got " + geOn.s);
    check("space.head_assign: toggle ON -> head change 200", haOn.s === 200, "got " + haOn.s);
    await db.query("UPDATE spaces SET head_user_id=? WHERE id=?", [mkt.head_user_id, mkt.id]);

    // attachment.delete_any — same compose line as comment.delete_any; a live
    // attachment needs R2 round-tripping, so this one is asserted by the
    // attachments jest module in the gate instead. Recorded, not skipped
    // silently.
    console.log("  note: attachment.delete_any compose is covered by the attachments jest module (same one-line pattern)");

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    for (const id of [...createdByProbe, ...fixtures])
        await api(OT, "DELETE", "/tasks/" + id + "?hard=true").catch(() => {});
    const [left] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F7%'");
    if (left.length) { const ids = left.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]); }
    await api(OT, "DELETE", "/roles/" + role1).catch(() => {});
    await api(OT, "DELETE", "/roles/" + role2).catch(() => {});
    await db.query("DELETE FROM user_roles WHERE user_id IN (?,?)", [p1, p2]).catch(() => {});
    await db.query("DELETE FROM notifications WHERE user_id IN (?,?)", [p1, p2]).catch(() => {});
    await db.query("DELETE FROM sessions WHERE user_id IN (?,?)", [p1, p2]).catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE actor_id IN (?,?)", [p1, p2]).catch(() => {});
    await db.query("DELETE FROM users WHERE id IN (?,?)", [p1, p2]);
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  users " + await q("users") + " (15) | roles(active) " +
        (await db.query("SELECT COUNT(*) n FROM roles WHERE archived_at IS NULL"))[0][0].n +
        " (5) | tasks " + await q("tasks") + " (46) | comments " + await q("comments") + " (7)");
    console.log(bad === 0
        ? "\n  PASS — every toggle is real: 17 route gates enforce, the composes narrow and cannot widen.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
