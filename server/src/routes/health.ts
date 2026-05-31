import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "../db/client";
import { renderProm } from "../observability/metrics";

/**
 * §30 Health & diagnostics — unauthenticated probes for k8s / load balancers /
 * monitoring. Mounted at the APP root (NOT under `/api/v1`), so the v1
 * `apiLimiter` never applies. Liveness (`GET /health`) stays inline in `app.ts`
 * (per the spec, already done); this router adds the other three.
 */

const router = express.Router();

// Read once at module load. From src/routes (and dist/routes) `../../package.json`
// resolves to the server package manifest.
const VERSION: string = (() => {
    try {
        const raw = readFileSync(
            path.join(__dirname, "../../package.json"),
            "utf8",
        );
        const parsed = JSON.parse(raw) as { version?: string };
        return parsed.version ?? "unknown";
    } catch {
        return "unknown";
    }
})();

/**
 * Timeout-bounded DB liveness ping (§30 #2). MUST resolve within `timeoutMs` so
 * an unhealthy DB cannot hold the readiness probe open (k8s would never roll the
 * pod). The ping runs to completion in the background even if the timeout wins,
 * releasing its connection in `finally`, so no connection leaks.
 */
const pingDb = async (timeoutMs: number): Promise<boolean> => {
    const ping = (async (): Promise<void> => {
        const conn = await getPool().getConnection();
        try {
            await conn.ping();
        } finally {
            conn.release();
        }
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(
            () => reject(new Error("readiness check timed out")),
            timeoutMs,
        ).unref();
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
// reachable. Pings the DB within 500ms; Redis is not integrated yet (it would be
// pinged here too once it is). 200 when ready, 503 otherwise.
router.get(
    "/health/ready",
    (_req: Request, res: Response, next: NextFunction) => {
        pingDb(500)
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
// Prometheus scrape endpoint (text exposition format v0.0.4).
router.get("/metrics", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send(renderProm());
});

export default router;
