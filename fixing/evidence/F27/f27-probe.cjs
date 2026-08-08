// F27 — names and duplicates: ISS-033, ISS-035, ISS-027, ISS-026 (D11:
// enforced on CREATE and RENAME).
//
// The plan's own acceptance line: "create and rename each resource to a
// colliding name → 409". Plus the three resources that ALREADY worked, to
// prove the pattern was copied rather than reinvented.
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
    const one = async (q, p) => (await db.query(q, p))[0][0];
    const OT = await login("owner@company.local");

    console.log("\n  === F27 — names and duplicates (D11: create AND rename) ===\n");

    console.log("  --- the three indexes exist, on the same collation ---");
    for (const [table, idx] of [
        ["spaces", "uq_spaces_workspace_name"],
        ["lists", "uq_lists_space_name"],
        ["roles", "uq_roles_workspace_name"],
    ]) {
        const r = await one(
            "SELECT COUNT(*) n FROM information_schema.statistics WHERE table_schema='taskmanagement' AND table_name=? AND index_name=?",
            [table, idx]);
        const col = await one(
            "SELECT collation_name c FROM information_schema.columns WHERE table_schema='taskmanagement' AND table_name=? AND column_name='name'",
            [table]);
        const collation = col.c ?? col.COLLATION_NAME;
        check(pad(table, 8) + idx, r.n > 0 && /_ci$/.test(collation),
            collation + (/_ci$/.test(collation) ? " (case-insensitive)" : " *** case-SENSITIVE ***"));
    }

    console.log("\n  --- ISS-033: spaces ---");
    const s1 = await api(OT, "POST", "/spaces", { name: "F27 Dupe Space" });
    check("first create succeeds (201)", s1.s === 201, "got " + s1.s);
    const s2 = await api(OT, "POST", "/spaces", { name: "F27 Dupe Space" });
    check("a second with the SAME name -> 409 (was: 201, two in the sidebar)",
        s2.s === 409 && s2.b?.error?.code === "space.duplicate",
        "got " + s2.s + " " + (s2.b?.error?.code ?? ""));
    const s3 = await api(OT, "POST", "/spaces", { name: "f27 DUPE space" });
    check("…case-insensitively (the collation does the work)",
        s3.s === 409, "got " + s3.s);
    const sOther = await api(OT, "POST", "/spaces", { name: "F27 Other Space" });
    const ren = await api(OT, "PATCH", "/spaces/" + sOther.b?.id,
        { name: "F27 Dupe Space" });
    check("RENAMING onto a collision -> 409 too (D11)",
        ren.s === 409 && ren.b?.error?.code === "space.duplicate", "got " + ren.s);
    const renOk = await api(OT, "PATCH", "/spaces/" + sOther.b?.id,
        { name: "F27 Other Space v2" });
    check("…a non-colliding rename still works (200)", renOk.s === 200, "got " + renOk.s);

    console.log("\n  --- ISS-035: lists ---");
    const l1 = await api(OT, "POST", "/lists",
        { space_id: s1.b?.id, name: "F27 Dupe List" });
    check("first create succeeds (201)", l1.s === 201, "got " + l1.s);
    const l2 = await api(OT, "POST", "/lists",
        { space_id: s1.b?.id, name: "F27 Dupe List" });
    check("same name in the SAME space -> 409 (was: 201, identical children)",
        l2.s === 409 && l2.b?.error?.code === "list.duplicate",
        "got " + l2.s + " " + (l2.b?.error?.code ?? ""));
    const lElsewhere = await api(OT, "POST", "/lists",
        { space_id: sOther.b?.id, name: "F27 Dupe List" });
    check("…but the same name in ANOTHER space is fine (201) — scope is the space",
        lElsewhere.s === 201, "got " + lElsewhere.s);
    const lOther = await api(OT, "POST", "/lists",
        { space_id: s1.b?.id, name: "F27 Second List" });
    const lRen = await api(OT, "PATCH", "/lists/" + lOther.b?.id,
        { name: "F27 Dupe List" });
    check("RENAMING onto a collision -> 409 (D11)",
        lRen.s === 409 && lRen.b?.error?.code === "list.duplicate", "got " + lRen.s);

    console.log("\n  --- ISS-027 + ISS-026: roles ---");
    const r1 = await api(OT, "POST", "/roles", { name: "F27 Dupe Role" });
    check("first create succeeds (201)", r1.s === 201, "got " + r1.s);
    const r2 = await api(OT, "POST", "/roles", { name: "F27 Dupe Role" });
    check("a second with the same NAME -> 409 (was: 201 with a suffixed key)",
        r2.s === 409 && r2.b?.error?.code === "role.name_taken",
        "got " + r2.s + " " + (r2.b?.error?.code ?? ""));
    const rOther = await api(OT, "POST", "/roles", { name: "F27 Other Role" });
    const rRen = await api(OT, "PATCH", "/roles/" + rOther.b?.id,
        { name: "F27 Dupe Role" });
    check("RENAMING onto a collision -> 409 (D11)",
        rRen.s === 409 && rRen.b?.error?.code === "role.name_taken", "got " + rRen.s);
    const [[sysRole]] = await db.query(
        "SELECT id, name FROM roles WHERE is_system=1 AND role_key='admin' LIMIT 1");
    const sysRen = await api(OT, "PATCH", "/roles/" + sysRole.id, { name: "Hacked" });
    // ISS-026 records the delete guard as "409 role.system_immutable"; the
    // server has ALWAYS answered 403 there (AppError.forbidden — verified
    // live). The rename guard is deliberately the SAME shape as the delete
    // guard, so 403 is the consistent answer and the issue text is what is off
    // by one status code.
    check("a SYSTEM role cannot be renamed -> 403, same as DELETE (was: 200)",
        sysRen.s === 403 && sysRen.b?.error?.code === "role.system_immutable",
        "got " + sysRen.s + " " + (sysRen.b?.error?.code ?? ""));
    const sysDel = await api(OT, "DELETE", "/roles/" + sysRole.id);
    check("…and DELETE answers identically (the guard pair is consistent)",
        sysDel.s === 403 && sysDel.b?.error?.code === "role.system_immutable",
        "got " + sysDel.s);
    const stillNamed = await one("SELECT name FROM roles WHERE id=?", [sysRole.id]);
    check("…and its name is untouched", stillNamed.name === sysRole.name,
        stillNamed.name);
    const sysDesc = await api(OT, "PATCH", "/roles/" + sysRole.id,
        { description: "F27 touched the description" });
    check("…while its DESCRIPTION stays editable (cosmetic, not an identifier)",
        sysDesc.s === 200, "got " + sysDesc.s);
    const sameName = await api(OT, "PATCH", "/roles/" + sysRole.id,
        { name: sysRole.name });
    check("…and a no-op rename to its OWN name is not an error",
        sameName.s === 200, "got " + sameName.s);

    console.log("\n  --- the three that ALREADY worked, unchanged ---");
    const t1 = await api(OT, "POST", "/tags", { name: "F27 Dupe Tag" });
    const t2 = await api(OT, "POST", "/tags", { name: "F27 Dupe Tag" });
    check("tags still 409 on a duplicate (the model implementation)",
        t1.s === 201 && t2.s === 409, "got " + t2.s);
    const y1 = await api(OT, "POST", "/task-types", { name: "F27 Dupe Type" });
    const y2 = await api(OT, "POST", "/task-types", { name: "F27 Dupe Type" });
    check("task types still 409", y1.s === 201 && y2.s === 409, "got " + y2.s);

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    await db.query("DELETE FROM tags WHERE name LIKE 'F27 %'").catch(() => {});
    await db.query("DELETE FROM task_types WHERE name LIKE 'F27 %'").catch(() => {});
    await db.query("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'F27 %')").catch(() => {});
    await db.query("DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'F27 %')").catch(() => {});
    await db.query("DELETE FROM roles WHERE name LIKE 'F27 %'").catch(() => {});
    await db.query("UPDATE roles SET description=(SELECT d FROM (SELECT description d FROM roles WHERE id=?) x) WHERE id=?", [sysRole.id, sysRole.id]).catch(() => {});
    const [ls] = await db.query("SELECT id FROM lists WHERE name LIKE 'F27 %'");
    for (const l of ls) {
        await db.query("DELETE FROM statuses WHERE scope_type='list' AND scope_id=?", [l.id]).catch(() => {});
        await db.query("DELETE FROM lists WHERE id=?", [l.id]).catch(() => {});
    }
    const [sp] = await db.query("SELECT id FROM spaces WHERE name LIKE 'F27 %' OR name LIKE 'f27 %'");
    for (const x of sp) {
        await db.query("DELETE FROM statuses WHERE scope_type='space' AND scope_id=?", [x.id]).catch(() => {});
        await db.query("DELETE FROM spaces WHERE id=?", [x.id]).catch(() => {});
    }
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  spaces " + await q("spaces") + " (6) | lists " + await q("lists") +
        " (13) | roles " + await q("roles") + " | tags " + await q("tags") +
        " (8) | task_types " + await q("task_types") + " | statuses " + await q("statuses") + " (65)");
    console.log(bad === 0
        ? "\n  PASS — the five navigation resources now enforce what the three catalog ones always did.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
