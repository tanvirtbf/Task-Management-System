// F17 — ISS-025: the dev schema drift, reproduced then closed by the
// documented upgrade path.
//
// Run with STAGE=before (drift present) or STAGE=after (008 applied). The
// before stage asserts the three failures the issue records; the after stage
// asserts all three work. Same code, same API, only the schema changes.
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5711") + "/api/v1";
const STAGE = process.env.STAGE || "after";
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
    console.log("  " + pad(ok ? "OK  " : "FAIL", 6) + pad(label, 58) + (detail || "")); };

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00" });
    await db.query("SET time_zone='+00:00'");
    const one = async (q, p) => (await db.query(q, p))[0][0];
    const OT = await login("owner@company.local");
    const TOKEN = fs.readFileSync("E:/Task Management System/server/.env", "utf8")
        .split(/\r?\n/).find((l) => l.startsWith("INTERNAL_JOB_TOKEN="))?.slice(19).trim();

    console.log("\n  === F17 (" + STAGE.toUpperCase() + ") — ISS-025, the three failure surfaces ===\n");

    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const form = (await api(OT, "POST", "/forms", { list_id: list.id, title: "F17 drift form" })).b;
    await api(OT, "POST", "/forms/" + form.id + "/fields",
        { field_kind: "task_attr", field_key: "name", label: "What?" });

    // 1. the admin submissions list
    const subs = await api(OT, "GET", "/forms/" + form.id + "/submissions");
    // 2. public intake
    const pub = await fetch(B + "/public/forms/" + form.public_slug + "/submit", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { name: "F17 drift submission" } }) });
    const pubBody = await j(pub);
    // 3. the retention job
    const job = await j(await fetch(B + "/jobs/form-submission-expiry?dry_run=true", { method: "POST",
        headers: { "X-Internal-Token": TOKEN } }));

    if (STAGE === "before") {
        check("GET /forms/:id/submissions is a 500 (Unknown column)", subs.s === 500, "got " + subs.s);
        check("PUBLIC INTAKE is dead too (500)", pub.status === 500, "got " + pub.status);
        check("the retention job fails with the column error",
            job.ok === false && /Unknown column/.test(job.error ?? ""),
            (job.error ?? "").slice(0, 48));
        console.log("\n  (the whole Forms feature is unusable on a drifted box)");
    } else {
        check("GET /forms/:id/submissions -> 200 (was 500)", subs.s === 200, "got " + subs.s);
        check("public intake works (201) and the row is ENCRYPTED + stamped",
            pub.status === 201, "got " + pub.status);
        if (pub.status === 201) {
            const row = await one(
                "SELECT encrypted_at IS NOT NULL enc, expires_at IS NOT NULL exp, DATEDIFF(expires_at, submitted_at) days FROM form_submissions WHERE form_id=? ORDER BY submitted_at DESC LIMIT 1",
                [form.id]);
            check("…encrypted_at set, expires_at = submitted + 90d",
                row.enc === 1 && row.exp === 1 && row.days === 90,
                "enc " + row.enc + ", exp " + row.exp + ", days " + row.days);
        }
        check("the retention job answers ok (was Unknown column)",
            job.ok === true, JSON.stringify(job).slice(0, 60));
        const listAgain = await api(OT, "GET", "/forms/" + form.id + "/submissions");
        const n = (listAgain.b?.data ?? listAgain.b ?? []).length;
        check("…and the submissions list actually shows the row", n === 1, n + " rows");
    }

    // cleanup (works in both stages; the tasks the submissions created too)
    const [made] = await db.query(
        "SELECT task_id FROM form_submissions WHERE form_id=?", [form.id]).catch(() => [[]]);
    await db.query("DELETE FROM form_submissions WHERE form_id=?", [form.id]).catch(() => {});
    await db.query("DELETE FROM form_fields WHERE form_id=?", [form.id]).catch(() => {});
    await db.query("DELETE FROM forms WHERE id=?", [form.id]).catch(() => {});
    for (const r of made ?? []) {
        if (!r.task_id) continue;
        for (const t of ["comments", "task_activity", "task_assignees", "notifications"])
            await db.query("DELETE FROM " + t + " WHERE task_id=?", [r.task_id]).catch(() => {});
        await db.query("DELETE FROM tasks WHERE id=?", [r.task_id]).catch(() => {});
    }
    await db.query("DELETE FROM tasks WHERE name='F17 drift submission'").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("\n  cleanup: tasks " + await q("tasks") + " (46) | forms " + await q("forms") + " (0)");
    console.log(bad === 0 ? "\n  " + STAGE.toUpperCase() + " PASS\n" : "\n  *** " + bad + " FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
