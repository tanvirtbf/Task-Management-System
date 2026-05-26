import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { Config } from "../config";
import * as schema from "./schema";

const poolConnection = mysql.createPool({
    host: Config.DB_HOST,
    port: Number(Config.DB_PORT),
    user: Config.DB_USERNAME,
    password: Config.DB_PASSWORD,
    database: Config.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z",
});

poolConnection.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
});

export const db = drizzle(poolConnection, { schema, mode: "default" });
export type DbClient = typeof db;

export * from "./schema";
