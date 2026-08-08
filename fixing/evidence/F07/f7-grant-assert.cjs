// F7 Side 1 — assert the live role_permissions match SYSTEM_ROLE_GRANTS.
//
// F6 established the seeded matrix already encodes today's behaviour, so no
// grants CHANGE in F7 — but the gates only reproduce today's behaviour if the
// live DB actually carries that matrix. This asserts it, per system role, and
// exits non-zero on any drift (which would then need an upgrades/ script per
// rule X4 — expected outcome: none needed).
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const { execSync } = require("node:child_process");

// pull the canonical matrix out of the TS module via tsx
const matrixJson = execSync(
    'npx tsx -e "import { SYSTEM_ROLE_GRANTS } from \'./src/rbac/bootstrap\'; console.log(JSON.stringify(SYSTEM_ROLE_GRANTS));"',
    { cwd: "E:/Task Management System/server", encoding: "utf8" },
).trim().split("\n").pop();
const MATRIX = JSON.parse(matrixJson);

(async () => {
    const db = await mysql.createConnection({
        host: "127.0.0.1", user: "root", password: "root",
        database: "taskmanagement", timezone: "+00:00",
    });
    let bad = 0;
    console.log("\n  === F7 Side 1 — live grants vs SYSTEM_ROLE_GRANTS ===\n");
    for (const [key, want] of Object.entries(MATRIX)) {
        const [rows] = await db.query(
            `SELECT rp.permission_key k FROM roles r
             JOIN role_permissions rp ON rp.role_id = r.id
             WHERE r.role_key = ? AND r.archived_at IS NULL`, [key]);
        const have = new Set(rows.map((r) => r.k));
        const missing = want.filter((k) => !have.has(k));
        const extra = [...have].filter((k) => !want.includes(k));
        const ok = missing.length === 0 && extra.length === 0;
        if (!ok) bad++;
        console.log("  " + (ok ? "OK  " : "DRIFT") + " " + key.padEnd(8) +
            "granted " + String(have.size).padStart(2) + " / expected " + want.length +
            (missing.length ? "   missing: " + missing.join(",") : "") +
            (extra.length ? "   extra: " + extra.join(",") : ""));
    }
    const [[n]] = await db.query(
        "SELECT COUNT(*) n FROM roles WHERE archived_at IS NULL");
    console.log("\n  active roles in the DB: " + n.n + " (4 system + any customs)");
    console.log(bad === 0
        ? "\n  PASS — zero drift. No upgrades/ script needed; the gates land on the intended grants.\n"
        : "\n  *** " + bad + " ROLE(S) DRIFTED — write upgrades/NNN_rbac_grants.sql before the gates go live ***\n");
    await db.end();
    process.exit(bad ? 1 : 0);
})();
