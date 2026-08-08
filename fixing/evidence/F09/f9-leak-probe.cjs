// F9 — the three space-filter leaks, re-run on the fixed tree.
//
//   ISS-053  a dependency edge hydrated the full task of an invisible space,
//            and the edge could be unlinked across that boundary
//   ISS-060  the audit feed was readable by every account, unscoped
//   ISS-084  GET /forms + /forms/:id served every department's forms
//
// Fixtures: a scratch "confidential" space (the Politics stand-in — the demo
// re-seed removed the original), a probe user whose single role is
// space-assigned to Marketing (so their visibility is genuinely narrowed, with
// the route-verbs they need), plus the seeded guest/member/dept-only accounts.
// Everything is removed and the baseline re-verified.
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 66) + (detail || "")); };
const rowsOf = (r) => (Array.isArray(r.b) ? r.b : r.b?.data ?? []);

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const OT = await login("owner@company.local");
    const GT = await login("guest@beautybooth.com.bd");
    const AT = await login("arif@beautybooth.com.bd");
    const [[mkt]] = await db.query("SELECT id FROM spaces WHERE name='Marketing'");
    const [[mktList]] = await db.query(
        "SELECT id FROM lists WHERE space_id=? AND archived_at IS NULL LIMIT 1", [mkt.id]);

    console.log("\n  === F9 — the three space-filter leaks (ISS-053 / 060 / 084) ===\n");

    // ── the confidential space (Politics stand-in) ───────────────────────────
    const conf = await api(OT, "POST", "/spaces", { name: "F9X Confidential" });
    const confList = await api(OT, "POST", "/lists",
        { space_id: conf.b?.id, name: "F9X Board matters" });
    const confTask = await api(OT, "POST", "/tasks", {
        primary_list_id: confList.b?.id, name: "F9X CONFIDENTIAL board memo",
        description: "F9X salary review outcome — restricted" });
    check("confidential space + list + task built", conf.s === 201 && confList.s === 201 && confTask.s === 201,
        conf.s + " " + confList.s + " " + confTask.s);
    const confForm = await api(OT, "POST", "/forms",
        { list_id: confList.b?.id, title: "F9X POLITICS confidential intake" });
    check("confidential form built", confForm.s === 201, "got " + confForm.s);

    // ── the narrowed probe user (single role, space-assigned to Marketing) ───
    const roleId = (await api(OT, "POST", "/roles", { name: "F9 Probe DeptOnly" })).b?.id;
    await api(OT, "PUT", "/roles/" + roleId + "/permissions", { permissions: [
        { key: "space.view", scope: "all" }, { key: "task.view", scope: "all" },
        { key: "task.create", scope: "all" }, { key: "dependency.manage", scope: "all" },
        { key: "activity.view", scope: "all" },
    ] });
    const [[ownerRow]] = await db.query(
        "SELECT workspace_id, password_hash FROM users WHERE email='owner@company.local'");
    const pid = "u-F9-probe";
    await db.query(
        "INSERT INTO users (id, workspace_id, first_name, last_name, email, password_hash, role, status) VALUES (?,?,?,?,?,?,'member','active')",
        [pid, ownerRow.workspace_id, "F9", "Probe", "f9.probe@test.local", ownerRow.password_hash]);
    const asg = await api(OT, "POST", "/users/" + pid + "/roles", { role_id: roleId, space_id: mkt.id });
    check("probe user: one role, space-assigned to Marketing only", asg.s === 201, "got " + asg.s);
    const PT = await login("f9.probe@test.local");

    // their own Marketing task, then the OWNER links it to the confidential one
    const mine = await api(PT, "POST", "/tasks", { primary_list_id: mktList.id, name: "F9X my campaign task" });
    check("probe creates their Marketing task", mine.s === 201, "got " + mine.s);
    const edge = await api(OT, "POST", "/task-dependencies",
        { task_id: mine.b?.id, related_task_id: confTask.b?.id, type: "blocks" });
    check("owner links it to the confidential task (cross-space edge)", edge.s === 201, "got " + edge.s);

    console.log("\n  --- ISS-053: dependency hydration + unlink ---");
    const sanity = await api(PT, "GET", "/tasks/" + confTask.b?.id);
    check("sanity: the confidential task itself is 404 to them", sanity.s === 404, "got " + sanity.s);
    const deps = await api(PT, "GET", "/tasks/" + mine.b?.id + "/dependencies");
    const blocks = deps.b?.blocks ?? [];
    const leaked = JSON.stringify(deps.b ?? {}).includes("CONFIDENTIAL");
    check("their task's dependencies: the invisible other end is GONE",
        deps.s === 200 && blocks.length === 0 && !leaked,
        deps.s + ", blocks " + blocks.length + (leaked ? "  *** CONTENT LEAKED ***" : ""));
    const unlink = await api(PT, "DELETE", "/task-dependencies/" + edge.b?.id);
    check("they can no longer UNLINK it (404, was 204)", unlink.s === 404, "got " + unlink.s);
    const ownerSees = await api(OT, "GET", "/tasks/" + mine.b?.id + "/dependencies");
    check("the owner still sees the full edge (visibility, not deletion)",
        ownerSees.s === 200 && (ownerSees.b?.blocks ?? []).length === 1,
        ownerSees.s + ", blocks " + (ownerSees.b?.blocks ?? []).length);

    console.log("\n  --- ISS-060: the audit feed ---");
    const gUser = await api(GT, "GET", "/activity?entity_type=user&limit=50");
    check("guest: user-entity rows -> 0 (was 42, incl. deactivations)",
        gUser.s === 200 && rowsOf(gUser).length === 0, gUser.s + ", " + rowsOf(gUser).length + " rows");
    const aUser = await api(AT, "GET", "/activity?entity_type=user&limit=50");
    check("member: user-entity rows -> 0", aUser.s === 200 && rowsOf(aUser).length === 0,
        aUser.s + ", " + rowsOf(aUser).length);
    const oUser = await api(OT, "GET", "/activity?entity_type=user&limit=50");
    check("owner: user-entity rows still there (audit is admin material)",
        oUser.s === 200 && rowsOf(oUser).length > 0, oUser.s + ", " + rowsOf(oUser).length);
    const gFeed = await api(GT, "GET", "/activity?limit=200");
    const gKinds = [...new Set(rowsOf(gFeed).map((r) => r.entity_type))].sort();
    check("guest's whole feed is space/list rows only",
        gKinds.every((k) => k === "space" || k === "list"), JSON.stringify(gKinds));
    const pFeed = await api(PT, "GET", "/activity?limit=200");
    const pRows = rowsOf(pFeed);
    const pForeign = pRows.filter((r) =>
        (r.entity_type === "space" && r.entity_id !== mkt.id) ||
        (r.entity_type !== "space" && r.entity_type !== "list"));
    check("narrowed user's feed: only THEIR space's rows",
        pFeed.s === 200 && pForeign.length === 0,
        pFeed.s + ", " + pRows.length + " rows, foreign " + pForeign.length);
    const pRecent = await api(PT, "GET", "/activity/recent");
    const recLeak = JSON.stringify(pRecent.b ?? {}).includes("F9X Confidential") ||
        JSON.stringify(pRecent.b ?? {}).includes("F9X Board");
    check("/activity/recent: no confidential space/list names", pRecent.s === 200 && !recLeak,
        recLeak ? "*** LEAKED ***" : "");

    console.log("\n  --- ISS-084: forms across spaces ---");
    const pForms = await api(PT, "GET", "/forms");
    const pFormRows = rowsOf(pForms);
    check("narrowed user's GET /forms: the confidential form is absent",
        pForms.s === 200 && !pFormRows.some((f) => f.id === confForm.b?.id),
        pForms.s + ", " + pFormRows.length + " row(s)");
    const pFormById = await api(PT, "GET", "/forms/" + confForm.b?.id);
    check("…and by id -> 404 (was 200 with the full field list)", pFormById.s === 404, "got " + pFormById.s);
    const oForm = await api(OT, "GET", "/forms/" + confForm.b?.id);
    check("the owner still reads it (200)", oForm.s === 200, "got " + oForm.s);

    console.log("\n  --- sweep: the two seeded department accounts ---");
    for (const email of ["marketing.only@beautybooth.com.bd", "cs.only@beautybooth.com.bd"]) {
        const T = await login(email);
        const f = await api(T, "GET", "/forms");
        const fLeak = rowsOf(f).some((x) => x.id === confForm.b?.id);
        const act = await api(T, "GET", "/activity?limit=50");
        // dept-only holds no activity.view -> the F7 gate answers; either way
        // nothing confidential may come back
        const actLeak = act.s === 200 && JSON.stringify(act.b).includes("F9X");
        check(email.split("@")[0] + ": forms clean + activity " + act.s + " clean",
            !fLeak && !actLeak, "forms " + rowsOf(f).length + ", activity " + act.s);
    }

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    await api(OT, "DELETE", "/task-dependencies/" + edge.b?.id).catch(() => {});
    for (const id of [mine.b?.id, confTask.b?.id])
        if (id) await api(OT, "DELETE", "/tasks/" + id + "?hard=true").catch(() => {});
    if (confForm.b?.id) {
        await db.query("DELETE FROM form_fields WHERE form_id=?", [confForm.b.id]).catch(() => {});
        await db.query("DELETE FROM forms WHERE id=?", [confForm.b.id]).catch(() => {});
    }
    if (confList.b?.id) await db.query("DELETE FROM statuses WHERE scope_id=?", [confList.b.id]).catch(() => {});
    if (confList.b?.id) await db.query("DELETE FROM lists WHERE id=?", [confList.b.id]).catch(() => {});
    if (conf.b?.id) {
        await db.query("DELETE FROM user_roles WHERE scope_id=?", [conf.b.id]).catch(() => {});
        await db.query("DELETE FROM spaces WHERE id=?", [conf.b.id]).catch(() => {});
    }
    if (roleId) await api(OT, "DELETE", "/roles/" + roleId).catch(() => {});
    for (const t of ["user_roles", "sessions", "notifications"])
        await db.query("DELETE FROM " + t + " WHERE user_id=?", [pid]).catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE actor_id=?", [pid]).catch(() => {});
    await db.query("DELETE FROM users WHERE id=?", [pid]);
    await db.query("DELETE FROM tasks WHERE name LIKE 'F9X%'").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE JSON_EXTRACT(context,'$.name') LIKE 'F9X%'").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR AND entity_type IN ('space','list')").catch(() => {});
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  users " + await q("users") + " (15) | spaces " + await q("spaces") + " (6) | tasks " +
        await q("tasks") + " (46) | forms " + await q("forms") + " (0) | roles " +
        (await db.query("SELECT COUNT(*) n FROM roles WHERE archived_at IS NULL"))[0][0].n + " (5)");
    console.log(bad === 0
        ? "\n  PASS — all three leaks closed; owners/admins unchanged. ISS-053/060/084 fixed.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
