// F12 — password policy + account safety: the three repros, on the fixed tree.
//
//   ISS-083  "password" / "12345678" / "PASSWORD" / "aaaaaaaa" / "alllowercase"
//            were all accepted (204). Now refused, each with a reason.
//   ISS-030  a member moved their own login email anywhere, silently.
//   ISS-031  a bogus IANA zone was rejected on the workspace, accepted on a
//            user profile.
//
// P38's warning is respected: the original probe changed the OWNER's real
// password. This one uses a throwaway account for every password write and
// never touches a seeded credential.
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 56) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const OT = await login("owner@company.local");
    const [[owner]] = await db.query("SELECT * FROM users WHERE email='owner@company.local'");
    const { execSync } = require("node:child_process");
    const mkUser = async (id, email, role) => {
        await db.query(
            "INSERT INTO users (id, workspace_id, first_name, last_name, email, password_hash, role, status) VALUES (?,?,?,?,?,?,?,'active')",
            [id, owner.workspace_id, "F12", "Probe", email, owner.password_hash, role]);
        execSync('npx tsx -e "import { initDb } from \'./src/db/client\'; import { syncUserSystemRole } from \'./src/rbac/bootstrap\'; (async()=>{const db=await initDb(); await syncUserSystemRole(db, \'' +
            owner.workspace_id + "', '" + id + "', '" + role + '\'); process.exit(0);})();"',
            { cwd: "E:/Task Management System/server", stdio: "ignore" });
    };
    await mkUser("u-F12-a", "f12.a@test.local", "member");
    await mkUser("u-F12-b", "f12.b@test.local", "member");
    let PW = "Owner@12345";
    let T = await login("f12.a@test.local", PW);
    check("throwaway accounts created and logged in", !!T, "");

    console.log("\n  === F12 — password policy + account safety ===\n");
    console.log("  --- ISS-083: the five passwords P38 proved were ACCEPTED ---");
    console.log("  " + pad("candidate", 18) + pad("status", 8) + "reason returned");
    for (const cand of ["password", "12345678", "PASSWORD", "aaaaaaaa", "alllowercase"]) {
        const r = await api(T, "POST", "/auth/change-password",
            { current_password: PW, new_password: cand });
        const detail = r.b?.error?.details?.[0]?.issue ?? r.b?.error?.message ?? "";
        if (r.s !== 422) bad++;
        console.log("  " + pad(cand, 18) + pad(r.s + (r.s === 422 ? "" : " ***"), 8) +
            String(detail).slice(0, 62));
    }
    console.log("  (all five were 204-accepted before F12)");

    console.log("\n  --- more of the same class ---");
    for (const [cand, why] of [["Password1!", "denylist survives decoration"],
                               ["abcdefgh", "straight alphabet run"],
                               ["1234567", "too short AND sequential"],
                               ["qwerty123", "keyboard walk"],
                               ["11111111", "repeated character"]]) {
        const r = await api(T, "POST", "/auth/change-password",
            { current_password: PW, new_password: cand });
        check(pad(cand, 14) + "refused (" + why + ")", r.s === 422, "got " + r.s);
    }

    console.log("\n  --- and the ones that must still be ACCEPTED ---");
    for (const good of ["Str0ng#Pass", "correct horse battery staple"]) {
        const r = await api(T, "POST", "/auth/change-password",
            { current_password: PW, new_password: good });
        check("accepted: " + JSON.stringify(good).slice(0, 34), r.s === 204, "got " + r.s);
        if (r.s === 204) { PW = good; T = await login("f12.a@test.local", PW); }
    }
    check("…and the new password actually signs in", !!T, "");
    check("a 28-char passphrase passes on LENGTH (no symbol rule)",
        PW === "correct horse battery staple", "current: " + JSON.stringify(PW).slice(0, 34));

    console.log("\n  --- the same policy on the other two surfaces ---");
    const fp = await api(OT, "POST", "/auth/forgot-password", { email: "f12.a@test.local" });
    const [[tok]] = await db.query(
        "SELECT token_hash FROM password_reset_tokens WHERE user_id='u-F12-a' ORDER BY created_at DESC LIMIT 1");
    check("forgot-password issued a token", fp.s === 202 || fp.s === 204 || fp.s === 200,
        "status " + fp.s + (tok ? ", token row present" : ", NO token row"));
    const rp = await fetch(B + "/auth/reset-password", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "not-the-real-token", new_password: "password" }) });
    const rpb = await j(rp);
    check("reset-password refuses a weak password (policy, not token)",
        rp.status === 422 && JSON.stringify(rpb).includes("commonly-used"),
        "got " + rp.status + " " + (rpb?.error?.details?.[0]?.issue ?? "").slice(0, 40));
    const inv = await api(OT, "POST", "/users/invite",
        { email: "f12.invitee@test.local", first_name: "F12", last_name: "Invitee", role: "member" });
    const [[invRow]] = await db.query(
        "SELECT id FROM invitations WHERE email='f12.invitee@test.local' ORDER BY created_at DESC LIMIT 1");
    const acc = await fetch(B + "/auth/accept-invitation", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "not-the-real-token", password: "12345678" }) });
    const accb = await j(acc);
    check("accept-invitation refuses a weak password too",
        acc.status === 422 && !JSON.stringify(accb).includes("token"),
        "got " + acc.status + " " + (accb?.error?.details?.[0]?.issue ?? "").slice(0, 40));

    console.log("\n  --- ISS-030: changing the login email ---");
    const selfEmail = await api(T, "PATCH", "/users/u-F12-a", { email: "attacker@evil.test" });
    check("member moves their OWN email -> 403 (was 200, written)",
        selfEmail.s === 403 && selfEmail.b?.error?.code === "user.email_change_forbidden",
        "got " + selfEmail.s + " " + (selfEmail.b?.error?.code ?? ""));
    const [[still]] = await db.query("SELECT email FROM users WHERE id='u-F12-a'");
    check("…and the address did NOT change", still.email === "f12.a@test.local", still.email);
    const selfName = await api(T, "PATCH", "/users/u-F12-a", { first_name: "F12x" });
    check("the rest of their own profile is still self-editable", selfName.s === 200, "got " + selfName.s);
    const echo = await api(T, "PATCH", "/users/u-F12-a", { email: "f12.a@test.local" });
    check("a same-value email echo is still allowed (no false break)", echo.s === 200, "got " + echo.s);
    const byAdmin = await api(OT, "PATCH", "/users/u-F12-a", { email: "f12.a2@test.local" });
    check("an ADMIN can still change it (200)", byAdmin.s === 200, "got " + byAdmin.s);
    await db.query("UPDATE users SET email='f12.a@test.local' WHERE id='u-F12-a'");

    console.log("\n  --- ISS-031: a bogus IANA timezone ---");
    const badTz = await api(T, "PATCH", "/users/u-F12-a", { timezone: "Not/AZone" });
    check("user profile: bogus zone -> 422 (was 200, written)", badTz.s === 422,
        "got " + badTz.s + " " + (badTz.b?.error?.details?.[0]?.issue ?? "").slice(0, 40));
    const wsTz = await api(OT, "PATCH", "/workspace", { timezone: "Not/AZone" });
    check("workspace: still 422 (unchanged — the rule it always had)", wsTz.s === 422, "got " + wsTz.s);
    const goodTz = await api(T, "PATCH", "/users/u-F12-a", { timezone: "Asia/Dhaka" });
    check("a real zone is still accepted (200)", goodTz.s === 200, "got " + goodTz.s);

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    for (const uid of ["u-F12-a", "u-F12-b"]) {
        for (const t of ["user_roles", "sessions", "notifications", "password_reset_tokens"])
            await db.query("DELETE FROM " + t + " WHERE user_id=?", [uid]).catch(() => {});
        await db.query("DELETE FROM workspace_activity WHERE actor_id=? OR entity_id=?", [uid, uid]).catch(() => {});
        await db.query("DELETE FROM users WHERE id=?", [uid]);
    }
    await db.query("DELETE FROM invitations WHERE email LIKE 'f12.%'").catch(() => {});
    await db.query("DELETE FROM users WHERE email LIKE 'f12.%'").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR AND entity_type='user'").catch(() => {});
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const [[tz]] = await db.query("SELECT timezone FROM workspaces LIMIT 1");
    const q = async (t) => (await db.query("SELECT COUNT(*) n FROM " + t))[0][0].n;
    console.log("  users " + await q("users") + " (15) | invitations " + await q("invitations") +
        " | workspace tz " + tz.timezone + " | notif " + await q("notifications") + " (57)");
    console.log(bad === 0
        ? "\n  PASS — weak passwords refused everywhere, login email is admin-only, zones validated. \n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
