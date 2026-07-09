/**
 * Apply drizzle/_post.sql (triggers + views — DDL drizzle-kit can't manage)
 * to the Turso database. Run after `npm run db:push`:
 *
 *   npx tsx scripts/apply-post-sql.ts
 *
 * Statements are separated by `--> statement-breakpoint` (trigger bodies
 * contain semicolons, so naive `;` splitting would corrupt them).
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: ".dev.vars" });

const main = async () => {
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });

    const raw = readFileSync("drizzle/_post.sql", "utf8");
    const statements = raw
        .split(/-->\s*statement-breakpoint/)
        .map((s) =>
            s
                .split("\n")
                .filter((l) => !l.trim().startsWith("--"))
                .join("\n")
                .trim(),
        )
        .filter((s) => s.length > 0);

    let applied = 0;
    for (const stmt of statements) {
        await client.execute(stmt);
        applied++;
    }
    console.log(`Applied ${applied} post-migration statements (triggers + views).`);
    client.close();
};

main().catch((err) => {
    console.error("apply-post-sql failed:", err);
    process.exit(1);
});
