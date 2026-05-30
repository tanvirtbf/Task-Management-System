import mysql from "mysql2/promise";
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
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        const [rows] = (await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [Config.DB_NAME],
        )) as [Array<{ TABLE_NAME: string }>, unknown];
        for (const { TABLE_NAME } of rows) {
            await conn.query(`TRUNCATE TABLE \`${TABLE_NAME}\``);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
};

export const connectTestDb = async () => {
    await initDb();
};

export const disconnectTestDb = async () => {
    await closeDb();
};
