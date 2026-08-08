// F34 — the SYMMETRIC proof. P42 re-verified 15 issues on the pre-fix tree and
// every one REPRODUCED (testing/evidence/PHASE-42/issue-reverification.txt).
// This replays each repro on the FIXED tree; the pass condition is inverted:
// every one must now FAIL to reproduce.
//
//   API_PORT=5711 node fixing/evidence/F34/reverify-probe.cjs
//
// Needs the dev API (:5711, dev DB `taskmanagement`, DISABLE_RATE_LIMIT=1 for
// the 50-parallel check). Self-cleaning: every row it creates is deleted, and
// it ends with the X8 baseline counts.
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";

let pass = 0, fail = 0;
const ok = (id, label, cond, detail = "") => {
    if (cond) { pass += 1; console.log("  PASS  " + id + "  " + label + (detail ? "   [" + detail + "]" : "")); }
    else { fail += 1; console.log("  FAIL  " + id + "  " + label + (detail ? "   [" + detail + "]" : "")); }
};
const H = (t) => ({ "Content-Type": "application/json", Authorization: "Bearer " + t });
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const login = async (email) => {
    const r = await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "Owner@12345" }) });
    const b = await j(r);
    if (!b.access_token) throw new Error("login failed for " + email + " (" + r.status + ")");
    return b.access_token;
};

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    // F3's documented frame rule: a raw SQL session must pin time_zone to
    // +00:00 or every TIMESTAMP read comes back Dhaka-shifted and "looks 6h
    // off" — the exact trap frame-note.txt warns about.
    await db.query("SET time_zone='+00:00'");
    const one = async (q, p = []) => (await db.query(q, p))[0][0];
    const t0 = new Date();

    console.log("================ F34 RE-VERIFICATION (P42's 15, inverted) ================");
    const OT = await login("owner@company.local");
    const GT = await login("guest@beautybooth.com.bd");
    const MT = await login("marketing.only@beautybooth.com.bd");

    // a scratch list to create tasks in (the busiest list)
    const list = (await one(
        `SELECT l.id, (SELECT COUNT(*) FROM tasks WHERE primary_list_id=l.id) n
           FROM lists l ORDER BY n DESC LIMIT 1`));
    const taskType = (await one(`SELECT id FROM task_types WHERE LOWER(name)='task' LIMIT 1`));
    const bugType = (await one(`SELECT id FROM task_types WHERE LOWER(name)='bug' LIMIT 1`));
    const rakib = (await one(`SELECT id FROM users WHERE email LIKE 'rakib@%' LIMIT 1`));
    const cleanupTasks = [];

    // ── ISS-001 · CRITICAL · wire vs stored 6h apart ─────────────────────────
    {
        const r = await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 clock probe", task_type_id: taskType.id }) });
        const b = await j(r);
        cleanupTasks.push(b.id);
        const stored = (await one(`SELECT created_at FROM tasks WHERE id=?`, [b.id])).created_at;
        const wire = new Date(b.created_at).getTime();
        const storedMs = stored instanceof Date ? stored.getTime() : new Date(stored + "Z").getTime();
        const diffH = Math.abs(wire - storedMs) / 3600e3;
        // stored comes back session-UTC (timezone:+00:00 above), wire is ISO — the
        // P42 repro showed 6h; fixed = identical instants.
        ok("ISS-001", "wire and stored timestamps are the SAME instant", r.status === 201 && diffH < 0.01,
            "diff " + diffH.toFixed(2) + "h");
    }

    // ── ISS-024 · HIGH · guest uses ungated dependency.manage ────────────────
    {
        const a = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 dep A", task_type_id: taskType.id }) }));
        const b2 = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 dep B", task_type_id: taskType.id }) }));
        cleanupTasks.push(a.id, b2.id);
        const r = await fetch(B + "/task-dependencies", { method: "POST", headers: H(GT),
            body: JSON.stringify({ task_id: a.id, related_task_id: b2.id }) });
        ok("ISS-024", "a guest's dependency write is REFUSED (was 201)", r.status === 403, "got " + r.status);
    }

    // ── ISS-047 · HIGH · own-scope not enforced on writes ────────────────────
    {
        // D12.1 made the guest the read-only persona; the general own-scope
        // enforcement (F8's assertScoped) is jest-proven (rbac 289). The live
        // repro here: a guest PATCH on someone else's task — pre-F28 this was
        // 200 (guests held task.edit at scope=all).
        const a = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 scope probe", task_type_id: taskType.id }) }));
        cleanupTasks.push(a.id);
        const r = await fetch(B + "/tasks/" + a.id, { method: "PATCH", headers: H(GT),
            body: JSON.stringify({ name: "hijacked" }) });
        ok("ISS-047", "editing someone else's task without the grant is REFUSED", r.status === 403, "got " + r.status);
    }

    // ── ISS-053 · HIGH · dependency hydration leaks an unseeable task ────────
    {
        // marketing.only@ is space-scoped to Marketing+CS. An engineering task
        // is invisible to them — direct read must 404 (no oracle), and the
        // pre-fix leak (hydrated titles through /task-dependencies) is gone
        // because the hydration path now redacts (F9).
        const engTask = (await one(
            `SELECT t.id FROM tasks t JOIN lists l ON l.id=t.primary_list_id
              JOIN spaces s ON s.id=l.space_id WHERE s.name='Engineering' LIMIT 1`));
        const r = await fetch(B + "/tasks/" + engTask.id, { headers: H(MT) });
        const r2 = await fetch(B + "/tasks/" + engTask.id + "/dependencies", { headers: H(MT) });
        ok("ISS-053", "an unseeable task stays unseeable — direct AND via dependencies",
            r.status === 404 && (r2.status === 404 || r2.status === 403),
            "direct " + r.status + ", deps " + r2.status);
    }

    // ── ISS-060 · HIGH · guest reads the people-management audit trail ───────
    {
        const r = await fetch(B + "/activity?limit=50", { headers: H(GT) });
        const b = await j(r);
        const rows = Array.isArray(b?.data) ? b.data : [];
        const peopleRows = rows.filter((x) => x.entity_type === "user");
        ok("ISS-060", "the guest feed carries ZERO people-management rows (was 31)",
            r.status === 200 && peopleRows.length === 0,
            r.status + ", user-rows " + peopleRows.length + "/" + rows.length);
    }

    // ── ISS-063 · HIGH · a 60-minute-old comment is still editable ───────────
    {
        const t = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 comment window", task_type_id: taskType.id }) }));
        cleanupTasks.push(t.id);
        const c = await j(await fetch(B + "/tasks/" + t.id + "/comments", { method: "POST", headers: H(OT),
            body: JSON.stringify({ body: "F34 edit-window probe" }) }));
        await db.query(`UPDATE comments SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 MINUTE) WHERE id=?`, [c.id]);
        const r = await fetch(B + "/comments/" + c.id, { method: "PATCH", headers: H(OT),
            body: JSON.stringify({ body: "too late" }) });
        ok("ISS-063", "a 60-minute-old comment REFUSES the edit (window enforced)",
            r.status === 403 || r.status === 409 || r.status === 422, "got " + r.status);
    }

    // ── ISS-081 · HIGH · an S0 bug is born already SLA-breached ──────────────
    {
        const r = await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 S0 probe",
                task_type_id: bugType.id, bug_severity: "S0" }) });
        const b = await j(r);
        cleanupTasks.push(b.id);
        const mins = (new Date(b.sla_due_at).getTime() - Date.now()) / 60e3;
        ok("ISS-081", "an S0's deadline is in the FUTURE (was stored −240 min)",
            r.status === 201 && mins > 0, Math.round(mins) + " min ahead (business clock)");
    }

    // ── ISS-083 · HIGH · password rule is isLength only ──────────────────────
    {
        const r = await fetch(B + "/auth/change-password", { method: "POST", headers: H(OT),
            body: JSON.stringify({ currentPassword: "Owner@12345", newPassword: "aaaaaaaa" }) });
        ok("ISS-083", "an 8×'a' password is REFUSED by the policy", r.status === 422, "got " + r.status);
    }

    // ── ISS-087 · HIGH · 50 concurrent reads → 500s ──────────────────────────
    {
        const url = B + "/lists/" + list.id + "/tasks?limit=50";
        const rs = await Promise.all(Array.from({ length: 50 }, () => fetch(url, { headers: H(OT) })));
        const non200 = rs.filter((r) => r.status !== 200).length;
        ok("ISS-087", "50 parallel reads: zero failures (was 42/50 failing)", non200 === 0, non200 + " non-200");
    }

    // ── ISS-046 · MEDIUM · subtasks_count stays 0 ────────────────────────────
    {
        const p = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 parent", task_type_id: taskType.id }) }));
        const k = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 child", task_type_id: taskType.id, parent_task_id: p.id }) }));
        cleanupTasks.push(k.id, p.id);
        const fresh = await j(await fetch(B + "/tasks/" + p.id, { headers: H(OT) }));
        ok("ISS-046", "the parent counts its subtask (was 0)", fresh.subtasks_count === 1,
            "subtasks_count " + fresh.subtasks_count);
    }

    // ── ISS-064 · MEDIUM · a plain comment produces no notification ──────────
    {
        const t = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 notif probe",
                task_type_id: taskType.id, assignees: [rakib.id] }) }));
        cleanupTasks.push(t.id);
        const before = (await one(`SELECT COUNT(*) n FROM notifications WHERE user_id=? AND type='comment'`, [rakib.id])).n;
        await fetch(B + "/tasks/" + t.id + "/comments", { method: "POST", headers: H(OT),
            body: JSON.stringify({ body: "F34: does this notify?" }) });
        const after = (await one(`SELECT COUNT(*) n FROM notifications WHERE user_id=? AND type='comment'`, [rakib.id])).n;
        ok("ISS-064", "the assignee IS notified of the comment (was 0)", after === before + 1,
            before + " -> " + after);
    }

    // ── ISS-077 · MEDIUM · PATCH a form with its own slug → 422 ──────────────
    {
        const bugsList = (await one(`SELECT id FROM lists WHERE name='Bugs' LIMIT 1`))
            ?? list;
        const f = await j(await fetch(B + "/forms", { method: "POST", headers: H(OT),
            body: JSON.stringify({ list_id: bugsList.id, title: "F34 slug probe" }) }));
        if (!f.id) { ok("ISS-077", "form create failed (" + JSON.stringify(f).slice(0,80) + ")", false); }
        const r = await fetch(B + "/forms/" + f.id, { method: "PATCH", headers: H(OT),
            body: JSON.stringify({ slug: f.slug, title: "F34 slug probe renamed" }) });
        await fetch(B + "/forms/" + f.id, { method: "DELETE", headers: H(OT) });
        ok("ISS-077", "a form accepts its OWN slug back (was 422)", r.status === 200, "got " + r.status);
    }

    // ── ISS-084 · MEDIUM · scoped user reads a foreign-space form ────────────
    {
        const engList = (await one(
            `SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Engineering' LIMIT 1`));
        const f = await j(await fetch(B + "/forms", { method: "POST", headers: H(OT),
            body: JSON.stringify({ list_id: engList.id, title: "F34 foreign form" }) }));
        if (!f.id) { ok("ISS-084", "form create failed (" + JSON.stringify(f).slice(0,80) + ")", false); }
        const r = await fetch(B + "/forms/" + f.id, { headers: H(MT) });
        await fetch(B + "/forms/" + f.id, { method: "DELETE", headers: H(OT) });
        ok("ISS-084", "a foreign-space form is INVISIBLE to the scoped user (was 200)",
            r.status === 404 || r.status === 403, "got " + r.status);
    }

    // ── ISS-085 · MEDIUM · a disallowed Origin returns 500 ───────────────────
    {
        const r = await fetch(B + "/health", { headers: { Origin: "https://evil.example" } });
        ok("ISS-085", "a disallowed Origin gets a clean answer (was 500)", r.status !== 500, "got " + r.status);
    }

    // ── ISS-073 · MEDIUM · notifications survive a hard-deleted task ─────────
    {
        const t = await j(await fetch(B + "/tasks", { method: "POST", headers: H(OT),
            body: JSON.stringify({ primary_list_id: list.id, name: "F34 orphan probe",
                task_type_id: taskType.id, assignees: [rakib.id] }) }));
        const del = await fetch(B + "/tasks/" + t.id + "?hard=true", { method: "DELETE", headers: H(OT) });
        const orphans = (await one(
            `SELECT COUNT(*) n FROM notifications WHERE entity_type='task' AND entity_id=?`, [t.id])).n;
        ok("ISS-073", "a hard delete takes its notifications with it (was 1 orphan)",
            (del.status === 204 || del.status === 200) && orphans === 0, "orphans " + orphans);
    }

    // ── CLEANUP + X8 ─────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    for (const id of cleanupTasks.filter(Boolean)) {
        await fetch(B + "/tasks/" + id + "?hard=true", { method: "DELETE", headers: H(OT) }).catch(() => {});
    }
    await db.query(`DELETE FROM tasks WHERE name LIKE 'F34 %'`);
    await db.query(`DELETE FROM comments WHERE body LIKE 'F34%'`);
    await db.query(`DELETE FROM notifications WHERE created_at >= ?`, [t0]);
    await db.query(`DELETE FROM workspace_activity WHERE created_at >= ?`, [t0]);
    await db.query(`DELETE FROM forms WHERE title LIKE 'F34 %'`);
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  X8: tasks " + await q("tasks") + " (46) | lists " + await q("lists") +
        " (13) | notif " + await q("notifications") + " (57) | forms " + await q("forms") +
        " (0) | comments " + await q("comments") + " (7)");
    await db.end();

    console.log("\n================================================");
    console.log("  " + pass + " of 15 no longer reproduce, " + fail + " still do");
    console.log(fail === 0
        ? "  PASS — the symmetric proof holds: P42 proved them real, F34 proves them gone."
        : "  *** " + fail + " ISSUE(S) STILL REPRODUCE ***");
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("PROBE ERROR " + e.message); process.exit(2); });
