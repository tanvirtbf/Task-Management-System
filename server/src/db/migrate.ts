import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import path from "path";
import { Config } from "../config";
import logger from "../config/logger";

const runMigrations = async () => {
    try {
        const connection = await mysql.createConnection({
            host: Config.DB_HOST,
            port: Number(Config.DB_PORT) || 3306,
            user: Config.DB_USERNAME,
            password: Config.DB_PASSWORD,
            database: Config.DB_NAME,
            multipleStatements: true,
        });

        const db = drizzle(connection);

        logger.info("Running migrations...");
        await migrate(db, {
            migrationsFolder: path.join(__dirname, "migrations"),
        });
        logger.info("Migrations completed successfully.");

        await connection.end();
        process.exit(0);
    } catch (err: unknown) {
        if (err instanceof Error) {
            logger.error("Migration failed", { error: err.message });
        }
        process.exit(1);
    }
};

void runMigrations();
