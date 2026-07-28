"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mysql2_1 = require("drizzle-orm/mysql2");
const migrator_1 = require("drizzle-orm/mysql2/migrator");
const promise_1 = __importDefault(require("mysql2/promise"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("../config");
const logger_1 = __importDefault(require("../config/logger"));
/**
 * Run Drizzle migrations, then apply the post-migration SQL that contains
 * triggers, the FULLTEXT ngram index, and the views — none of which Drizzle
 * can express in its TS schema language.
 */
const runMigrations = async () => {
    try {
        const connection = await promise_1.default.createConnection({
            host: config_1.Config.DB_HOST,
            port: Number(config_1.Config.DB_PORT) || 3306,
            user: config_1.Config.DB_USERNAME,
            password: config_1.Config.DB_PASSWORD,
            database: config_1.Config.DB_NAME,
            multipleStatements: true,
        });
        const db = (0, mysql2_1.drizzle)(connection);
        logger_1.default.info("Running Drizzle migrations...");
        await (0, migrator_1.migrate)(db, {
            migrationsFolder: node_path_1.default.join(__dirname, "migrations"),
        });
        logger_1.default.info("Drizzle migrations complete.");
        const postPath = node_path_1.default.join(__dirname, "migrations", "_post.sql");
        logger_1.default.info(`Applying post-migration SQL from ${postPath}`);
        const postSql = (0, node_fs_1.readFileSync)(postPath, "utf8");
        // Strip the DELIMITER markers — mysql2's multipleStatements works on
        // straight `;`-terminated stmts.  Triggers with BEGIN…END are still
        // single statements; the markers are only a `mysql` CLI affordance.
        const cleaned = postSql
            .replace(/^DELIMITER\s+\$\$\s*$/gim, "")
            .replace(/^DELIMITER\s+;\s*$/gim, "")
            .replace(/\$\$\s*$/gm, ";");
        await connection.query(cleaned);
        logger_1.default.info("Post-migration SQL applied.");
        await connection.end();
        process.exit(0);
    }
    catch (err) {
        if (err instanceof Error) {
            logger_1.default.error("Migration failed", { error: err.message, stack: err.stack });
        }
        process.exit(1);
    }
};
void runMigrations();
