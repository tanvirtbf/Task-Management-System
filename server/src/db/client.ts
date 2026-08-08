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
    // F5 boot guard (ISS-058's production-coupling half): production runs the
    // canonical clock or it does not run. F3 pinned storage to UTC because
    // Drizzle's timestamp mapper hardcodes +0000 — any other session value
    // reintroduces a silent 6 h drift on every TIMESTAMP, visible only as data
    // that is quietly wrong. The process TZ is deliberately NOT checked: F3
    // decoupled it (pm2 keeps TZ=Asia/Dhaka while the session is UTC), so the
    // guard is on the value that matters, not on an agreement between files.
    if (Config.IS_PROD && raw !== "+00:00") {
        throw new Error(
            `Refusing to start: NODE_ENV=${Config.NODE_ENV} requires DB_TIMEZONE=+00:00 ` +
                `(the canonical clock — got ${raw ? `"${raw}"` : "unset"}). ` +
                "See fixing/results/F03.md and server/.env.example.",
        );
    }
    if (!raw) return undefined;
    if (!/^[+-]\d{2}:\d{2}$/.test(raw)) {
        throw new Error(
            `DB_TIMEZONE must be a fixed offset like "+06:00" (got "${raw}")`,
        );
    }
    return raw;
})();

/**
 * Where to reach MySQL. `DB_SOCKET_PATH` wins when set.
 *
 * This is not just a performance preference. On MySQL **8.4** the
 * `mysql_native_password` plugin ships DISABLED, and accounts default to
 * `caching_sha2_password`. Over plain TCP that scheme needs an RSA key exchange
 * (or TLS) to complete a first-time authentication; mysql2 does not negotiate
 * it, falls back to asking for `mysql_native_password`, and the server answers
 * `ER_PLUGIN_IS_NOT_LOADED`. A unix socket is treated as an already-secure
 * channel, so the same credentials authenticate cleanly. Verified against a
 * live 8.4.7 server: all five TCP variants failed, the socket succeeded.
 */
export const dbEndpoint = ():
    | { socketPath: string }
    | { host: string | undefined; port: number } => {
    const socketPath = Config.DB_SOCKET_PATH?.trim();
    return socketPath
        ? { socketPath }
        : { host: Config.DB_HOST, port: Number(Config.DB_PORT) || 3306 };
};

export const initDb = async (): Promise<MySql2Database<typeof schema>> => {
    if (db) return db;

    pool = mysql.createPool({
        ...dbEndpoint(),
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
