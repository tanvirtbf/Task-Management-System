// F3 — the my-work buckets after splitting `ymd` into storedDateYmd + dhakaToday.
// A task due yesterday must be "overdue", due today "today", +3d "next", +10d
// absent, no due date "unscheduled". Proves the stored-DATE read path and the
// business-"today" path still agree after they were separated.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const pad = (s, n) => String(s).padEnd(n);
const dhakaToday = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
const addDays = (y, n) => { const [a, b, c] = y.split("-").map(Number);
    return new Date(Date.UTC(a, b - 1, c + n)).toISOString().slice(0, 10); };
let bad = 0;

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root", database: "taskmanagement" });
    const OT = await login("owner@company.local");
    if (!OT) { console.error("  cannot log in"); process.exit(1); }
    const [[me]] = await db.query("SELECT id FROM users WHERE email='owner@company.local'");
    const [[list]] = await db.query("SELECT id FROM lists WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
    const today = dhakaToday();

    console.log("\n  === F3 — my-work buckets ===");
    console.log("  Dhaka today = " + today + "   (process TZ " + (process.env.TZ || "system") + ")\n");

    const cases = [
        ["overdue",     addDays(today, -1)],
        ["today",       today],
        ["next",        addDays(today, 3)],
        [null,          addDays(today, 10)],   // beyond 7d -> in no bucket
        ["unscheduled", null],
    ];
    const made = [];
    for (const [want, due] of cases) {
        const r = await api(OT, "POST", "/tasks", { primary_list_id: list.id,
            name: "TEST-F03-mw-" + (want ?? "far"), due_date: due });
        if (!r.b?.id) { console.log("  could not create (" + r.s + "): " + JSON.stringify(r.b).slice(0, 120)); bad++; continue; }
        made.push([r.b.id, want, due]);
        await api(OT, "POST", "/tasks/" + r.b.id + "/assignees", { user_ids: [me.id] });
    }

    const mw = await api(OT, "GET", "/tasks/my-work");
    const buckets = mw.b?.data ?? mw.b ?? {};
    const findIn = (id) => Object.keys(buckets).find((k) =>
        Array.isArray(buckets[k]) && buckets[k].some((t) => t.id === id)) ?? null;

    console.log("  " + pad("task", 26) + pad("due_date", 14) + pad("expected", 14) + "actual");
    for (const [id, want, due] of made) {
        const got = findIn(id);
        const ok = got === want;
        if (!ok) bad++;
        console.log("  " + pad((ok ? "OK   " : "FAIL ") + "TEST-F03-mw-" + (want ?? "far"), 26) +
            pad(due ?? "(none)", 14) + pad(want ?? "(none)", 14) + (got ?? "(none)"));
    }

    // the wire due_date must equal exactly what was asked — the stored-DATE read path
    for (const [id, , due] of made.filter((m) => m[2])) {
        const w = (await api(OT, "GET", "/tasks/" + id)).b?.due_date;
        if (w !== due) { bad++; console.log("  FAIL  wire due_date " + w + " != asked " + due); }
    }
    console.log("  " + (bad ? "" : "OK   ") + "every wire due_date round-trips exactly");

    for (const [id] of made) await api(OT, "DELETE", "/tasks/" + id + "?hard=true");
    const [left] = await db.query("SELECT id FROM tasks WHERE name LIKE 'TEST-F03-mw%'");
    if (left.length) { const ids = left.map((r) => r.id);
        for (const t of ["task_activity", "task_assignees", "comments"])
            await db.query("DELETE FROM " + t + " WHERE task_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM notifications WHERE entity_id IN (?)", [ids]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id IN (?)", [ids]); }
    const [[n]] = await db.query("SELECT COUNT(*) n FROM tasks");
    console.log("\n  cleanup: tasks " + n.n + " (46)");
    console.log(bad === 0 ? "\n  PASS\n" : "\n  *** " + bad + " FAILURE(S) ***\n");
    await db.end();
    process.exit(bad === 0 ? 0 : 1);
})();
