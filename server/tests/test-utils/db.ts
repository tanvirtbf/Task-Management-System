import mysql, { type PoolConnection } from "mysql2/promise";
import { readFileSync } from "node:fs";
import path from "node:path";
import { initDb, closeDb, getPool } from "../../src/db/client";
import { Config } from "../../src/config";

const SCHEMA_PATH = path.join(__dirname, "../../../database/schema.sql");

const cleanSql = (raw: string): string =>
    raw
        .replace(/^DELIMITER\s+\$\$\s*$/gim, "")
        .replace(/^DELIMITER\s+;\s*$/gim, "")
        .replace(/\$\$\s*$/gm, ";");

/**
 * Resolve THIS jest invocation's test database name.
 *
 * When `TEST_DB_SUFFIX` is set, the name is derived as
 * `taskmanagement_<suffix>_test` — unique per invocation and never written to
 * the shared `.env.test`, so a suite running concurrently in another process
 * can't name it (and therefore can't `DROP DATABASE` it out from under us).
 * Without the suffix it falls back to `Config.DB_NAME` (the legacy
 * `.env.test`-driven name), so existing single-run behaviour is unchanged.
 */
export const resolveTestDbName = (): string => {
    const suffix = process.env.TEST_DB_SUFFIX;
    if (suffix && /^[a-z0-9_]+$/i.test(suffix)) {
        return `taskmanagement_${suffix.toLowerCase()}_test`;
    }
    return Config.DB_NAME ?? "";
};

/**
 * Pin `Config.DB_NAME` to the resolved per-invocation name. Call once at the
 * start of BOTH the global-setup process and each test worker so provisioning,
 * the app connection pool, and truncation all target the same database — even
 * if another process rewrites `.env.test` mid-run.
 */
export const applyTestDbName = (): string => {
    Config.DB_NAME = resolveTestDbName();
    return Config.DB_NAME;
};

/**
 * One-time setup: ensure the test database exists with a fresh schema.
 * Called from the `globalSetup` jest hook.
 */
export const provisionTestDb = async () => {
    if (Config.NODE_ENV !== "test") {
        throw new Error(
            `Refusing to provision test DB — NODE_ENV is "${Config.NODE_ENV}", expected "test"`,
        );
    }
    const dbName = Config.DB_NAME;
    if (!dbName || !dbName.endsWith("_test")) {
        throw new Error(
            `Refusing to provision test DB — DB_NAME "${dbName}" does not end with _test`,
        );
    }

    const bootstrap = await mysql.createConnection({
        host: Config.DB_HOST,
        port: Number(Config.DB_PORT) || 3306,
        user: Config.DB_USERNAME,
        password: Config.DB_PASSWORD,
        multipleStatements: true,
    });
    try {
        await bootstrap.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        await bootstrap.query(
            `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
    } finally {
        await bootstrap.end();
    }

    const conn = await mysql.createConnection({
        host: Config.DB_HOST,
        port: Number(Config.DB_PORT) || 3306,
        user: Config.DB_USERNAME,
        password: Config.DB_PASSWORD,
        database: dbName,
        multipleStatements: true,
    });
    try {
        const schemaSql = cleanSql(readFileSync(SCHEMA_PATH, "utf8"));
        await conn.query(schemaSql);
    } finally {
        await conn.end();
    }
};

/**
 * Wipe all table data while preserving the schema. Called from `beforeEach`
 * so every test starts from a known empty state without dropping triggers
 * and views (which would slow tests by ~100x).
 *
 * We disable FK checks during truncation so order does not matter.
 */
export const resetTestDb = async () => {
    const conn = await getPool().getConnection();
    let tables: string[];
    try {
        const [rows] = (await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [Config.DB_NAME],
        )) as [Array<{ TABLE_NAME: string }>, unknown];
        tables = rows.map((r) => r.TABLE_NAME);
    } finally {
        conn.release();
    }
    // KI-29 (§P13): the whole-database reset goes through the same helper as
    // every per-module one, so it inherits the AFTER DELETE trigger handling
    // and the AUTO_INCREMENT reset instead of keeping a second, slower
    // implementation. This is the most expensive reset in the repo — every
    // table, on every test of the modules that use it.
    await resetTables(tables);
};

export const connectTestDb = async () => {
    await initDb();
};

export const disconnectTestDb = async () => {
    await closeDb();
};

/**
 * Empty a known set of tables between tests — the per-test reset every
 * `setup-each-*.ts` runs.
 *
 * ── why this is DELETE and not TRUNCATE (KI-29, §P13) ───────────────────────
 * TRUNCATE is DDL: InnoDB drops and recreates each tablespace file and takes an
 * exclusive metadata lock while it does. Measured on the collab module's real
 * 23-table list, on this machine:
 *
 *     TRUNCATE ×23                       1,295 ms
 *     DELETE ×23                             8 ms      (158×)
 *     DELETE ×23 + AUTO_INCREMENT reset    114 ms      (11×)
 *
 * That is per TEST, and the gate runs thousands. `setup-each-auth.ts` converted
 * first (P2) and measured 268× on its nine tables.
 *
 * ── why it still resets AUTO_INCREMENT ──────────────────────────────────────
 * The obvious conversion — plain DELETE — is NOT equivalent, and several suites
 * depend on the difference. `internal_id` is the keyset-pagination cursor on
 * `tasks`, `comments`, `notifications`, `form_submissions` and others, and
 * `setup-each-forms.ts` says in its own header that it truncates precisely to
 * reset it. So this keeps the semantics TRUNCATE had — empty AND counter back
 * to 1 — and only stops paying for the tablespace churn on the 18 of 23 tables
 * that have no counter at all.
 *
 * The reset is skipped for a table whose counter is already 1, which is the
 * common case: a test usually touches a handful of the list.
 */
/**
 * Tables whose rows are counted by an AFTER DELETE trigger, discovered from the
 * catalogue rather than hardcoded so a NEW trigger is handled automatically.
 * Read once per process — it cannot change mid-run.
 */
let deleteTriggerTables: Set<string> | null = null;
const tablesWithDeleteTriggers = async (
    conn: PoolConnection,
): Promise<Set<string>> => {
    if (deleteTriggerTables) return deleteTriggerTables;
    const [rows] = (await conn.query(
        `SELECT DISTINCT EVENT_OBJECT_TABLE AS t FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = ? AND EVENT_MANIPULATION = 'DELETE'`,
        [Config.DB_NAME],
    )) as [Array<{ t: string }>, unknown];
    deleteTriggerTables = new Set(rows.map((r) => r.t));
    return deleteTriggerTables;
};

/**
 * Empty a known set of tables between tests — the per-test reset every
 * `setup-each-*.ts` runs.
 *
 * ── why not TRUNCATE (KI-29, §P13) ──────────────────────────────────────────
 * TRUNCATE is DDL: InnoDB drops and recreates each tablespace file and takes an
 * exclusive metadata lock while it does. Measured on the collab module's real
 * 23-table list, on this machine:
 *
 *     TRUNCATE ×23                       1,295 ms
 *     DELETE ×23                             8 ms   (158×, but see below)
 *     this function                        ~140 ms   (9×, same semantics)
 *
 * That is per TEST, and the gate runs thousands of them.
 * `setup-each-auth.ts` converted first (P2) and measured 268× on nine tables.
 *
 * ── the two things a naive DELETE gets WRONG ────────────────────────────────
 * Both were found by converting a module and watching it go red, not by
 * reasoning about it:
 *
 *  1. **TRUNCATE does not fire triggers; DELETE does.** Emptying `comments`
 *     row by row runs `trg_comments_after_delete`, which decrements
 *     `tasks.comments_count` — and that column is UNSIGNED, so the reset died
 *     with "BIGINT UNSIGNED value is out of range" across 64 tests. Any table
 *     carrying an AFTER DELETE trigger is therefore still TRUNCATEd; today
 *     that is `comments` and `form_submissions`, and the set is read from the
 *     catalogue so a new trigger does not silently reintroduce the bug.
 *
 *  2. **DELETE does not reset AUTO_INCREMENT.** `internal_id` is the keyset
 *     pagination cursor on `tasks`, `comments`, `notifications` and others, and
 *     `setup-each-forms.ts` says in its own header that it truncates precisely
 *     to reset it. So the counter is put back to 1 wherever it moved.
 *
 * What is left is the actual win: the 18-of-23 ordinary tables stop paying for
 * tablespace churn, and the exclusive metadata lock — which is what made the
 * reset FRAGILE, not just slow — is taken far less often.
 */
export const resetTables = async (
    tables: readonly string[],
): Promise<void> => {
    if (tables.length === 0) return;
    const conn = await getPool().getConnection();
    try {
        const triggered = await tablesWithDeleteTriggers(conn);
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const table of tables) {
            await conn.query(
                triggered.has(table)
                    ? `TRUNCATE TABLE \`${table}\``
                    : `DELETE FROM \`${table}\``,
            );
        }
        // One catalogue read, then an ALTER only where the counter actually
        // moved — usually a couple of tables, because a test touches a handful.
        const [rows] = (await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)
                AND AUTO_INCREMENT IS NOT NULL AND AUTO_INCREMENT > 1`,
            [Config.DB_NAME, [...tables]],
        )) as [Array<{ TABLE_NAME: string }>, unknown];
        for (const { TABLE_NAME } of rows) {
            await conn.query(`ALTER TABLE \`${TABLE_NAME}\` AUTO_INCREMENT = 1`);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
};
