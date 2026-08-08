// F10 — session and role freshness: the five repros, re-run on the fixed tree.
//
//   ISS-016  an exp-less token was a permanent credential      -> now 401
//   ISS-021  a role downgrade took ≤15 min to bite             -> next request (D4: live check)
//   ISS-015  change-password left other sessions alive          -> revokes all (mirrors reset)
//   ISS-017  revoked session rows survived ~60 days             -> pruned after 7 days
//   ISS-018  logout leaves the access token valid ≤15 min       -> DOCUMENTED bound, re-measured
//
// Scratch users only; the demo baseline is restored and re-verified.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const fs = require("fs");
const { execSync } = require("node:child_process");
const jwt = require("E:/Task Management System/server/node_modules/jsonwebtoken");
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 300); } };
const as = (t) => ({ Authorization: "Bearer " + t, "Content-Type": "application/json" });
const api = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: as(t),
    body: b === undefined ? undefined : JSON.stringify(b) }); return { s: r.status, b: await j(r) }; };
const loginFull = async (e, p = "Owner@12345") => {
    const r = await fetch(B + "/auth/login", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) });
    const body = await j(r);
    return { token: body.access_token, cookie: r.headers.get("set-cookie") ?? "", status: r.status };
};
const pad = (s, n) => String(s).padEnd(n);
let bad = 0;
const check = (label, ok, detail) => { if (!ok) bad++;
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 66) + (detail || "")); };

const envOf = (file) => Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const SECRET = envOf("E:/Task Management System/server/.env").ACCESS_TOKEN_SECRET;
    const { token: OT } = await loginFull("owner@company.local");
    const [[owner]] = await db.query("SELECT * FROM users WHERE email='owner@company.local'");
    const [[list]] = await db.query("SELECT id FROM lists WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");

    console.log("\n  === F10 — session & role freshness (ISS-015/016/017/018/021) ===\n");

    // ── ISS-016: an exp-less token ───────────────────────────────────────────
    console.log("  --- ISS-016: a signature-valid token with NO exp claim ---");
    const expless = jwt.sign({ sub: owner.id, role: "owner", workspaceId: owner.workspace_id },
        SECRET, { algorithm: "HS256", noTimestamp: true });
    const noExp = await api(expless, "GET", "/auth/me");
    check("exp-less token -> 401 (was 200, a permanent credential)",
        noExp.s === 401, "got " + noExp.s + " " + (noExp.b?.error?.code ?? ""));
    const normal = await api(OT, "GET", "/auth/me");
    check("a normal token still works (200)", normal.s === 200, "got " + normal.s);
    const expiredTok = jwt.sign({ sub: owner.id, role: "owner", workspaceId: owner.workspace_id },
        SECRET, { algorithm: "HS256", expiresIn: -10 });
    check("an expired token still 401s (control)",
        (await api(expiredTok, "GET", "/auth/me")).s === 401, "");

    // ── scratch users ────────────────────────────────────────────────────────
    const mkUser = async (id, email, role) => {
        await db.query(
            "INSERT INTO users (id, workspace_id, first_name, last_name, email, password_hash, role, status) VALUES (?,?,?,?,?,?,?,'active')",
            [id, owner.workspace_id, "F10", "Probe", email, owner.password_hash, role]);
        execSync('npx tsx -e "import { initDb } from \'./src/db/client\'; import { syncUserSystemRole } from \'./src/rbac/bootstrap\'; (async()=>{const db=await initDb(); await syncUserSystemRole(db, \'' +
            owner.workspace_id + "', '" + id + "', '" + role + '\'); process.exit(0);})();"',
            { cwd: "E:/Task Management System/server", stdio: "ignore" });
    };

    // ── ISS-021: a role downgrade bites on the NEXT request ──────────────────
    console.log("\n  --- ISS-021: role downgrade latency (D4 = live check) ---");
    await mkUser("u-F10-admin", "f10.admin@test.local", "admin");
    const { token: ADM } = await loginFull("f10.admin@test.local");
    const t1 = (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name: "TEST-F10-t1" })).b;
    const t2 = (await api(OT, "POST", "/tasks", { primary_list_id: list.id, name: "TEST-F10-t2" })).b;
    const hd1 = await api(ADM, "DELETE", "/tasks/" + t1.id + "?hard=true");
    check("as a live admin: hard delete -> 204", hd1.s === 204, "got " + hd1.s);
    const demote = await api(OT, "PATCH", "/users/u-F10-admin/role", { role: "member" });
    check("owner demotes them to member (200)", demote.s === 200, "got " + demote.s);
    const hd2 = await api(ADM, "DELETE", "/tasks/" + t2.id + "?hard=true");
    check("SAME old token, next request: hard delete -> 403 (was 204 for ≤15 min)",
        hd2.s === 403, "got " + hd2.s);
    const soft2 = await api(ADM, "DELETE", "/tasks/" + t2.id);
    check("…but their member powers still work (soft delete 204)", soft2.s === 204, "got " + soft2.s);

    // ── ISS-015: change-password revokes every session ───────────────────────
    console.log("\n  --- ISS-015: change-password vs other sessions ---");
    await mkUser("u-F10-cp", "f10.cp@test.local", "member");
    const d1 = await loginFull("f10.cp@test.local");
    const d2 = await loginFull("f10.cp@test.local");
    const d3 = await loginFull("f10.cp@test.local");
    const [[before]] = await db.query(
        "SELECT COUNT(*) n FROM sessions WHERE user_id='u-F10-cp' AND revoked_at IS NULL");
    check("three devices signed in (live sessions = 3)", before.n === 3, String(before.n));
    const cp = await api(d1.token, "POST", "/auth/change-password",
        { current_password: "Owner@12345", new_password: "Owner@12345-new" });
    check("POST /auth/change-password -> 204", cp.s === 204, "got " + cp.s);
    const [[after]] = await db.query(
        "SELECT COUNT(*) n FROM sessions WHERE user_id='u-F10-cp' AND revoked_at IS NULL");
    check("live sessions after the change -> 0 (was: unchanged)", after.n === 0, String(after.n));
    const ref = await fetch(B + "/auth/refresh", { method: "POST", headers: { cookie: d2.cookie } });
    check("another device's refresh -> 401 (was 200, still signed in)", ref.status === 401, "got " + ref.status);
    const relog = await loginFull("f10.cp@test.local", "Owner@12345-new");
    check("signing in with the NEW password works", relog.status === 200, "got " + relog.status);

    // ── ISS-018: the logout bound, re-measured (documented design) ───────────
    console.log("\n  --- ISS-018: logout bound (stays documented, D4 note) ---");
    const d4 = await loginFull("f10.cp@test.local", "Owner@12345-new");
    const lo = await fetch(B + "/auth/logout", { method: "POST",
        headers: { Authorization: "Bearer " + d4.token, cookie: d4.cookie } });
    check("logout -> 204", lo.status === 204, "got " + lo.status);
    const refAfter = await fetch(B + "/auth/refresh", { method: "POST", headers: { cookie: d4.cookie } });
    check("refresh after logout -> 401 (the window CANNOT be renewed)", refAfter.status === 401, "got " + refAfter.status);
    const meAfter = await api(d4.token, "GET", "/auth/me");
    check("old access token accepted ≤15 min (the documented bound — unchanged)",
        meAfter.s === 200, "got " + meAfter.s);

    // ── ISS-017: revoked-row pruning ─────────────────────────────────────────
    console.log("\n  --- ISS-017: session-cleanup prunes revoked rows after 7 days ---");
    const seedSession = async (id, expDays, revDays) => db.query(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at) VALUES (?,?,?, UTC_TIMESTAMP() + INTERVAL ? DAY, " +
        (revDays === null ? "NULL" : "UTC_TIMESTAMP() - INTERVAL " + revDays + " DAY") + ")",
        [id, "u-F10-cp", "hash-" + id, expDays]);
    await seedSession("s-F10-expired31", -31, null);      // rule 1: expired > 30d
    await seedSession("s-F10-revoked20", 20, 20);         // rule 2: revoked > 7d
    await seedSession("s-F10-revoked2", 20, 2);           // kept: inside the window
    await seedSession("s-F10-active", 20, null);          // kept: live
    const dry = execSync("npx tsx ../fixing/evidence/F10/run-cleanup.ts --dry",
        { cwd: "E:/Task Management System/server", encoding: "utf8" });
    const dryOut = JSON.parse(dry.split("OUTCOME ")[1]);
    const run = execSync("npx tsx ../fixing/evidence/F10/run-cleanup.ts",
        { cwd: "E:/Task Management System/server", encoding: "utf8" });
    const out = JSON.parse(run.split("OUTCOME ")[1]);
    const [left] = await db.query("SELECT id FROM sessions WHERE id LIKE 's-F10-%'");
    const leftIds = left.map((r) => r.id).sort();
    check("dry run counts both rules once (wouldDelete ≥ 2)", dryOut.wouldDelete >= 2,
        JSON.stringify(dryOut));
    check("live run: expired-30d rule still fires", out.deleted_expired >= 1, JSON.stringify(out));
    check("live run: revoked-7d rule fires (the new prune)", out.deleted_revoked >= 1, "");
    check("kept: the fresh-revoked and the active rows",
        leftIds.includes("s-F10-revoked2") && leftIds.includes("s-F10-active") &&
        !leftIds.includes("s-F10-expired31") && !leftIds.includes("s-F10-revoked20"),
        JSON.stringify(leftIds));

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    for (const t of [t2?.id]) if (t) await api(OT, "DELETE", "/tasks/" + t + "?hard=true").catch(() => {});
    await db.query("DELETE FROM tasks WHERE name LIKE 'TEST-F10%'");
    for (const uid of ["u-F10-admin", "u-F10-cp"]) {
        for (const t of ["user_roles", "sessions", "notifications"])
            await db.query("DELETE FROM " + t + " WHERE user_id=?", [uid]).catch(() => {});
        await db.query("DELETE FROM workspace_activity WHERE actor_id=?", [uid]).catch(() => {});
        await db.query("DELETE FROM users WHERE id=?", [uid]);
    }
    await db.query("DELETE FROM workspace_activity WHERE entity_id IN ('u-F10-admin','u-F10-cp')").catch(() => {});
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  users " + await q("users") + " (15) | tasks " + await q("tasks") + " (46) | notif " +
        await q("notifications") + " (57)");
    console.log(bad === 0
        ? "\n  PASS — exp required · demotions bite instantly · password change evicts · revoked rows pruned.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
