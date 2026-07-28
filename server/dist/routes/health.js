"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const client_1 = require("../db/client");
const metrics_1 = require("../observability/metrics");
/**
 * §30 Health & diagnostics — unauthenticated probes for k8s / load balancers /
 * monitoring. Mounted at the APP root (NOT under `/api/v1`), so the v1
 * `apiLimiter` never applies. Liveness (`GET /health`) stays inline in `app.ts`
 * (per the spec, already done); this router adds the other three.
 */
const router = express_1.default.Router();
// Read once at module load. From src/routes (and dist/routes) `../../package.json`
// resolves to the server package manifest.
const VERSION = (() => {
    try {
        const raw = (0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, "../../package.json"), "utf8");
        const parsed = JSON.parse(raw);
        return parsed.version ?? "unknown";
    }
    catch {
        return "unknown";
    }
})();
/**
 * Timeout-bounded DB liveness ping (§30 #2). MUST resolve within `timeoutMs` so
 * an unhealthy DB cannot hold the readiness probe open (k8s would never roll the
 * pod). The ping runs to completion in the background even if the timeout wins,
 * releasing its connection in `finally`, so no connection leaks.
 */
const pingDb = async (timeoutMs) => {
    const ping = (async () => {
        const conn = await (0, client_1.getPool)().getConnection();
        try {
            await conn.ping();
        }
        finally {
            conn.release();
        }
    })();
    const timeout = new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("readiness check timed out")), timeoutMs).unref();
    });
    try {
        await Promise.race([ping, timeout]);
        return true;
    }
    catch {
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
router.get("/health/ready", (_req, res, next) => {
    pingDb(500)
        .then((dbOk) => {
        if (dbOk) {
            res.status(200).json({
                status: "ready",
                checks: { database: "ok" },
            });
        }
        else {
            res.status(503).json({
                status: "not_ready",
                checks: { database: "down" },
            });
        }
    })
        .catch(next);
});
// ─── GET /health/version ─────────────────────────────────────────────────────
// Build SHA (set at build time via GIT_SHA) + package version + uptime. Nothing
// sensitive is exposed.
router.get("/health/version", (_req, res) => {
    res.status(200).json({
        version: VERSION,
        git_sha: process.env.GIT_SHA ?? "unknown",
        uptime_seconds: Math.floor(process.uptime()),
        node: process.version,
    });
});
// ─── GET /metrics ────────────────────────────────────────────────────────────
// Prometheus scrape endpoint (text exposition format v0.0.4).
router.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send((0, metrics_1.renderProm)());
});
exports.default = router;
