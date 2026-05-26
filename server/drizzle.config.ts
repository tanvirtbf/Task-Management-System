import { defineConfig } from "drizzle-kit";
import { Config } from "./src/config";

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./src/db/migrations",
    dialect: "mysql",
    dbCredentials: {
        host: Config.DB_HOST!,
        port: Number(Config.DB_PORT),
        user: Config.DB_USERNAME!,
        password: Config.DB_PASSWORD!,
        database: Config.DB_NAME!,
    },
});
