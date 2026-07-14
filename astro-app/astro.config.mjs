// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";

// https://astro.build/config
export default defineConfig({
    output: "server",
    adapter: cloudflare({
        imageService: "passthrough",
        platformProxy: { enabled: true },
        // Custom worker entry adds a `scheduled` handler (Cron Triggers →
        // §28 background jobs) on top of the adapter's default `fetch`.
        workerEntryPoint: {
            path: "src/worker.ts",
        },
    }),
    integrations: [react()],
    security: {
        // The API is consumed by curl / mobile / possible other origins; the
        // backend does its own CORS + cookie-based CSRF hardening (path-scoped
        // refresh cookie), so Astro's blanket same-origin POST check is off.
        checkOrigin: false,
    },
    vite: {
        resolve: {
            alias: {
                // The entire copied backend imports "express" — at runtime it
                // resolves to our Fetch-API shim (Workers-compatible). Types
                // still come from @types/express so the copied code type-checks
                // unchanged.
                express: fileURLToPath(
                    new URL("./src/server/shim/express.ts", import.meta.url),
                ),
            },
        },
    },
});
