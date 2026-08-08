// Apply a database/upgrades/*.sql script over mysql2.
//
// The mysql2 driver does not understand the `DELIMITER $$` directive the mysql
// CLI uses for trigger bodies, so this walks the file line by line tracking the
// CURRENT delimiter and emits whole statements. `--` comments are stripped only
// at the START of a line, never mid-line, so a `--` inside a string literal is
// left alone. (The first attempt at this used a regex over the whole file and
// mangled multi-line comment blocks into bogus statements.)
//
//   node apply-upgrade.cjs <path.sql> <db> [<db> …]
const fs = require("fs");
const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");

const parse = (raw) => {
    const out = [];
    let delim = ";";
    let buf = "";
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!buf && (t === "" || t.startsWith("--"))) continue;
        const d = t.match(/^DELIMITER\s+(\S+)$/i);
        if (d) {
            delim = d[1];
            continue;
        }
        buf += (buf ? "\n" : "") + line;
        if (t.endsWith(delim)) {
            const stmt = buf.slice(0, buf.lastIndexOf(delim)).trim();
            if (stmt) out.push(stmt);
            buf = "";
        }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
};

(async () => {
    const [file, ...dbs] = process.argv.slice(2);
    const stmts = parse(fs.readFileSync(file, "utf8"));
    console.log("  " + file.split(/[\\/]/).pop() + ": " + stmts.length + " statements");
    let failed = 0;
    for (const name of dbs) {
        const db = await mysql.createConnection({
            host: "127.0.0.1", user: "root", password: "root",
            database: name, timezone: "+00:00", multipleStatements: false,
        });
        await db.query("SET time_zone='+00:00'");
        let okCount = 0;
        for (const st of stmts) {
            try {
                await db.query(st);
                okCount++;
            } catch (e) {
                failed++;
                console.log("  [" + name + "] FAILED: " + st.split("\n")[0].slice(0, 58));
                console.log("           " + e.message.slice(0, 96));
            }
        }
        console.log("  " + name.padEnd(22) + okCount + "/" + stmts.length + " applied");
        await db.end();
    }
    process.exit(failed ? 1 : 0);
})();
