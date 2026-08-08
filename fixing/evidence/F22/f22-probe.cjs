// F22 — the business rules the spec promises (ISS-011, 019, 020, 034, 051).
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

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const one = async (q, p) => (await db.query(q, p))[0][0];
    const OT = await login("owner@company.local");
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const done = await one(
        "SELECT id FROM statuses WHERE scope_id=? AND status_group='done' LIMIT 1", [list.id]);
    const mk = async (name) => (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name })).b;

    console.log("\n  === F22 — the promised business rules ===\n");

    console.log("  --- ISS-011a: tag.in_use ---");
    const tag = (await api(OT, "POST", "/tags", { name: "F22-rule-tag" })).b;
    const T1 = await mk("F22 tagged task");
    await api(OT, "POST", "/tasks/" + T1.id + "/tags", { tag_ids: [tag.id] });
    const delInUse = await api(OT, "DELETE", "/tags/" + tag.id);
    check("deleting an in-use tag -> 409 tag.in_use (was: silent strip)",
        delInUse.s === 409 && delInUse.b?.error?.code === "tag.in_use",
        "got " + delInUse.s + " " + (delInUse.b?.error?.code ?? ""));
    const [[still]] = await db.query(
        "SELECT COUNT(*) n FROM task_tags WHERE tag_id=?", [tag.id]);
    check("…and the task KEPT its tag", still.n === 1, "links " + still.n);
    await api(OT, "DELETE", "/tasks/" + T1.id + "/tags/" + tag.id);
    const delFree = await api(OT, "DELETE", "/tags/" + tag.id);
    check("an unused tag still deletes (204)", delFree.s === 204, "got " + delFree.s);

    console.log("\n  --- ISS-011b: task.cannot_complete_blocked ---");
    const blocker = await mk("F22 the blocker");
    const blocked = await mk("F22 the blocked one");
    // the only stored dep_type is "blocks": (task_id blocks related_task_id)
    const dep = await api(OT, "POST", "/task-dependencies",
        { task_id: blocker.id, related_task_id: blocked.id, type: "blocks" });
    check("dependency created (blocker blocks blocked)", dep.s === 201, "got " + dep.s);
    const tryDone = await api(OT, "PATCH", "/tasks/" + blocked.id, { status_id: done.id });
    check("completing the BLOCKED task -> 409 (was: 200)",
        tryDone.s === 409 && tryDone.b?.error?.code === "task.cannot_complete_blocked",
        "got " + tryDone.s + " " + (tryDone.b?.error?.code ?? ""));
    const bulkTry = await api(OT, "POST", "/tasks/bulk",
        { ids: [blocked.id], patch: { status_id: done.id } });
    check("…the BULK path refuses too", bulkTry.s === 409, "got " + bulkTry.s);
    await api(OT, "PATCH", "/tasks/" + blocker.id, { status_id: done.id });
    const nowDone = await api(OT, "PATCH", "/tasks/" + blocked.id, { status_id: done.id });
    check("complete the blocker first -> the blocked task completes (200)",
        nowDone.s === 200, "got " + nowDone.s);

    console.log("\n  --- ISS-011c: sprint.overlap ---");
    const s1 = await api(OT, "POST", "/sprints",
        { name: "F22 sprint A", start_date: "2027-03-01", end_date: "2027-03-14" });
    check("a disjoint sprint creates (201)", s1.s === 201, "got " + s1.s);
    const s2 = await api(OT, "POST", "/sprints",
        { name: "F22 sprint B", start_date: "2027-03-10", end_date: "2027-03-24" });
    check("an OVERLAPPING sprint -> 409 sprint.overlap (was: 201)",
        s2.s === 409 && s2.b?.error?.code === "sprint.overlap",
        "got " + s2.s + " " + (s2.b?.error?.code ?? ""));
    const s3 = await api(OT, "POST", "/sprints",
        { name: "F22 sprint C", start_date: "2027-03-15", end_date: "2027-03-28" });
    check("back-to-back (no overlap) still fine (201)", s3.s === 201, "got " + s3.s);

    console.log("\n  --- ISS-019: headship SURVIVES deactivation ---");
    const [[mkt]] = await db.query(
        "SELECT s.id sid, s.head_user_id, u.email FROM spaces s JOIN users u ON u.id=s.head_user_id WHERE s.name='Marketing'");
    const deact = await api(OT, "POST", "/users/" + mkt.head_user_id + "/deactivate");
    const [[afterDeact]] = await db.query(
        "SELECT head_user_id FROM spaces WHERE id=?", [mkt.sid]);
    check("deactivate the Marketing head -> headship KEPT (was: NULLed)",
        deact.s === 204 && afterDeact.head_user_id === mkt.head_user_id,
        "head " + (afterDeact.head_user_id ? "kept" : "CLEARED"));
    const react = await api(OT, "POST", "/users/" + mkt.head_user_id + "/reactivate");
    const [[afterReact]] = await db.query(
        "SELECT head_user_id FROM spaces WHERE id=?", [mkt.sid]);
    check("reactivate -> the department is exactly as it was",
        react.s === 204 && afterReact.head_user_id === mkt.head_user_id, "");

    console.log("\n  --- ISS-020: the last-admin backstop ---");
    const [[anAdmin]] = await db.query(
        "SELECT id, email FROM users WHERE role='admin' AND status='active' LIMIT 1");
    const demoteOk = await api(OT, "PATCH", "/users/" + anAdmin.id + "/role", { role: "member" });
    check("demoting an admin WITH an active owner present -> 200 (owner can fix things)",
        demoteOk.s === 200, "got " + demoteOk.s);
    await api(OT, "PATCH", "/users/" + anAdmin.id + "/role", { role: "admin" });
    // The backstop protects the workspace whose owner is NOT active (imports,
    // hand edits). Force that state briefly, entirely under our control:
    const [[owner]] = await db.query("SELECT id FROM users WHERE role='owner' LIMIT 1");
    await db.query("UPDATE users SET status='deactivated' WHERE id=?", [owner.id]);
    await db.query("UPDATE users SET role='member' WHERE role='admin' AND id<>?", [anAdmin.id]);
    const demoteLast = await api(OT, "PATCH", "/users/" + anAdmin.id + "/role", { role: "member" });
    check("with NO other active admin-capable account -> 409 role.last_admin",
        demoteLast.s === 409 && demoteLast.b?.error?.code === "role.last_admin",
        "got " + demoteLast.s + " " + (demoteLast.b?.error?.code ?? ""));
    const deactLast = await api(OT, "POST", "/users/" + anAdmin.id + "/deactivate");
    check("…and deactivating them is refused the same way",
        deactLast.s === 409 && deactLast.b?.error?.code === "role.last_admin",
        "got " + deactLast.s);
    await db.query("UPDATE users SET status='active' WHERE id=?", [owner.id]);
    await db.query(
        "UPDATE users SET role='admin' WHERE email IN ('farhana@beautybooth.com.bd','rakib@beautybooth.com.bd','tanvir@beautybooth.com.bd')");

    console.log("\n  --- ISS-034: an archived space is frozen ---");
    const SP = (await api(OT, "POST", "/spaces", { name: "F22 Frozen Space" })).b;
    await api(OT, "POST", "/spaces/" + SP.id + "/archive");
    const renameArch = await api(OT, "PATCH", "/spaces/" + SP.id, { name: "renamed while archived" });
    check("PATCH an archived space -> 409 space.archived (was: 200)",
        renameArch.s === 409 && renameArch.b?.error?.code === "space.archived",
        "got " + renameArch.s + " " + (renameArch.b?.error?.code ?? ""));
    await api(OT, "POST", "/spaces/" + SP.id + "/unarchive");
    const renameLive = await api(OT, "PATCH", "/spaces/" + SP.id, { name: "F22 Frozen Space v2" });
    check("unarchive first -> the edit works (200)", renameLive.s === 200, "got " + renameLive.s);

    console.log("\n  --- ISS-051: an archived task is frozen for ALL writes ---");
    const AT = await mk("F22 archived target");
    await api(OT, "POST", "/tasks/" + AT.id + "/archive");
    const cArch = await api(OT, "POST", "/tasks/" + AT.id + "/comments", { body: "into the void" });
    check("comment on an archived task -> 409 task.archived (was: 201)",
        cArch.s === 409 && cArch.b?.error?.code === "task.archived",
        "got " + cArch.s + " " + (cArch.b?.error?.code ?? ""));
    const live = await mk("F22 live end");
    const depArch = await api(OT, "POST", "/task-dependencies",
        { task_id: live.id, related_task_id: AT.id, type: "blocks" });
    check("dependency onto an archived task -> 409 (was: 201, edge rendered)",
        depArch.s === 409 && depArch.b?.error?.code === "task.archived",
        "got " + depArch.s + " " + (depArch.b?.error?.code ?? ""));

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    await db.query("DELETE FROM sprints WHERE name LIKE 'F22 %'").catch(() => {});
    const [strays] = await db.query("SELECT id FROM tasks WHERE name LIKE 'F22 %'");
    for (const r of strays) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers",
                         "notifications", "task_dependencies"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM task_dependencies WHERE related_task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.id]).catch(() => {});
    }
    const [spst] = await db.query("SELECT id FROM spaces WHERE name LIKE 'F22 %'");
    for (const sp of spst) {
        await db.query("DELETE FROM statuses WHERE scope_type='space' AND scope_id=?", [sp.id]).catch(() => {});
        await db.query("DELETE FROM spaces WHERE id=?", [sp.id]).catch(() => {});
    }
    await db.query("DELETE FROM tags WHERE name LIKE 'F22-%'").catch(() => {});
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    const [[adm]] = await db.query("SELECT COUNT(*) n FROM users WHERE role='admin' AND status='active'");
    console.log("  tasks " + await q("tasks") + " (46) | sprints " + await q("sprints") +
        " (1) | spaces " + await q("spaces") + " (6) | tags " + await q("tags") +
        " (baseline) | active admins " + adm.n + " (3) | statuses " + await q("statuses") + " (65)");
    console.log(bad === 0
        ? "\n  PASS — the spec's promises are enforced.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
