// F5 — ISS-063b, the server half of the proof: `edited_at` is null until an
// edit, set the moment one lands, and survives on the list read the client
// renders from. (The client's axios layer camelises it to `editedAt`; the DOM
// half is the Playwright run alongside this file.)
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 58) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const OT = await login("owner@company.local");
    const [[list]] = await db.query("SELECT id FROM lists WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
    console.log("\n  === F5 — edited_at on the wire (ISS-063b, server half) ===\n");

    const task = (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name: "TEST-F5-edited" })).b;
    const cm = (await api(OT, "POST", "/tasks/" + task.id + "/comments", { body: "original wording" })).b;
    check("a fresh comment has edited_at = null", cm.edited_at === null, String(cm.edited_at));

    const up = await api(OT, "PATCH", "/comments/" + cm.id, { body: "rewritten wording" });
    check("PATCH within the window → 200 with edited_at set", up.s === 200 && !!up.b.edited_at, up.b.edited_at);

    const listRead = await api(OT, "GET", "/tasks/" + task.id + "/comments");
    const row = (Array.isArray(listRead.b) ? listRead.b : listRead.b?.data ?? []).find((c) => c.id === cm.id);
    check("the LIST read (what the drawer renders) carries it", !!row?.edited_at, row?.edited_at);
    check("…and the rewritten body", row?.body === "rewritten wording", row?.body);

    // the marker's !deletedAt guard: a tombstone must not wear "(edited)"
    await api(OT, "DELETE", "/comments/" + cm.id);
    const afterDel = await api(OT, "GET", "/tasks/" + task.id + "/comments");
    const tomb = (Array.isArray(afterDel.b) ? afterDel.b : afterDel.b?.data ?? []).find((c) => c.id === cm.id);
    check("a deleted comment is a tombstone (client hides the marker)",
        !tomb || !!tomb.deleted_at, tomb ? "deleted_at=" + tomb.deleted_at : "removed from list");

    await api(OT, "DELETE", "/tasks/" + task.id + "?hard=true");
    const [left] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F5-edited%'");
    if (left.length) { const ids = left.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]); }
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("\n  cleanup: tasks " + await q("tasks") + " (46) | comments " + await q("comments") + " (7)");
    console.log(bad === 0 ? "\n  PASS — the wire half holds; the DOM half is the Playwright proof.\n"
                          : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad === 0 ? 0 : 1);
})();
