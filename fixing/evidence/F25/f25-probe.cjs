// F25 — Task UI gaps: ISS-050, ISS-054, ISS-055, ISS-066, ISS-069.
//
// Four of the five are client-side, so each is checked BOTH ways: the server
// behaviour the client now uses is exercised live, and the client source is
// asserted to have stopped doing the wrong thing.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const fs = require("node:fs");
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const C = "E:/Task Management System/client/src/";
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 300); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const src = (p) => fs.readFileSync(C + p, "utf8");
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
    const [[otherList]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Marketing' AND l.archived_at IS NULL LIMIT 1");
    const mk = async (name, listId = list.id, extra = {}) =>
        (await api(OT, "POST", "/tasks", { primary_list_id: listId, name, ...extra })).b;

    console.log("\n  === F25 — Task UI gaps ===\n");

    console.log("  --- ISS-050: archive is reversible; delete means delete ---");
    const T = await mk("F25 lifecycle task");
    const arch = await api(OT, "POST", "/tasks/" + T.id + "/archive");
    let row = await one("SELECT archived_at FROM tasks WHERE id=?", [T.id]);
    check("archive sets archived_at (204)", arch.s === 204 && !!row.archived_at, "");
    const un = await api(OT, "POST", "/tasks/" + T.id + "/unarchive");
    row = await one("SELECT archived_at FROM tasks WHERE id=?", [T.id]);
    check("unarchive CLEARS it — the way back exists (204)",
        un.s === 204 && !row.archived_at, "");
    const apiSrc = src("http/api.ts");
    check("the client api now HAS tasksApi.unarchive (it had none)",
        /unarchive: async \(id: string\)/.test(apiSrc), "");
    const softDel = await api(OT, "DELETE", "/tasks/" + T.id);
    row = await one("SELECT archived_at FROM tasks WHERE id=?", [T.id]);
    check("plain DELETE is still a SOFT delete server-side (the row survives)",
        softDel.s === 204 && !!row, "row present: " + !!row);
    const drawer = src("components/task/TaskDetailDrawer.tsx");
    check("the drawer labels the destructive one \"Delete permanently\"",
        drawer.includes('label: "Delete permanently"'), "");
    check("…sends ?hard=true and confirms first",
        drawer.includes("tasksApi.delete(task.id, true)") && drawer.includes("Modal.confirm"), "");
    check("…and offers Restore once a task is archived",
        drawer.includes('key: "unarchive"') && drawer.includes("task?.archivedAt"), "");
    const bulk = src("components/task/BulkActionToolbar.tsx");
    check("the bulk toolbar does the same (hard delete + honest labels)",
        bulk.includes("tasksApi.delete(id, true)") &&
        bulk.includes("Delete permanently"), "");
    await api(OT, "DELETE", "/tasks/" + T.id + "?hard=true");
    const gone = await one("SELECT COUNT(*) n FROM tasks WHERE id=?", [T.id]);
    check("…and ?hard=true really removes the row", gone.n === 0, "");

    console.log("\n  --- ISS-054: the 'Blocked by' direction is reachable ---");
    const A = await mk("F25 dep A");
    const Bt = await mk("F25 dep B");
    // the client's "Blocked by" now sends the REVERSED pair
    const madeRev = await api(OT, "POST", "/task-dependencies",
        { task_id: Bt.id, related_task_id: A.id, type: "blocks" });
    const view = await api(OT, "GET", "/tasks/" + A.id + "/dependencies");
    check("a reversed edge makes A 'blocked_by' B on the wire",
        madeRev.s === 201 && (view.b?.blocked_by ?? []).length === 1,
        "blocked_by " + (view.b?.blocked_by ?? []).length);
    const deps = src("components/task/DependenciesSection.tsx");
    check("the section has TWO buttons now, not one hardcoded 'blocks'",
        deps.includes('setShowPicker("blocks")') &&
        deps.includes('setShowPicker("blocked_by")'), "");
    check("…and the mutation READS the direction (it never did)",
        deps.includes('direction: "blocks" | "blocked_by"') &&
        deps.includes("direction: showPicker"), "");

    console.log("\n  --- ISS-055: the picker can reach the whole workspace ---");
    const far = await mk("F25 ZQ25 faraway task", otherList.id);
    const found = await api(OT, "GET", "/search?q=ZQ25&types=task");
    const names = (found.b?.tasks ?? []).map((t) => t.name);
    check("a task in ANOTHER space is findable by the picker's source",
        found.s === 200 && names.includes("F25 ZQ25 faraway task"),
        names.length + " hits");
    const cross = await api(OT, "POST", "/task-dependencies",
        { task_id: A.id, related_task_id: far.id, type: "blocks" });
    check("a cross-space dependency is accepted (201) — it always was",
        cross.s === 201, "got " + cross.s);
    check("the client picker now searches instead of listing one list",
        deps.includes("searchApi.search") && !deps.includes("tasksApi.listByList"), "");

    console.log("\n  --- ISS-066: #T-<n> resolves ---");
    const host = await mk("F25 ref host");
    const target = await mk("F25 ref target");
    const targetNo = (await one("SELECT task_number FROM tasks WHERE id=?", [target.id])).task_number;
    const c1 = await api(OT, "POST", "/tasks/" + host.id + "/comments",
        { body: "see #T-" + targetNo + " for the details" });
    const refRow = await one(
        "SELECT COUNT(*) n FROM task_activity WHERE task_id=? AND action='comment_referenced'",
        [target.id]);
    check("#T-<n> on a SAME-LIST task now resolves (was: ignored)",
        c1.s === 201 && refRow.n === 1, "referenced rows " + refRow.n);
    const farNo = (await one("SELECT task_number FROM tasks WHERE id=?", [far.id])).task_number;
    const c2 = await api(OT, "POST", "/tasks/" + host.id + "/comments",
        { body: "and #T-" + farNo + " which lives elsewhere" });
    const farRef = await one(
        "SELECT COUNT(*) n FROM task_activity WHERE task_id=? AND action='comment_referenced'",
        [far.id]);
    const dupCount = (await one(
        "SELECT COUNT(*) n FROM tasks WHERE task_number=?", [farNo])).n;
    check("a T-<n> from ANOTHER list stays unresolved — no guessing",
        c2.s === 201 && farRef.n === 0,
        "T-" + farNo + " exists on " + dupCount + " tasks workspace-wide");
    const cid = await api(OT, "PATCH", "/tasks/" + target.id, { custom_id: "F25-4242" });
    const c3 = await api(OT, "POST", "/tasks/" + host.id + "/comments",
        { body: "and #F25-4242 by custom id" });
    const cidRef = await one(
        "SELECT COUNT(*) n FROM task_activity WHERE task_id=? AND action='comment_referenced'",
        [target.id]);
    check("#CUSTOM-ID still resolves (unchanged)",
        cid.s === 200 && c3.s === 201 && cidRef.n === 2, "referenced rows " + cidRef.n);

    console.log("\n  --- ISS-069: checklist nesting ---");
    const cl = (await api(OT, "POST", "/tasks/" + host.id + "/checklists",
        { name: "F25 nested list" })).b;
    const top = (await api(OT, "POST", "/checklists/" + cl.id + "/items",
        { text: "F25 parent step" })).b;
    const sub = await api(OT, "POST", "/checklists/" + cl.id + "/items",
        { text: "F25 child step", parent_item_id: top.id });
    check("the server accepts parent_item_id (it always did)", sub.s === 201, "got " + sub.s);
    const read = await api(OT, "GET", "/tasks/" + host.id + "/checklists");
    const items = (read.b?.[0]?.items ?? read.b?.data?.[0]?.items ?? []);
    const child = items.find((i) => i.text === "F25 child step");
    check("…and returns parent_item_id on the wire", child?.parent_item_id === top.id,
        "parent " + (child?.parent_item_id ? "set" : "MISSING"));
    const cls = src("components/task/ChecklistsSection.tsx");
    check("the client BUILDS the tree now (it rendered a flat list)",
        cls.includes("childrenOf") && cls.includes("parentItemId"), "");
    check("…and offers an add-sub-item control (there was none)",
        cls.includes("subItemFor") && cls.includes("parentItemId: item.id"), "");
    check("…and the api wrapper forwards parent_item_id",
        /parentItemId\?: string \| null/.test(apiSrc) &&
        apiSrc.includes("parent_item_id: parentItemId"), "");

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    const [strays] = await db.query("SELECT id FROM tasks WHERE name LIKE 'F25 %'");
    for (const r of strays) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers",
                         "notifications", "checklists", "task_dependencies"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM task_dependencies WHERE related_task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.id]).catch(() => {});
    }
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  tasks " + await q("tasks") + " (46) | task_dependencies " +
        await q("task_dependencies") + " (0) | comments " + await q("comments") + " (7)");
    console.log(bad === 0
        ? "\n  PASS — archive is undoable, both directions reachable, T-<n> resolves, checklists nest.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
