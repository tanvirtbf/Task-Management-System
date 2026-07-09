import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// .dev.vars is wrangler's local-secret file; it is plain KEY=VALUE so dotenv
// can read it too — one source of truth for local tooling.
config({ path: ".dev.vars" });

export default defineConfig({
    dialect: "turso",
    schema: "./src/server/db/schema/index.ts",
    out: "./drizzle",
    dbCredentials: {
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
    },
});
