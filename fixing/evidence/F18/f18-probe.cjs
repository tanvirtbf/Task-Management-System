// F18 — validation holes and contract self-contradictions: six repros.
//
//   ISS-044  POST /tasks with an unknown reviewer_id -> 500 (the only
//            unvalidated reference on the create path)
//   ISS-071  a 300-char X-Filename -> 500 (the presign path had the rule)
//   ISS-077  the API generated a public_slug its OWN validator rejects
//   ISS-032  POST /spaces silently discarded an invalid head_user_id
//   ISS-037  status reorder accepted non-permutations (all at position 0)
//   ISS-078  form-field reorder accepted partial lists + duplicate positions
//
// Every repro asserts the right 4xx now, AND that the corresponding happy path
// still works — a validator that refuses everything also "fixes" the 500.
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
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const [[arif]] = await db.query("SELECT id FROM users WHERE email LIKE 'arif@%'");
    const [[guest]] = await db.query("SELECT id FROM users WHERE role='guest' LIMIT 1");
    const made = [];

    console.log("\n  === F18 — validation holes ===\n");

    console.log("  --- ISS-044: reviewer_id on CREATE ---");
    const badRev = await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "F18 rev bad", reviewer_id: "u-does-not-exist" });
    check("unknown reviewer -> 422 task.invalid_reviewer (was 500)",
        badRev.s === 422 && badRev.b?.error?.code === "task.invalid_reviewer",
        "got " + badRev.s + " " + (badRev.b?.error?.code ?? ""));
    const goodRev = await api(OT, "POST", "/tasks",
        { primary_list_id: list.id, name: "F18 rev good", reviewer_id: arif.id });
    if (goodRev.b?.id) made.push(goodRev.b.id);
    check("a VALID reviewer still creates (201, reviewer set)",
        goodRev.s === 201 && goodRev.b?.reviewer_id === arif.id, "got " + goodRev.s);

    console.log("\n  --- ISS-071: the 300-char X-Filename ---");
    const T = goodRev.b?.id;
    const upload = async (name) => fetch(B + "/tasks/" + T + "/attachments", { method: "POST",
        headers: { Authorization: "Bearer " + OT, "Content-Type": "image/png", "X-Filename": name },
        body: Buffer.from("F18") });
    const long = await upload("a".repeat(296) + ".png");
    const longBody = await j(long);
    check("300-char filename -> 422 naming the header (was raw 500)",
        long.status === 422 && JSON.stringify(longBody).includes("X-Filename"),
        "got " + long.status);
    const okUp = await upload("b".repeat(240) + ".png");
    check("a 244-char filename still uploads (201, as before)", okUp.status === 201,
        "got " + okUp.status);

    console.log("\n  --- ISS-077: the self-contradictory public_slug ---");
    const form = (await api(OT, "POST", "/forms", { list_id: list.id, title: "F18 Slug Form" })).b;
    const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form?.public_slug ?? "");
    check("generated slug now matches the API's OWN SLUG_RE",
        slugOk, form?.public_slug ?? "none");
    const echoBack = await api(OT, "PATCH", "/forms/" + form.id,
        { public_slug: form.public_slug });
    check("the form can be written back UNCHANGED (was 422)",
        echoBack.s === 200, "got " + echoBack.s);

    console.log("\n  --- ISS-032: head_user_id on POST /spaces ---");
    const badHead = await api(OT, "POST", "/spaces",
        { name: "F18 Head Space A", head_user_id: "u-nope" });
    check("unknown head -> 422 space.head_invalid (was 201 + NULL)",
        badHead.s === 422 && badHead.b?.error?.code === "space.head_invalid",
        "got " + badHead.s + " " + (badHead.b?.error?.code ?? ""));
    const guestHead = await api(OT, "POST", "/spaces",
        { name: "F18 Head Space B", head_user_id: guest.id });
    check("a GUEST head -> 422 (same rule as PATCH)",
        guestHead.s === 422 && guestHead.b?.error?.code === "space.head_invalid",
        "got " + guestHead.s);
    const goodHead = await api(OT, "POST", "/spaces",
        { name: "F18 Head Space C", head_user_id: arif.id });
    const headRow = goodHead.b?.id
        ? await one("SELECT head_user_id FROM spaces WHERE id=?", [goodHead.b.id]) : null;
    check("a VALID head is WRITTEN (was silently dropped to NULL)",
        goodHead.s === 201 && headRow?.head_user_id === arif.id,
        "db head " + (headRow?.head_user_id ?? "null"));
    const nullHead = await api(OT, "POST", "/spaces",
        { name: "F18 Head Space D", head_user_id: null });
    check("an explicit null head still creates (201, no head)",
        nullHead.s === 201, "got " + nullHead.s);

    console.log("\n  --- ISS-037: status reorder must be a permutation ---");
    const SP2 = (await api(OT, "POST", "/spaces", { name: "F18 Reorder Space" })).b;
    const L = (await api(OT, "POST", "/lists", { space_id: SP2.id, name: "F18 reorder list" })).b;
    const sts = (await api(OT, "GET", "/lists/" + L.id + "/statuses")).b;
    const stIds = (sts?.data ?? sts ?? []).map((s) => s.id);
    const allZero = await api(OT, "PATCH", "/lists/" + L.id + "/statuses/reorder",
        stIds.map((id) => ({ id, position: 0 })));
    check("every status at position 0 -> 422 (was 200, order destroyed)",
        allZero.s === 422, "got " + allZero.s);
    const partial = await api(OT, "PATCH", "/lists/" + L.id + "/statuses/reorder",
        [{ id: stIds[0], position: 0 }]);
    check("a PARTIAL payload -> 422 naming the count",
        partial.s === 422 && JSON.stringify(partial.b).includes("exactly once"),
        "got " + partial.s);
    const reversed = stIds.map((id, i) => ({ id, position: stIds.length - 1 - i }));
    const fullOk = await api(OT, "PATCH", "/lists/" + L.id + "/statuses/reorder", reversed);
    const backRows = (fullOk.b ?? []).map((s) => s.id);
    check("a full valid permutation still works (200, order flipped)",
        fullOk.s === 200 && backRows[0] === stIds[stIds.length - 1],
        "got " + fullOk.s);

    console.log("\n  --- ISS-078: form-field reorder, same rule ---");
    const f2 = (await api(OT, "POST", "/forms", { list_id: list.id, title: "F18 Field Form" })).b;
    const fields = [];
    for (const [k, label] of [["name", "Name"], ["description", "Details"], ["priority", "Priority"]]) {
        const fr = await api(OT, "POST", "/forms/" + f2.id + "/fields",
            { field_kind: "task_attr", field_key: k, label });
        fields.push(fr.b?.id);
    }
    const partialF = await api(OT, "PATCH", "/forms/" + f2.id + "/fields/reorder",
        { items: [{ id: fields[0], position: 0 }] });
    check("ONE item of three -> 422 (was 200, two fields at 0)",
        partialF.s === 422, "got " + partialF.s);
    const dupPos = await api(OT, "PATCH", "/forms/" + f2.id + "/fields/reorder",
        { items: fields.map((id) => ({ id, position: 1 })) });
    check("duplicate positions -> 422 (question order stays unambiguous)",
        dupPos.s === 422, "got " + dupPos.s);
    const revF = await api(OT, "PATCH", "/forms/" + f2.id + "/fields/reorder",
        { items: fields.map((id, i) => ({ id, position: fields.length - 1 - i })) });
    const posNow = await one(
        "SELECT COUNT(DISTINCT position) d, COUNT(*) n FROM form_fields WHERE form_id=?", [f2.id]);
    check("full reversed reorder works (200) and positions stay DISTINCT",
        revF.s === 200 && posNow.d === posNow.n, "distinct " + posNow.d + "/" + posNow.n);

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    for (const fid of [form?.id, f2?.id]) {
        if (!fid) continue;
        await db.query("DELETE FROM form_fields WHERE form_id=?", [fid]).catch(() => {});
        await db.query("DELETE FROM forms WHERE id=?", [fid]).catch(() => {});
    }
    const [strayT] = await db.query("SELECT id FROM tasks WHERE name LIKE 'F18 %'");
    for (const r of strayT) {
        for (const t of ["comments", "task_activity", "task_assignees", "task_watchers", "notifications", "attachments"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.id]).catch(() => {});
    }
    const [straySp] = await db.query("SELECT id FROM spaces WHERE name LIKE 'F18 %'");
    for (const sp of straySp) {
        const [ls] = await db.query("SELECT id FROM lists WHERE space_id=?", [sp.id]);
        for (const l of ls) {
            await db.query("DELETE FROM statuses WHERE scope_type='list' AND scope_id=?", [l.id]).catch(() => {});
            await db.query("DELETE FROM lists WHERE id=?", [l.id]).catch(() => {});
        }
        await db.query("DELETE FROM statuses WHERE scope_type='space' AND scope_id=?", [sp.id]).catch(() => {});
        await db.query("DELETE FROM spaces WHERE id=?", [sp.id]).catch(() => {});
    }
    await db.query("DELETE FROM r2_purge_queue").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  tasks " + await q("tasks") + " (46) | spaces " + await q("spaces") +
        " (6) | lists " + await q("lists") + " (13) | forms " + await q("forms") +
        " (0) | statuses " + await q("statuses") + " (65)");
    console.log(bad === 0
        ? "\n  PASS — six holes closed; every happy path intact.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
