import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "path";

config({
    path: path.join(__dirname, `.env.${process.env.NODE_ENV || "dev"}`),
});

export default defineConfig({
    schema: "./src/db/schema/index.ts",
    out: "./src/db/migrations",
    dialect: "mysql",
    dbCredentials: {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME!,
    },
    verbose: true,
    strict: true,
});
