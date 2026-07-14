import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { sql } from "drizzle-orm";
import pkg from "../../../package.json";
import { getDb } from "../db/client";
import { renderProm } from "../observability/metrics";
import internalAuth from "../middlewares/internalAuth";

/**
 * §30 Health & diagnostics — unauthenticated probes for k8s / load balancers /
 * monitoring. Mounted at the APP root (NOT under `/api/v1`), so the v1
 * `apiLimiter` never applies. Liveness (`GET /health`) stays inline in `app.ts`
 * (per the spec, already done); this router adds the other three.
 */

const router = express.Router();

// Resolved once at BUILD time via `resolveJsonModule` — Workers have no
// filesystem, so the app manifest (`astro-app/package.json`) is bundled in.
const VERSION: string = (pkg as { version?: string }).version ?? "unknown";

/**
 * Timeout-bounded DB liveness ping (§30 #2). MUST resolve within `timeoutMs` so
 * an unhealthy DB cannot hold the readiness probe open (k8s would never roll the
 * pod). libSQL-over-HTTP has no pool/connections to leak — a `SELECT 1` round
 * trip replaces the old mysql2 `conn.ping()`. (No `.unref()`: Workers'
 * `setTimeout` returns a number, and there is no process to keep alive.)
 */
const pingDb = async (timeoutMs: number): Promise<boolean> => {
    const ping = (async (): Promise<void> => {
        await getDb().run(sql`select 1`);
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(
            () => reject(new Error("readiness check timed out")),
            timeoutMs,
        );
    });
    try {
        await Promise.race([ping, timeout]);
        return true;
    } catch {
        // Swallow the rejection from the losing `ping` promise so it is not an
        // unhandled rejection if the timeout won.
        ping.catch(() => undefined);
        return false;
    }
};

// ─── GET /health/ready ───────────────────────────────────────────────────────
// Readiness — the process can serve traffic only if its dependencies are
// reachable. Pings the DB within 2500ms; Redis is not integrated yet (it would be
// pinged here too once it is). 200 when ready, 503 otherwise.
//
// NOTE: the timeout was 500ms, which is too tight for the production Turso
// round-trip (CF edge → Turso cloud over HTTP, cold, is 500-900ms) — it made
// /health/ready return a persistent 503 false-negative on prod while real
// queries (login etc.) succeeded, tripping any uptime monitor / LB health check.
// 2500ms still bounds the probe but tolerates real prod DB latency. (P46-1)
router.get(
    "/health/ready",
    (_req: Request, res: Response, next: NextFunction) => {
        pingDb(2500)
            .then((dbOk) => {
                if (dbOk) {
                    res.status(200).json({
                        status: "ready",
                        checks: { database: "ok" },
                    });
                } else {
                    res.status(503).json({
                        status: "not_ready",
                        checks: { database: "down" },
                    });
                }
            })
            .catch(next);
    },
);

// ─── GET /health/version ─────────────────────────────────────────────────────
// Build SHA (set at build time via GIT_SHA) + package version + uptime. Nothing
// sensitive is exposed.
router.get("/health/version", (_req: Request, res: Response) => {
    res.status(200).json({
        version: VERSION,
        git_sha: process.env.GIT_SHA ?? "unknown",
        uptime_seconds: Math.floor(process.uptime()),
        node: process.version,
    });
});

// ─── GET /metrics ────────────────────────────────────────────────────────────
// Prometheus scrape endpoint (text exposition format v0.0.4). Guarded by
// internalAuth (X-Internal-Token) so the route names + traffic counts are not
// public — the scraper must send the internal token (P46-2).
router.get("/metrics", internalAuth, (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send(renderProm());
});

export default router;
