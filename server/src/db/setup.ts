import mysql from "mysql2/promise";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Config } from "../config";
import { dbEndpoint } from "./client";
import logger from "../config/logger";

/**
 * Bootstrap a FRESH database from `database/schema.sql` — the raw, self-
 * contained source of truth (tables + triggers + views all in one file).
 *
 *   npm run db:setup           # FRESH PROVISION ONLY — refuses a non-empty DB
 *   npm run db:setup:fresh     # WIPES the DB first (dev/test only!)
 *
 * ⚠️ DESTRUCTIVE (gap-scan H3): schema.sql begins with DROP TABLE IF EXISTS —
 * applying it to a database that already has tables means TOTAL DATA LOSS.
 * This script therefore ABORTS when the target DB is non-empty unless --drop
 * was given explicitly. To change the schema of an EXISTING database, run the
 * hand-written scripts in `database/upgrades/` (the canonical upgrade path —
 * see src/db/migrations/README.md).
 */

const SCHEMA_PATH = path.join(__dirname, "../../../database/schema.sql");

/**
 * mysql2's multipleStatements works on `;`-terminated statements; it does not
 * understand the `DELIMITER $$ … $$` directive used by the mysql CLI.
 * Strip those markers and rewrite `$$` back to `;` so triggers compile.
 */
const cleanSql = (raw: string): string =>
    raw
        .replace(/^DELIMITER\s+\$\$\s*$/gim, "")
        .replace(/^DELIMITER\s+;\s*$/gim, "")
        .replace(/\$\$\s*$/gm, ";");

const setupDb = async () => {
    const wantDrop = process.argv.includes("--drop");
    const dbName = Config.DB_NAME;
    if (!dbName) {
        logger.error("DB_NAME is not set in environment");
        process.exit(1);
    }

    if (!existsSync(SCHEMA_PATH)) {
        logger.error(`Schema file not found at ${SCHEMA_PATH}`);
        process.exit(1);
    }

    // Phase 1 — connect WITHOUT a database to CREATE / DROP it.
    const bootstrap = await mysql.createConnection({
        ...dbEndpoint(),
        user: Config.DB_USERNAME,
        password: Config.DB_PASSWORD,
        multipleStatements: true,
    });

    try {
        if (wantDrop) {
            // db:setup itself is safe on prod (it refuses a non-empty DB), but
            // --drop deletes the whole database first. Never on a prod box.
            if (Config.IS_PROD) {
                logger.error(
                    `REFUSING --drop: NODE_ENV=${Config.NODE_ENV}. This would DELETE the database "${dbName}".`,
                );
                process.exit(1);
            }
            logger.warn(`Dropping database ${dbName} (--drop given)`);
            await bootstrap.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        }
        logger.info(`Ensuring database ${dbName} exists`);
        await bootstrap.query(
            `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
    } finally {
        await bootstrap.end();
    }

    // Phase 2 — connect TO the database and apply schema + _post.
    const conn = await mysql.createConnection({
        ...dbEndpoint(),
        user: Config.DB_USERNAME,
        password: Config.DB_PASSWORD,
        database: dbName,
        multipleStatements: true,
    });

    try {
        // Gap-scan H3 guard: schema.sql DROPs every table first. Refuse to
        // "sync" over live data — that is what database/upgrades/ is for.
        if (!wantDrop) {
            const [[existing]] = (await conn.query(
                `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
                [dbName],
            )) as [{ n: number }[], unknown];
            if (existing.n > 0) {
                logger.error(
                    `Refusing to apply schema.sql: database "${dbName}" already has ${existing.n} tables and schema.sql would DROP them all. ` +
                        `For schema changes on an existing DB run the scripts in database/upgrades/. ` +
                        `If you REALLY want a wipe, use \`npm run db:setup:fresh\` (--drop).`,
                );
                process.exit(1);
            }
        }

        logger.info(`Applying schema.sql (${SCHEMA_PATH})`);
        const schemaSql = cleanSql(readFileSync(SCHEMA_PATH, "utf8"));
        await conn.query(schemaSql);

        // Report what's in there.
        const [[tCount]] = (await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [dbName],
        )) as [{ n: number }[], unknown];
        const [[vCount]] = (await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`,
            [dbName],
        )) as [{ n: number }[], unknown];
        const [[trgCount]] = (await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?`,
            [dbName],
        )) as [{ n: number }[], unknown];

        logger.info("Database setup complete", {
            db: dbName,
            tables: tCount.n,
            views: vCount.n,
            triggers: trgCount.n,
        });
    } finally {
        await conn.end();
    }

    process.exit(0);
};

setupDb().catch((err: unknown) => {
    logger.error("db:setup failed", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
});
