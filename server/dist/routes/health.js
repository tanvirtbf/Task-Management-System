"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const client_1 = require("../db/client");
const buildInfo_1 = require("../config/buildInfo");
const mail_1 = require("../config/mail");
const storage_1 = require("../config/storage");
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
/**
 * What object storage is doing, in the same vocabulary as the DB check.
 *
 *   ok            — real R2 credentials; uploads are stored.
 *   stub          — the deterministic no-network transport. Correct in dev and
 *                   test; it is what `storageMode()` refuses to allow anywhere
 *                   it would mean silently discarding files (KI-19).
 *   unconfigured  — no credentials where fakes are not acceptable. Uploads and
 *                   downloads answer 503; everything else works.
 */
const storageCheck = () => {
    const mode = (0, storage_1.storageMode)();
    if (mode === "live")
        return "ok";
    return mode === "stub" ? "stub" : "unconfigured";
};
/**
 * The same question for outbound email, which fails the same way: without SMTP
 * credentials `MailService` drops every message and used to say so only at
 * debug. `log_only` is the deliberate dev/test transport; `unconfigured` means
 * messages are being DROPPED and each drop is now logged as an error.
 */
const mailCheck = () => {
    const mode = (0, mail_1.mailMode)();
    if (mode === "live")
        return "ok";
    return mode === "log_only" ? "log_only" : "unconfigured";
};
// ─── GET /health/ready ───────────────────────────────────────────────────────
// Readiness — the process can serve traffic only if its dependencies are
// reachable. Pings the DB within 500ms; Redis is not integrated yet (it would be
// pinged here too once it is). 200 when ready, 503 otherwise.
//
// P8 (KI-19): storage and mail are REPORTED but do not decide readiness, on
// purpose. A readiness probe answers "should traffic come here?", and a box
// with no object storage still serves every task, list, comment and report —
// everything except attachments. Failing readiness would pull it out of the
// load balancer and turn a broken upload button into a total outage, which is a
// worse incident than the one it would be signalling. The loud failure belongs
// where a person meets it: the upload itself answers 503 storage.unavailable,
// and a dropped email is logged as an error rather than at debug.
//
// The DB is different, and is the one thing that DOES decide: without it the
// process can serve nothing at all.
router.get("/health/ready", (_req, res, next) => {
    pingDb(500)
        .then((dbOk) => {
        const checks = {
            database: dbOk ? "ok" : "down",
            storage: storageCheck(),
            mail: mailCheck(),
        };
        res.status(dbOk ? 200 : 503).json({
            status: dbOk ? "ready" : "not_ready",
            checks,
        });
    })
        .catch(next);
});
// ─── GET /health/version ─────────────────────────────────────────────────────
// Build SHA + package version + uptime. Nothing sensitive is exposed.
//
// KI-26: this answered "unknown" on every box, because `GIT_SHA` was the only
// source and nothing in the deploy set it. `gitSha()` falls back to reading the
// checkout, which is what a deploy of this product is.
router.get("/health/version", (_req, res) => {
    res.status(200).json({
        version: VERSION,
        git_sha: (0, buildInfo_1.gitSha)(),
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
