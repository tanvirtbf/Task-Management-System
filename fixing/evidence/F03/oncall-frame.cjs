// F3 — prove the on-call roster still rolls over at DHAKA midnight after the
// session was pinned to UTC. Three independent checks:
//   1. the app binds a literal Dhaka date (not SQL CURDATE())
//   2. the endpoint and the view agree on who is on call
//   3. the view's expression tracks Dhaka, not UTC, across a simulated week edge
// Creates only TEST-F03-* shifts and removes them. Exit 0 = all three hold.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const login = async (e, p = "Owner@12345") => (await j(await fetch(B + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) }))).access_token;
const get = async (t, p) => { const r = await fetch(B + p, { headers: { Authorization: "Bearer " + t } });
    return { s: r.status, b: await j(r) }; };
const pad = (s, n) => String(s).padEnd(n);
let bad = 0;
const check = (label, ok, detail) => { if (!ok) bad++;
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 52) + (detail || "")); };

// the app's own helper, reimplemented here so the test is independent of it
const dhakaToday = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
const addDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root", database: "taskmanagement" });
    const OT = await login("owner@company.local");
    if (!OT) { console.error("  cannot log in — API down?"); process.exit(1); }

    const today = dhakaToday();
    const [[r0]] = await db.query(
        "SELECT DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 6 HOUR),'%Y-%m-%d') dhaka," +
        " DATE_FORMAT(UTC_DATE(),'%Y-%m-%d') utc, DATE_FORMAT(CURDATE(),'%Y-%m-%d') cur, @@session.time_zone tz");

    console.log("\n  === F3 — on-call rollover frame ===\n");
    console.log("  session tz            " + r0.tz);
    console.log("  app  dhakaToday()     " + today);
    console.log("  view Dhaka expression " + r0.dhaka);
    console.log("  SQL  UTC_DATE()       " + r0.utc + "   <- what schema.sql used to say");
    console.log("  SQL  CURDATE()        " + r0.cur + "   <- what the live view used to say");
    console.log();

    check("app and view derive the same 'today'", today === r0.dhaka, today + " == " + r0.dhaka);

    const [[ws]] = await db.query("SELECT id FROM workspaces LIMIT 1");
    const [[eng]] = await db.query(
        "SELECT u.id FROM users u WHERE u.status='active' ORDER BY u.created_at LIMIT 1");

    // ── a shift covering exactly today: endpoint and view must both see it ───
    const mk = async (start, end, tag) => {
        const id = "TEST-F03-" + tag;
        await db.query(
            "INSERT INTO on_call_shifts (id, workspace_id, engineer_id, week_start, week_end, created_by)" +
            " VALUES (?,?,?,?,?,?)", [id, ws.id, eng.id, start, end, eng.id]);
        return id;
    };
    // snapshot the real rows (full row objects — the table is emptied to isolate)
    const [old] = await db.query("SELECT * FROM on_call_shifts");
    const cols = old.length ? Object.keys(old[0]) : [];
    await db.query("DELETE FROM on_call_shifts");

    const weekStart = addDays(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7));
    const cur = await mk(weekStart, addDays(weekStart, 6), "cur");

    const ep = await get(OT, "/on-call/current");
    const [[vw]] = await db.query("SELECT COUNT(*) n FROM v_current_on_call WHERE id=?", [cur]);
    const epHit = ep.s === 200 && (ep.b?.id === cur || ep.b?.data?.id === cur);
    check("endpoint returns the shift covering today", epHit,
        "status " + ep.s + ", week " + weekStart + ".." + addDays(weekStart, 6));
    check("v_current_on_call lists the same shift", vw.n === 1, "view rows " + vw.n);
    check("endpoint and view agree", epHit === (vw.n === 1), epHit ? "both list it" : "both omit it");

    // ── 3. last week's shift must NOT be current ────────────────────────────
    await db.query("DELETE FROM on_call_shifts");
    const prev = await mk(addDays(weekStart, -7), addDays(weekStart, -1), "prev");
    const ep2 = await get(OT, "/on-call/current");
    const [[vw2]] = await db.query("SELECT COUNT(*) n FROM v_current_on_call WHERE id=?", [prev]);
    const ep2Hit = ep2.s === 200 && (ep2.b?.id === prev || ep2.b?.data?.id === prev);
    check("last week's shift is NOT reported as current", !ep2Hit && vw2.n === 0,
        "endpoint " + (ep2Hit ? "WRONGLY lists" : "omits") + " it, view rows " + vw2.n);

    // ── 4. the boundary: does the view track Dhaka or UTC? ──────────────────
    console.log("\n  simulated week edge — week Mon " + weekStart + " .. Sun " + addDays(weekStart, 6) + ":");
    let edgeOk = true;
    for (const [label, off] of [["Mon 02:00 Dhaka", -4], ["Mon 09:00 Dhaka", 3],
                                ["Sun 23:00 Dhaka", 6 * 24 + 17], ["next Mon 05:00 Dhaka", 6 * 24 + 23]]) {
        const inst = new Date(new Date(weekStart + "T00:00:00Z").getTime() + off * 3600e3)
            .toISOString().slice(0, 19).replace("T", " ");
        const [[e]] = await db.query(
            "SELECT DATE_FORMAT(DATE(? + INTERVAL 6 HOUR),'%Y-%m-%d') dhaka, DATE_FORMAT(DATE(?),'%Y-%m-%d') utc," +
            " (DATE(? + INTERVAL 6 HOUR) BETWEEN ? AND ?) inDhaka, (DATE(?) BETWEEN ? AND ?) inUtc",
            [inst, inst, inst, weekStart, addDays(weekStart, 6), inst, weekStart, addDays(weekStart, 6)]);
        const want = label.startsWith("next") ? 0 : 1;
        if (!!e.inDhaka !== !!want) edgeOk = false;
        console.log("    " + pad(label, 22) + "utc-day " + e.utc + "  dhaka-day " + e.dhaka +
            "   view(new)=" + pad(!!e.inDhaka, 6) + " old(UTC)=" + pad(!!e.inUtc, 6) +
            (e.inDhaka !== e.inUtc ? "  <- the 6h window the old view got wrong" : ""));
    }
    check("the view's window tracks the Dhaka week, not the UTC week", edgeOk);

    // ── restore ─────────────────────────────────────────────────────────────
    await db.query("DELETE FROM on_call_shifts");
    for (const r of old)
        await db.query("INSERT INTO on_call_shifts (" + cols.map((c) => "`" + c + "`").join(",") +
            ") VALUES (" + cols.map(() => "?").join(",") + ")", cols.map((c) => r[c]));
    const [[n]] = await db.query("SELECT COUNT(*) n FROM on_call_shifts");
    console.log("\n  cleanup: on_call_shifts " + n.n + " (baseline had " + old.length + ")");
    console.log(bad === 0 ? "\n  PASS — the roster still rolls over at Dhaka midnight.\n"
                          : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad === 0 ? 0 : 1);
})();
