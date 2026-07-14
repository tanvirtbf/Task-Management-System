/**
 * Custom Cloudflare Worker entry (wired via `astro.config` → adapter
 * `workerEntryPoint`). It preserves the adapter's default `fetch` behaviour
 * (SSR + the Express backend via `src/middleware.ts`) and ADDS a `scheduled`
 * handler so Cron Triggers can run the §28 background jobs — the piece the
 * astro/Cloudflare port was missing (jobs existed + were reachable over HTTP,
 * but nothing invoked them on a cadence).
 *
 * The cron→jobs map MUST stay in sync with `wrangler.json` `triggers.crons`.
 * Cadence mirrors each job's documented schedule:
 *   - every 5 min : snooze-wake
 *   - hourly      : session-cleanup, attachment-janitor
 *   - daily 03:00 : r2-purge, form-submission-expiry
 *
 * Deploy-side verification (real Cron Triggers firing) is Phase 46.
 */
import type { SSRManifest } from "astro";
import { App } from "astro/app";
import { handle } from "@astrojs/cloudflare/handler";
import { setRuntimeEnv } from "./server/shim/env";
import type { JobName } from "./server/jobs";

const CRON_JOBS: Record<string, JobName[]> = {
    "*/5 * * * *": ["snooze-wake"],
    "0 * * * *": ["session-cleanup", "attachment-janitor"],
    "0 3 * * *": ["r2-purge", "form-submission-expiry"],
};

export function createExports(manifest: SSRManifest) {
    const app = new App(manifest);
    return {
        default: {
            // ── HTTP: identical to the adapter's default server entry ──
            async fetch(
                request: Request,
                env: Record<string, unknown>,
                ctx: ExecutionContext,
            ): Promise<Response> {
                return handle(manifest, app, request, env as never, ctx);
            },

            // ── Cron Triggers → §28 background jobs ──
            // No Astro middleware runs on a scheduled invocation, so we inject
            // the Workers env into the shim's Config (as middleware.ts does for
            // fetch) and initialise the DB before dispatching — mirroring the
            // lazy boot order in `src/server/entry.ts`.
            async scheduled(
                controller: ScheduledController,
                env: Record<string, unknown>,
                ctx: ExecutionContext,
            ): Promise<void> {
                setRuntimeEnv(env);
                const jobs = CRON_JOBS[controller.cron] ?? [];
                ctx.waitUntil(
                    (async () => {
                        const { initDb } = await import("./server/db/client");
                        await initDb();
                        const { runJob } = await import("./server/jobs");
                        for (const name of jobs) {
                            // runJob never throws — it returns { ok, ... } so a
                            // single job failure cannot abort the rest.
                            await runJob(name, {
                                dryRun: false,
                                requestId: `cron:${controller.cron}`,
                            });
                        }
                    })(),
                );
            },
        } satisfies ExportedHandler<Record<string, unknown>>,
    };
}
