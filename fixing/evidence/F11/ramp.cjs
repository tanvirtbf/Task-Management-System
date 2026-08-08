// F11 — the P40 concurrency ramp, re-runnable before/after the fix.
//
// Fires N simultaneous GET /lists/:id/tasks?limit=50 against the 5 000-task
// perf workspace (the endpoint with the biggest per-request query fan-out:
// 1 list lookup + 2 page/count + 4 hydration = 7 queries, PEAK 4 concurrent
// acquires). Reports the status distribution and latency at each step.
//
// Usage:  API_PORT=5713 node ramp.cjs [--label before]
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5713") + "/api/v1";
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const label = (() => { const i = process.argv.indexOf("--label"); return i > 0 ? process.argv[i + 1] : ""; })();
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

(async () => {
    const db = await mysql.createConnection({ host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement_perf", timezone: "+00:00" });
    const [[u]] = await db.query("SELECT email FROM users ORDER BY created_at LIMIT 1");
    const [[l]] = await db.query(
        `SELECT l.id, (SELECT COUNT(*) FROM tasks WHERE primary_list_id = l.id) n
         FROM lists l ORDER BY n DESC LIMIT 1`);
    await db.end();

    const login = await fetch(B + "/auth/login", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.email, password: "Owner@12345" }) });
    const token = (await j(login)).access_token;
    if (!token) { console.error("  cannot log in as " + u.email + " (status " + login.status + ")"); process.exit(2); }

    const url = B + "/lists/" + l.id + "/tasks?limit=50";
    const hit = async () => {
        const t0 = Date.now();
        const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
        const body = r.status === 200 ? null : await j(r);
        return { s: r.status, ms: Date.now() - t0,
                 code: body?.error?.code, retry: r.headers.get("retry-after") };
    };

    console.log("\n  === F11 concurrency ramp" + (label ? " — " + label : "") + " ===");
    console.log("  target: GET /lists/" + l.id + "/tasks?limit=50  (" + l.n + " tasks in the list)");
    console.log("  " + pad("conc", 6) + pad("ok", 6) + pad("failed", 8) + pad("statuses", 26) +
        pad("p50 ms", 9) + pad("max ms", 9) + "verdict");

    let worstFail = 0;
    for (const n of [5, 10, 15, 20, 30, 50]) {
        const rs = await Promise.all(Array.from({ length: n }, hit));
        const ok = rs.filter((r) => r.s === 200).length;
        const failed = n - ok;
        if (failed > worstFail) worstFail = failed;
        const dist = {};
        for (const r of rs) {
            const k = r.s === 200 ? "200" : r.s + (r.code ? " " + r.code : "");
            dist[k] = (dist[k] ?? 0) + 1;
        }
        const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
        const p50 = lat[Math.floor(lat.length / 2)];
        const retryHdr = rs.find((r) => r.retry)?.retry;
        console.log("  " + pad(n, 6) + pad(ok, 6) + pad(failed, 8) +
            pad(Object.entries(dist).map(([k, v]) => k + "×" + v).join(" "), 26) +
            lpad(p50, 7) + "  " + lpad(lat[lat.length - 1], 7) + "  " +
            (failed === 0 ? "OK" : "*** " + failed + " FAILED ***") +
            (retryHdr ? "  Retry-After: " + retryHdr : ""));
    }

    // the same 50, sequentially — the P40 control
    const seq = [];
    for (let i = 0; i < 50; i++) seq.push(await hit());
    const seqOk = seq.filter((r) => r.s === 200).length;
    console.log("  " + pad("50 seq", 6) + pad(seqOk, 6) + pad(50 - seqOk, 8) +
        pad("(the P40 control)", 26) + lpad("", 7) + "  " + lpad("", 7) + "  " +
        (seqOk === 50 ? "OK" : "*** FAILED ***"));

    console.log(worstFail === 0
        ? "\n  PASS — every level fully served.\n"
        : "\n  worst level: " + worstFail + " failed request(s).\n");
    process.exit(worstFail === 0 ? 0 : 1);
})();
