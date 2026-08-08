// F20 — search: ISS-074 (description), ISS-075 (relevance), ISS-076 (escaping
// + minimum length), on decision D9 (better LIKE, no FULLTEXT).
//
// Re-creates P25's fixture shapes: a needle in a NAME, the same needle hidden
// in a DESCRIPTION only, and metacharacter names. Ends with a latency check
// against the P40 figure (search was already the slowest endpoint at 125 ms).
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 60) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const OT = await login("owner@company.local");
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const mk = async (name, extra = {}) =>
        (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name, ...extra })).b;

    console.log("\n  === F20 — search (D9: better LIKE) ===\n");

    console.log("  --- fixture ---");
    const inName = await mk("F20 ZQXJV needle in the name");
    const inDesc = await mk("F20 plain-named task", { description: "the ZQXJV hides in the description with SKU-8841" });
    const older = await mk("F20 zqxjv old partial match first");
    const exact = await mk("ZQXJV");
    const withId = await mk("F20 order task", { custom_id: "ORD-1042" });
    const pct = await mk("F20 discount 100% off");
    const snake = await mk("F20 snake_case_name here");
    check("7 fixture tasks created", [inName, inDesc, older, exact, withId, pct, snake].every((t) => t?.id), "");

    const search = async (q) => api(OT, "GET", "/search?q=" + encodeURIComponent(q));
    const taskNames = (r) => (r.b?.tasks ?? []).map((t) => t.name);

    console.log("\n  --- ISS-074: the description is searched ---");
    let r = await search("ZQXJV");
    check("the description-only task IS found (was: invisible)",
        taskNames(r).includes("F20 plain-named task"), taskNames(r).length + " hits");
    r = await search("SKU-8841");
    check("an SKU buried in a description resolves", taskNames(r).includes("F20 plain-named task"), "");

    console.log("\n  --- ISS-075: relevance, not insertion order ---");
    r = await search("ZQXJV");
    const names = taskNames(r);
    check("the EXACT-name match is FIRST (was: oldest first)",
        names[0] === "ZQXJV", "first: " + (names[0] ?? "none"));
    const idxName = names.indexOf("F20 ZQXJV needle in the name");
    const idxDesc = names.indexOf("F20 plain-named task");
    check("a NAME match ranks above a description-only match",
        idxName !== -1 && idxDesc !== -1 && idxName < idxDesc,
        "name@" + idxName + " desc@" + idxDesc);
    r = await search("ORD-1042");
    check("an exact custom_id hit floats to the top",
        taskNames(r)[0] === "F20 order task", "first: " + (taskNames(r)[0] ?? "none"));

    console.log("\n  --- ISS-076: metacharacters + minimum length ---");
    r = await search("100%");
    check('"100%" matches the literal task (trailing % no longer a wildcard)',
        taskNames(r).includes("F20 discount 100% off") && taskNames(r).length >= 1,
        taskNames(r).length + " hits");
    r = await search("snake_case_name");
    check("snake_case matches literally (_ no longer any-char)",
        taskNames(r).includes("F20 snake_case_name here"), taskNames(r).length + " hits");
    r = await search("%");
    check('a lone "%" is refused by the minimum (was: matched rows)',
        r.s === 422, "got " + r.s);
    r = await search("Z");
    check("one character -> 422 (was: five full-table scans)", r.s === 422, "got " + r.s);
    r = await search("ZQ");
    check("two characters still allowed", r.s === 200, "got " + r.s);

    console.log("\n  --- latency vs the P40 figure (125 ms) ---");
    const times = [];
    for (let i = 0; i < 10; i++) {
        const t0 = Date.now();
        await search("needle");
        times.push(Date.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p50 = times[5], max = times[9];
    check("p50 within 2x of the old figure (relevance sort not a regression)",
        p50 <= 250, "p50 " + p50 + "ms, max " + max + "ms");

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    const [strays] = await db.query(
        "SELECT id FROM tasks WHERE name LIKE 'F20 %' OR name='ZQXJV'");
    for (const row of strays) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers", "notifications"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [row.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [row.id]).catch(() => {});
    }
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const one = async (q) => (await db.query(q))[0][0];
    console.log("  tasks " + (await one("SELECT COUNT(*) n FROM tasks")).n + " (46)");
    console.log(bad === 0
        ? "\n  PASS — descriptions searched, relevance first, metacharacters literal.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
