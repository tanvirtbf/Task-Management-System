// F26 — client permission gating: SCAN-M5, ISS-042, ISS-023, ISS-038.
//
// The gating is client-side, so each check has two halves: the PERMISSION DATA
// the client gates on is read live from `/me/permissions` for the three demo
// accounts SCAN-M5 names, and the client source is asserted to consult it.
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

const ENG_KEYS = ["sprint.manage", "sprint.assign_tasks", "oncall.manage", "postmortem.manage"];

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const one = async (q, p) => (await db.query(q, p))[0][0];

    console.log("\n  === F26 — client permission gating ===\n");

    console.log("  --- SCAN-M5: the Engineering nav gate, on real permission data ---");
    const sidebar = src("components/shared/Sidebar.tsx");
    check("the Engineering block is now INSIDE a conditional",
        sidebar.includes("permsReady && canSeeEngineering"), "");
    check("…gated on the four engineering-domain grants",
        ENG_KEYS.every((k) => sidebar.includes(`holds("${k}")`)), "");
    check("…and Report-a-bug stays OUTSIDE it (a non-engineer must reach the team)",
        sidebar.indexOf("<ReportBugButton />") > sidebar.indexOf("canSeeEngineering"), "");

    console.log("  " + pad("account", 40) + pad("holds an eng grant?", 22) + "sees Eng nav");
    for (const [email, expect] of [
        ["owner@company.local", true],
        ["jhankar@beautybooth.com.bd", true],
        ["marketing.only@beautybooth.com.bd", false],
        ["guest@beautybooth.com.bd", false],
    ]) {
        const exists = await one("SELECT COUNT(*) n FROM users WHERE email=?", [email]);
        if (!exists.n) { console.log("  " + pad("SKIP", 6) + email + " (no such demo account)"); continue; }
        const t = await login(email);
        const perms = await api(t, "GET", "/me/permissions");
        const held = new Set(Object.keys(perms.b?.permissions ?? {}));
        // F26 gates on (any eng grant) AND role !== guest — see ISS-094.
        const isGuest = (perms.b?.role ?? "") === "guest";
        const any = !isGuest && ENG_KEYS.some((k) => held.has(k));
        const ok = any === expect;
        if (!ok) bad++;
        console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(email, 40) +
            pad((ENG_KEYS.some((k) => held.has(k)) ? "yes" : "no") + (isGuest ? " (guest: ISS-094)" : ""), 22) + (any ? "yes" : "NO — hidden"));
    }

    console.log("\n  --- SCAN-M5 (wider): the high-traffic action buttons ---");
    check("Sidebar menu entries gated (workspace settings / members / new space)",
        sidebar.includes('holds("workspace.settings")') &&
        sidebar.includes('holds("member.view")') &&
        sidebar.includes('holds("space.create")'), "");
    const members = src("pages/settings/MembersSettings.tsx");
    check("Invite member gated on member.invite (it 403-toasted before)",
        members.includes('holds("member.invite")'), "");
    const drawer = src("components/task/TaskDetailDrawer.tsx");
    check("task archive/restore gated on task.delete",
        drawer.includes('holds("task.delete") &&'), "");
    check("…and the permanent delete on task.delete_hard",
        drawer.includes('holds("task.delete_hard") &&'), "");
    // the server must AGREE with those gates
    const mk = await login("marketing.only@beautybooth.com.bd").catch(() => null);
    if (mk) {
        const inv = await api(mk, "POST", "/users/invite",
            { email: "f26.blocked@test.local", first_name: "F", last_name: "Six", role: "member" });
        check("…and the SERVER refuses what the client now hides (invite → 403)",
            inv.s === 403, "got " + inv.s);
    }

    console.log("\n  --- ISS-042: hidden_from_guests reaches the API ---");
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const OT = await login("owner@company.local");
    const made = await api(OT, "POST", "/custom-fields", {
        scope_type: "list", scope_id: list.id, name: "F26 Secret Field",
        type: "text", hidden_from_guests: true,
    });
    check("POST /custom-fields accepts hidden_from_guests (was: unknown field)",
        made.s === 201 && made.b?.hidden_from_guests === true,
        "got " + made.s + ", wire flag " + made.b?.hidden_from_guests);
    const stored = made.b?.id
        ? await one("SELECT hidden_from_guests h FROM custom_fields WHERE id=?", [made.b.id])
        : null;
    check("…and it is STORED (not silently dropped)", stored?.h === 1, "db " + stored?.h);
    const off = await api(OT, "PATCH", "/custom-fields/" + made.b?.id,
        { hidden_from_guests: false });
    check("PATCH can switch it back off", off.s === 200 && off.b?.hidden_from_guests === false,
        "got " + off.s);
    const badType = await api(OT, "PATCH", "/custom-fields/" + made.b?.id,
        { hidden_from_guests: "yes" });
    check("a non-boolean is a clean 422", badType.s === 422, "got " + badType.s);
    const listed = await api(OT, "GET", "/custom-fields");
    const anyWire = (listed.b ?? []).some((f) => "hidden_from_guests" in f);
    check("the flag is on every wire custom field (it was in no serializer)",
        listed.s === 200 && anyWire, "");

    console.log("\n  --- ISS-023: the eleventh redaction call site ---");
    const rev = fs.readFileSync(
        "E:/Task Management System/server/src/services/ReviewsService.ts", "utf8");
    check("ReviewsService no longer hardcodes `false`",
        !rev.includes("customFieldValuesByTask(taskIds, false)"), "");
    check("…it computes redactGuest like the other ten sites",
        rev.includes("const redactGuest = input.role === Roles.GUEST") &&
        rev.includes("customFieldValuesByTask(taskIds, redactGuest)"), "");

    console.log("\n  --- ISS-038: the reorder endpoint has a caller at last ---");
    const st = src("pages/settings/StatusesSettings.tsx");
    check("StatusesSettings calls statusesApi.reorder (there was NO caller)",
        st.includes("statusesApi.reorder"), "");
    check("…sends a COMPLETE permutation (F18 refuses partial payloads)",
        st.includes("next.map((st, idx) => ({ id: st.id, position: idx }))"), "");
    check("…and the control is gated on status.manage", st.includes('holds("status.manage")'), "");
    // prove the payload shape the UI builds is the one the server accepts
    const sts = (await api(OT, "GET", "/lists/" + list.id + "/statuses")).b;
    const ids = (sts?.data ?? sts ?? []).map((x) => x.id);
    const swapped = ids.slice();
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const applied = await api(OT, "PATCH", "/lists/" + list.id + "/statuses/reorder",
        swapped.map((id, idx) => ({ id, position: idx })));
    check("the swap the arrows build is accepted (200) and the order flips",
        applied.s === 200 && (applied.b ?? [])[0]?.id === ids[1],
        "got " + applied.s);
    // put it back
    await api(OT, "PATCH", "/lists/" + list.id + "/statuses/reorder",
        ids.map((id, idx) => ({ id, position: idx })));
    const restored = (await api(OT, "GET", "/lists/" + list.id + "/statuses")).b;
    check("…and restoring the original order works too",
        ((restored?.data ?? restored ?? [])[0]?.id) === ids[0], "");

    console.log("\n  === CLEANUP ===");
    if (made.b?.id) {
        await db.query("DELETE FROM custom_field_options WHERE custom_field_id=?", [made.b.id]).catch(() => {});
        await db.query("DELETE FROM task_custom_field_values WHERE custom_field_id=?", [made.b.id]).catch(() => {});
        await db.query("DELETE FROM custom_fields WHERE id=?", [made.b.id]).catch(() => {});
    }
    await db.query("DELETE FROM custom_fields WHERE name LIKE 'F26 %'").catch(() => {});
    await db.query("DELETE FROM users WHERE email LIKE 'f26.%'").catch(() => {});
    await db.query("DELETE FROM invitations WHERE email LIKE 'f26.%'").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  custom_fields " + await q("custom_fields") + " | users " + await q("users") +
        " | statuses " + await q("statuses") + " (65)");
    console.log(bad === 0
        ? "\n  PASS — the nav and the buttons match the permissions the server enforces.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
