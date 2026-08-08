// F15 — the counters: the three repros, one path at a time.
//
//   ISS-065  comments_count only ever went UP — the decrementing trigger fires
//            on SQL DELETE and the API soft-deletes.
//   ISS-080  forms.submission_count never came down when the retention job
//            deleted rows.
//   ISS-046  subtasks_count / subtasks_completed were maintained by NOTHING;
//            every task reported 0/0.
//
// Each counter is checked against the TRUTH (a COUNT over the rows) after every
// write, not just against an expected number — a counter that is right by
// coincidence and a counter that is right by construction look the same
// otherwise.
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
    const one = async (q, p) => (await db.query(q, p))[0][0];
    const OT = await login("owner@company.local");
    const made = [];

    console.log("\n  === F15 — the counters ===\n");

    // ── ISS-065: comments_count ──────────────────────────────────────────────
    console.log("  --- ISS-065: comments_count vs SOFT delete ---");
    const [[list]] = await db.query(
        "SELECT l.id FROM lists l JOIN spaces s ON s.id=l.space_id WHERE s.name='Customer Service' AND l.archived_at IS NULL LIMIT 1");
    const parent = await api(OT, "POST", "/tasks", { primary_list_id: list.id, name: "F15 counter parent" });
    const T = parent.b?.id; made.push(T);
    check("fixture task created", parent.s === 201, "got " + parent.s);

    const counterOf = async (id) => await one(
        "SELECT comments_count cc, subtasks_count sc, subtasks_completed sd FROM tasks WHERE id=?", [id]);
    const liveComments = async (id) => (await one(
        "SELECT COUNT(*) n FROM comments WHERE task_id=? AND deleted_at IS NULL", [id])).n;

    const cIds = [];
    for (const body of ["first", "second", "third"]) {
        const c = await api(OT, "POST", "/tasks/" + T + "/comments", { body: "F15 " + body });
        cIds.push(c.b?.id);
    }
    let c = await counterOf(T);
    check("3 comments -> counter 3, matches the live rows",
        c.cc === 3 && await liveComments(T) === 3, "counter " + c.cc);

    const del = await api(OT, "DELETE", "/comments/" + cIds[0]);
    c = await counterOf(T);
    const live = await liveComments(T);
    check("delete one (204) -> counter 2 (was STUCK at 3)",
        del.s === 204 && c.cc === 2 && live === 2, "counter " + c.cc + ", live rows " + live);
    const listed = await api(OT, "GET", "/tasks/" + T + "/comments");
    // The list returns a TOMBSTONE for a deleted comment by design (the client
    // renders it as 'deleted'), so compare against the ones that carry content.
    const listedRows = listed.b?.data ?? listed.b ?? [];
    const shown = listedRows.filter((x) => !x.deleted_at).length;
    check("…and the badge now equals what a reader actually sees", c.cc === shown,
        "counter " + c.cc + ", list returns " + shown);

    const edit = await api(OT, "PATCH", "/comments/" + cIds[1], { body: "F15 second, edited" });
    c = await counterOf(T);
    check("an EDIT must not move the counter", edit.s === 200 && c.cc === 2, "counter " + c.cc);

    // undelete, if the API exposes it — otherwise prove the trigger directly
    await db.query("UPDATE comments SET deleted_at=NULL WHERE id=?", [cIds[0]]);
    c = await counterOf(T);
    check("restoring a soft-deleted comment brings it BACK to 3", c.cc === 3, "counter " + c.cc);
    await db.query("UPDATE comments SET deleted_at=UTC_TIMESTAMP() WHERE id=?", [cIds[0]]);

    // ── ISS-046: subtasks_count / subtasks_completed ─────────────────────────
    console.log("\n  --- ISS-046: subtasks_count / subtasks_completed ---");
    const doneStatus = (await one(
        "SELECT id FROM statuses WHERE scope_id=? AND status_group='done' LIMIT 1", [list.id])).id;
    const openStatus = (await one(
        "SELECT id FROM statuses WHERE scope_id=? AND status_group NOT IN ('done','closed') LIMIT 1", [list.id])).id;

    const kids = [];
    for (const n of ["child A", "child B"]) {
        const k = await api(OT, "POST", "/tasks",
            { primary_list_id: list.id, name: "F15 " + n, parent_task_id: T });
        kids.push(k.b?.id); made.push(k.b?.id);
    }
    c = await counterOf(T);
    check("2 children -> 2/0 (was 0/0 — maintained by nothing)",
        c.sc === 2 && c.sd === 0, c.sc + "/" + c.sd);

    await api(OT, "PATCH", "/tasks/" + kids[0], { status_id: doneStatus });
    c = await counterOf(T);
    check("mark one done -> 2/1", c.sc === 2 && c.sd === 1, c.sc + "/" + c.sd);

    await api(OT, "PATCH", "/tasks/" + kids[0], { status_id: openStatus });
    c = await counterOf(T);
    check("move it back to open -> 2/0 (moves BOTH ways)", c.sc === 2 && c.sd === 0, c.sc + "/" + c.sd);

    const arch = await api(OT, "POST", "/tasks/" + kids[1] + "/archive");
    c = await counterOf(T);
    check("archive a child -> 1/0 (leaves the count, like the list)",
        arch.s === 204 && c.sc === 1, c.sc + "/" + c.sd);
    const sub = await api(OT, "GET", "/tasks/" + T + "/subtasks");
    const subShown = (sub.b?.data ?? sub.b ?? []).length;
    check("…and the badge equals the subtask LIST", c.sc === subShown,
        "counter " + c.sc + ", list returns " + subShown);

    await api(OT, "POST", "/tasks/" + kids[1] + "/unarchive");
    c = await counterOf(T);
    check("unarchive -> back to 2/0", c.sc === 2 && c.sd === 0, c.sc + "/" + c.sd);

    const bulk = await api(OT, "POST", "/tasks/bulk",
        { ids: kids, patch: { status_id: doneStatus } });
    c = await counterOf(T);
    check("BULK both to done -> 2/2 (one recompute per parent)",
        bulk.s === 200 && c.sc === 2 && c.sd === 2,
        c.sc + "/" + c.sd + " (bulk " + bulk.s + ")");

    const hard = await api(OT, "DELETE", "/tasks/" + kids[0] + "?hard=true");
    c = await counterOf(T);
    check("hard-delete a child -> 1/1", c.sc === 1 && c.sd === 1, c.sc + "/" + c.sd);
    if (hard.s === 204) made.splice(made.indexOf(kids[0]), 1);

    // ── ISS-080: forms.submission_count ──────────────────────────────────────
    console.log("\n  --- ISS-080: forms.submission_count vs the retention job ---");
    // ISS-025 protocol (rule X9, same as the F7 probe): the two form_submissions
    // columns the code expects are ADDED for this scenario and DROPPED again at
    // the end, so the deliberately-preserved dev drift stays reproducible for F17.
    await db.query("ALTER TABLE form_submissions ADD COLUMN encrypted_at TIMESTAMP NULL DEFAULT NULL").catch(() => {});
    await db.query("ALTER TABLE form_submissions ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL").catch(() => {});
    const form = await api(OT, "POST", "/forms", { list_id: list.id, title: "F15 counter form" });
    const FID = form.b?.id;
    await api(OT, "POST", "/forms/" + FID + "/fields",
        { field_kind: "task_attr", field_key: "name", label: "What?" });
    const slug = form.b?.public_slug;
    const subIds = [];
    for (const n of [1, 2, 3]) {
        const r = await fetch(B + "/public/forms/" + slug + "/submit", { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: { name: "F15 submission " + n } }) });
        const rb = await j(r);
        if (rb?.task_id ?? rb?.id) made.push(rb.task_id ?? rb.id);
    }
    const formCount = async () => (await one("SELECT submission_count n FROM forms WHERE id=?", [FID])).n;
    const formRows = async () => (await one("SELECT COUNT(*) n FROM form_submissions WHERE form_id=?", [FID])).n;
    check("3 submissions -> count 3", await formCount() === 3 && await formRows() === 3,
        "count " + await formCount());

    // age one row past retention and run the real job
    const [[oldest]] = await db.query(
        "SELECT id FROM form_submissions WHERE form_id=? ORDER BY submitted_at LIMIT 1", [FID]);
    await db.query(
        "UPDATE form_submissions SET submitted_at = UTC_TIMESTAMP() - INTERVAL 400 DAY, expires_at = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id=?",
        [oldest.id]);
    const fs2 = require("node:fs");
    const TOKEN = fs2.readFileSync("E:/Task Management System/server/.env", "utf8")
        .split(/\r?\n/).find((l) => l.startsWith("INTERNAL_JOB_TOKEN="))?.slice(19).trim();
    const jobRes = await fetch(B + "/jobs/form-submission-expiry", { method: "POST",
        headers: { "X-Internal-Token": TOKEN } });
    const jobBody = await j(jobRes);
    const after = await formCount(), rows = await formRows();
    check("the retention job deletes 1 -> count follows to 2 (was STUCK at 3)",
        after === 2 && rows === 2, "count " + after + ", rows " + rows +
        ", job deleted " + (jobBody?.deleted ?? "?"));

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log("\n  === CLEANUP ===");
    await db.query("DELETE FROM form_submissions WHERE form_id=?", [FID]).catch(() => {});
    // ISS-025 stays reproducible for F17 — put the drift back.
    // F17 RETIRED the ISS-025 add/drop protocol: the columns are now PERMANENT
    // (upgrades/008). Dropping them here would REINTRODUCE the drift.
    await db.query("DELETE FROM form_fields WHERE form_id=?", [FID]).catch(() => {});
    await db.query("DELETE FROM forms WHERE id=?", [FID]).catch(() => {});
    // Delete by NAME, not by the ids the probe happened to collect: the
    // public-form path creates tasks this script never sees the ids of, and a
    // leftover row would corrupt the baseline every later phase restores to.
    const [strays] = await db.query(
        "SELECT id FROM tasks WHERE name LIKE 'F15 %' OR name LIKE 'F15X%' OR name LIKE 'F15 submission%'");
    const ids = [...new Set([...made.filter(Boolean), ...strays.map((r) => r.id)])];
    for (const pass of [1, 2]) { // children first, then parents (self-FK)
        for (const id of ids) {
            if (pass === 1) {
                for (const t of ["comments", "task_activity", "task_assignees", "task_watchers",
                                 "task_tags", "notifications", "checklists", "task_dependencies",
                                 "attachments", "custom_field_values", "task_reviews"])
                    await db.query("DELETE FROM " + t + " WHERE task_id=?", [id]).catch(() => {});
                await db.query("UPDATE tasks SET parent_task_id=NULL WHERE parent_task_id=?", [id]).catch(() => {});
            } else {
                await db.query("DELETE FROM tasks WHERE id=?", [id]).catch(() => {});
            }
        }
    }
    await db.query("DELETE FROM comments WHERE body LIKE 'F15 %'").catch(() => {});
    await db.query("DELETE FROM workspace_activity WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    await db.query("DELETE FROM notifications WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR").catch(() => {});
    const q = async (t) => (await one("SELECT COUNT(*) n FROM " + t)).n;
    console.log("  tasks " + await q("tasks") + " (46) | comments " + await q("comments") +
        " (7) | forms " + await q("forms") + " (0) | notif " + await q("notifications") + " (57)");
    console.log(bad === 0
        ? "\n  PASS — all three counters track the rows, in both directions.\n"
        : "\n  *** " + bad + " CHECK(S) FAILED ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
