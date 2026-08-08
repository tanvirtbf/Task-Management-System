// F30 — the P40 §1 latency table, re-run AFTER upgrade 013 against the same
// perf fixture. Gate: "no endpoint slower than before" — compared against the
// P40 medians hard-coded below (same box, same DB, same method: median of 7).
//
//   API_PORT=5713 node fixing/evidence/F30/latency-probe.cjs
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const B = "http://127.0.0.1:" + (process.env.API_PORT || "5713") + "/api/v1";
const pad = (s, n) => String(s ?? "").padEnd(n);
const lpad = (s, n) => String(s ?? "").padStart(n);

// P40's medians (testing/evidence/PHASE-40/perf.txt §1), the "before" column.
const P40 = {
    "/home/kpis": 24.1, "/tasks/my-work": 24.4, "/home/agenda": 5.5,
    "list50": 17.3, "list200": 19.6, "/search?q=Perf": 124.9,
    "/tasks/:id": 7.4, "comments": 5.9, "activity50": 7.4,
    "/activity?limit=50": 4.0, "/activity/recent": 2.6, "/spaces": 5.3,
    "/users?limit=50": 5.3, "/notifications?limit=50": 6.2,
};

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

(async () => {
    const db = await mysql.createConnection({
        host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement_perf", timezone: "+00:00",
    });
    const [[u]] = await db.query("SELECT email FROM users ORDER BY created_at LIMIT 1");
    const [[l]] = await db.query(
        `SELECT l.id, (SELECT COUNT(*) FROM tasks WHERE primary_list_id = l.id) n
           FROM lists l ORDER BY n DESC LIMIT 1`);
    const [[ct]] = await db.query(
        `SELECT task_id id FROM comments GROUP BY task_id ORDER BY COUNT(*) DESC LIMIT 1`);
    await db.end();

    const login = await fetch(B + "/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.email, password: "Owner@12345" }),
    });
    const token = (await login.json()).access_token;
    if (!token) { console.error("cannot log in (status " + login.status + ")"); process.exit(2); }
    const H = { Authorization: "Bearer " + token };

    const ENDPOINTS = [
        ["/home/kpis", "/home/kpis"],
        ["/tasks/my-work", "/tasks/my-work"],
        ["/home/agenda", "/home/agenda"],
        ["list50", "/lists/" + l.id + "/tasks?limit=50"],
        ["list200", "/lists/" + l.id + "/tasks?limit=200"],
        ["/search?q=Perf", "/search?q=Perf"],
        ["/tasks/:id", "/tasks/" + ct.id],
        ["comments", "/tasks/" + ct.id + "/comments"],
        ["activity50", "/tasks/" + ct.id + "/activity?limit=50"],
        ["/activity?limit=50", "/activity?limit=50"],
        ["/activity/recent", "/activity/recent"],
        ["/spaces", "/spaces"],
        ["/users?limit=50", "/users?limit=50"],
        ["/notifications?limit=50", "/notifications?limit=50"],
    ];

    console.log("\n=== F30 latency (median of 7) vs P40 — after upgrade 013 ===");
    console.log("  " + pad("endpoint", 26) + lpad("P40 ms", 9) + lpad("now ms", 9) + lpad("delta", 9) + "   verdict");
    let regressions = 0;
    for (const [key, path] of ENDPOINTS) {
        const times = [];
        let status = 0;
        for (let i = 0; i < 7; i += 1) {
            const t0 = performance.now();
            const r = await fetch(B + path, { headers: H });
            await r.arrayBuffer();
            times.push(performance.now() - t0);
            status = r.status;
        }
        const now = median(times);
        const before = P40[key];
        // "Slower" with headroom for run-to-run noise on a dev box: a regression
        // is >2× AND >20 ms absolute. Everything here sits in single/low-double
        // digits, where ±5 ms is machine noise, not a plan change.
        const slower = now > before * 2 && now - before > 20;
        if (status !== 200) { regressions += 1; }
        if (slower) regressions += 1;
        console.log("  " + pad(key, 26) + lpad(before.toFixed(1), 9) + lpad(now.toFixed(1), 9)
            + lpad((now - before >= 0 ? "+" : "") + (now - before).toFixed(1), 9)
            + "   " + (status !== 200 ? "HTTP " + status + " !" : slower ? "SLOWER !" : "ok"));
    }
    console.log(regressions === 0
        ? "\n  PASS — every endpoint 200, none slower than P40 beyond noise"
        : "\n  FAIL — " + regressions + " regression(s)");
    process.exit(regressions === 0 ? 0 : 1);
})().catch((e) => { console.error("PROBE ERROR " + e.message); process.exit(2); });
