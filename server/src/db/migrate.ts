import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Config } from "../config";
import { dbEndpoint } from "./client";
import logger from "../config/logger";

/**
 * Run Drizzle migrations, then apply the post-migration SQL that contains
 * triggers, the FULLTEXT ngram index, and the views — none of which Drizzle
 * can express in its TS schema language.
 */
const runMigrations = async () => {
    try {
        const connection = await mysql.createConnection({
            ...dbEndpoint(),
            user: Config.DB_USERNAME,
            password: Config.DB_PASSWORD,
            database: Config.DB_NAME,
            multipleStatements: true,
        });

        const db = drizzle(connection);

        logger.info("Running Drizzle migrations...");
        await migrate(db, {
            migrationsFolder: path.join(__dirname, "migrations"),
        });
        logger.info("Drizzle migrations complete.");

        const postPath = path.join(__dirname, "migrations", "_post.sql");
        logger.info(`Applying post-migration SQL from ${postPath}`);
        const postSql = readFileSync(postPath, "utf8");
        // Strip the DELIMITER markers — mysql2's multipleStatements works on
        // straight `;`-terminated stmts.  Triggers with BEGIN…END are still
        // single statements; the markers are only a `mysql` CLI affordance.
        const cleaned = postSql
            .replace(/^DELIMITER\s+\$\$\s*$/gim, "")
            .replace(/^DELIMITER\s+;\s*$/gim, "")
            .replace(/\$\$\s*$/gm, ";");
        await connection.query(cleaned);
        logger.info("Post-migration SQL applied.");

        await connection.end();
        process.exit(0);
    } catch (err: unknown) {
        if (err instanceof Error) {
            logger.error("Migration failed", { error: err.message, stack: err.stack });
        }
        process.exit(1);
    }
};

void runMigrations();
