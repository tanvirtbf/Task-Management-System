import { drizzle, MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { Config } from "../config";
import * as schema from "./schema";

let pool: mysql.Pool;
let db: MySql2Database<typeof schema>;

export const initDb = async (): Promise<MySql2Database<typeof schema>> => {
    if (db) return db;

    pool = mysql.createPool({
        host: Config.DB_HOST,
        port: Number(Config.DB_PORT) || 3306,
        user: Config.DB_USERNAME,
        password: Config.DB_PASSWORD,
        database: Config.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        // dateStrings: true,
    });

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
