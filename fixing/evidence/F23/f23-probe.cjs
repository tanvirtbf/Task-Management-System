// F23 — API contract consistency: the P2 conventions sweep, re-run on the
// fixed tree (ISS-007/008/012/014/040/048/067/010, decision D10).
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const fs = require("node:fs");
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

    console.log("\n  === F23 — API contract consistency ===\n");

    console.log("  --- ISS-007: limit is real on the four §1 endpoints ---");
    for (const [ep, expTotal] of [["/lists", 13], ["/spaces", 6], ["/tags", 8], ["/task-types", null]]) {
        const r = await api(OT, "GET", ep + "?limit=2");
        const n = (r.b?.data ?? []).length;
        const pg = r.b?.pagination ?? {};
        const ok = r.s === 200 && n === 2 && pg.has_more === true && !!pg.next_cursor;
        if (!ok) bad++;
        console.log("  " + pad(ok ? "OK  " : "FAIL", 6) +
            pad(ep + "?limit=2 -> 2 rows, has_more, cursor", 62) +
            n + " rows, has_more " + pg.has_more +
            (expTotal ? ", total " + pg.total_estimate + "/" + expTotal : ""));
    }
    const p1 = await api(OT, "GET", "/lists?limit=5");
    const p2 = await api(OT, "GET", "/lists?limit=5&cursor=" + p1.b.pagination.next_cursor);
    const ids1 = p1.b.data.map((x) => x.id), ids2 = p2.b.data.map((x) => x.id);
    check("following the cursor pages WITHOUT overlap",
        p2.s === 200 && ids2.length === 5 && !ids2.some((id) => ids1.includes(id)),
        ids1.length + " + " + ids2.length);
    const p3 = await api(OT, "GET", "/lists?limit=200");
    check("limit above the row count -> everything, has_more false",
        p3.b.data.length === 13 && p3.b.pagination.has_more === false, p3.b.data.length + " rows");
    const badLimit = await api(OT, "GET", "/lists?limit=0");
    check("limit=0 -> 422 (bounds enforced)", badLimit.s === 422, "got " + badLimit.s);

    console.log("\n  --- ISS-008: every foreign cursor is a 400 ---");
    const cursorCases = [
        ["garbage", "/users?cursor=garbage"],
        ["tampered valid+XX", null], // built below
        ["base64 of junk", "/users?cursor=" + Buffer.from("not json or id").toString("base64url")],
        ["offset cursor tampered", "/lists?limit=2&cursor=" + p1.b.pagination.next_cursor + "XX"],
        ["activity feed garbage", "/activity?cursor=garbage"],
        ["notifications garbage", "/notifications?cursor=garbage"],
    ];
    const usersPage = await api(OT, "GET", "/users?limit=2");
    const validUserCursor = usersPage.b?.pagination?.next_cursor;
    cursorCases[1][1] = "/users?cursor=" + validUserCursor + "XX";
    for (const [label, url] of cursorCases) {
        const r = await api(OT, "GET", url);
        const ok = r.s === 400 && r.b?.error?.code === "pagination.invalid_cursor";
        if (!ok) bad++;
        console.log("  " + pad(ok ? "OK  " : "FAIL", 6) +
            pad(label + " -> 400 pagination.invalid_cursor", 62) +
            "got " + r.s + " " + (r.b?.error?.code ?? ""));
    }
    const validFollow = await api(OT, "GET", "/users?limit=2&cursor=" + validUserCursor);
    check("a cursor the server DID issue still works", validFollow.s === 200,
        "got " + validFollow.s);

    console.log("\n  --- ISS-014: a mistyped filter is a 422, not the full set ---");
    const mistyped = await api(OT, "GET", "/users?search=zzzz");
    check("/users?search= -> 422 naming the parameter (was: all 15 rows)",
        mistyped.s === 422 && JSON.stringify(mistyped.b).includes("search"),
        "got " + mistyped.s);
    const realQ = await api(OT, "GET", "/users?q=zzzz");
    check("/users?q= (the real filter) still works", realQ.s === 200 &&
        (realQ.b?.data ?? []).length === 0, "got " + realQ.s);

    console.log("\n  --- ISS-067: checklist-item PATCH is a closed set ---");
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const T = (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name: "F23 contract task" })).b;
    const cl = (await api(OT, "POST", "/tasks/" + T.id + "/checklists", { name: "F23 list" })).b;
    const item = (await api(OT, "POST", "/checklists/" + cl.id + "/items", { text: "F23 box" })).b;
    const isC = await api(OT, "PATCH", "/checklist-items/" + item.id, { is_completed: true });
    check("is_completed -> 422 pointing at /toggle (was: 200 ignored)",
        isC.s === 422 && JSON.stringify(isC.b).includes("toggle"),
        "got " + isC.s);
    const bogus = await api(OT, "PATCH", "/checklist-items/" + item.id, { due_date: "2026-09-01" });
    check("an unknown field -> 422 naming the accepted set", bogus.s === 422, "got " + bogus.s);
    const legit = await api(OT, "PATCH", "/checklist-items/" + item.id, { text: "F23 box renamed" });
    check("a legitimate PATCH still works (200)", legit.s === 200, "got " + legit.s);
    const [[row]] = await db.query("SELECT is_completed FROM checklist_items WHERE id=?", [item.id]);
    check("…and is_completed was never silently set", row.is_completed === 0, "");

    console.log("\n  --- ISS-040: POST refuses what PATCH refuses ---");
    const sysType = await api(OT, "POST", "/task-types",
        { name: "F23 Type", is_system: true });
    check("POST /task-types with is_system -> 422 (was: 201, dropped to 0)",
        sysType.s === 422, "got " + sysType.s);
    const okType = await api(OT, "POST", "/task-types", { name: "F23 Type" });
    check("without the server-owned field -> 201 as before", okType.s === 201, "got " + okType.s);

    console.log("\n  --- ISS-048: misdirected task-PATCH fields get real answers ---");
    const asg = await api(OT, "PATCH", "/tasks/" + T.id, { assignees: ["u-x"] });
    check("{assignees} -> 422 naming POST /tasks/:id/assignees",
        asg.s === 422 && JSON.stringify(asg.b).includes("/tasks/:id/assignees"),
        "got " + asg.s);
    const tg = await api(OT, "PATCH", "/tasks/" + T.id, { tags: ["tag-x"] });
    check("{tags} -> 422 naming the tags endpoints",
        tg.s === 422 && JSON.stringify(tg.b).includes("/tasks/:id/tags"), "got " + tg.s);
    const pt = await api(OT, "PATCH", "/tasks/" + T.id, { parent_task_id: "t-x" });
    check("{parent_task_id} -> 422 saying it is create-only",
        pt.s === 422 && JSON.stringify(pt.b).includes("cannot be changed"), "got " + pt.s);
    const empty = await api(OT, "PATCH", "/tasks/" + T.id, {});
    check("a genuinely empty body keeps the old message",
        empty.s === 422 && JSON.stringify(empty.b).includes("at least one field"), "got " + empty.s);

    console.log("\n  --- ISS-012 / ISS-010: the documentation tells the truth ---");
    const spec = fs.readFileSync("E:/Task Management System/API_DESIGN.md", "utf8");
    check("§1 documents the four response families (D10)",
        spec.includes("the four response families, documented"), "");
    check("/activity/recent spec now says {data} (the real shape)",
        spec.includes("**200 OK** — `{ data: RecentActivityEntry[] }`"), "");
    const generated = (spec.match(/^\| `[a-z0-9_.]+` \|$/gm) ?? []).length;
    check("the §32 catalog is regenerated from code (" + generated + " codes >= 120)",
        generated >= 120, generated + " listed");
    const recent = await api(OT, "GET", "/activity/recent");
    check("…and /activity/recent really returns {data}", recent.s === 200 &&
        Array.isArray(recent.b?.data), "");

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    await db.query("DELETE FROM task_types WHERE name LIKE 'F23 %'").catch(() => {});
    const [strays] = await db.query("SELECT id FROM tasks WHERE name LIKE 'F23 %'");
    for (const r of strays) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers",
                         "notifications", "checklists"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.id]).catch(() => {});
    }
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  tasks " + await q("tasks") + " (46) | task_types " + await q("task_types") +
        " (baseline) | tags " + await q("tags") + " (8)");
    console.log(bad === 0
        ? "\n  PASS — the contract says what it does and does what it says.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
