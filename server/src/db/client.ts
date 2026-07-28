import { drizzle, MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { Config } from "../config";
import * as schema from "./schema";

let pool: mysql.Pool;
let db: MySql2Database<typeof schema>;

/**
 * Fixed offset like `+06:00`, or undefined. Named zones (`Asia/Dhaka`) are
 * rejected on purpose: MySQL only resolves those when the tz tables have been
 * loaded, which they usually have not been, and Bangladesh has no DST — so an
 * offset is both safer and exactly equivalent here.
 */
const dbTimezone = ((): string | undefined => {
    const raw = Config.DB_TIMEZONE?.trim();
    if (!raw) return undefined;
    if (!/^[+-]\d{2}:\d{2}$/.test(raw)) {
        throw new Error(
            `DB_TIMEZONE must be a fixed offset like "+06:00" (got "${raw}")`,
        );
    }
    return raw;
})();

export const initDb = async (): Promise<MySql2Database<typeof schema>> => {
    if (db) return db;

    pool = mysql.createPool({
        host: Config.DB_HOST,
        port: Number(Config.DB_PORT) || 3306,
        user: Config.DB_USERNAME,
        password: Config.DB_PASSWORD,
        database: Config.DB_NAME,
        waitForConnections: true,
        connectionLimit: Number(Config.DB_POOL_MAX) || 10,
        queueLimit: Number(Config.DB_POOL_QUEUE_LIMIT) || 0,
        // Controls how the DRIVER formats/parses JS Dates. It must agree with
        // the MySQL SESSION time_zone set below, or every timestamp is written
        // at the wrong instant — silently, and only visible as data that is a
        // few hours off. The two are set together for exactly that reason.
        ...(dbTimezone ? { timezone: dbTimezone } : {}),
        // dateStrings: true,
    });

    if (dbTimezone) {
        // The other half of the pair. Per-connection because the MySQL server is
        // shared with unrelated applications — changing the global time_zone
        // would move THEIR timestamps too.
        pool.on("connection", (c) => {
            c.query("SET time_zone = ?", [dbTimezone]);
        });
    }

    // Probe connection
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();

    db = drizzle(pool, { schema, mode: "default" });
    return db;
};

export const getDb = (): MySql2Database<typeof schema> => {
    if (!db) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return db;
};

export const getPool = (): mysql.Pool => {
    if (!pool) {
        throw new Error("Pool not initialized. Call initDb() first.");
    }
    return pool;
};

export const closeDb = async (): Promise<void> => {
    if (pool) {
        await pool.end();
    }
};
