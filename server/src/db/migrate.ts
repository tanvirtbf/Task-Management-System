import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { Config } from "../config";
import logger from "../config/logger";

const runMigrations = async () => {
    const connection = await mysql.createConnection({
        host: Config.DB_HOST,
        port: Number(Config.DB_PORT),
        user: Config.DB_USERNAME,
        password: Config.DB_PASSWORD,
        database: Config.DB_NAME,
        multipleStatements: true,
    });

    const db = drizzle(connection);

    try {
        logger.info("Running database migrations...");
        await migrate(db, { migrationsFolder: "./src/db/migrations" });
        logger.info("Migrations complete.");
    } catch (err) {
        logger.error("Migration failed", err);
        process.exitCode = 1;
    } finally {
        await connection.end();
    }
};

void runMigrations();
