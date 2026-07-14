import express from "express";
import { JobsController } from "../controllers/JobsController";
import internalAuth from "../middlewares/internalAuth";

const router = express.Router();

// ─── DI wiring ───────────────────────────────────────────────────────────────
const controller = new JobsController();

// §28 Background jobs — all POST, all guarded by `internalAuth` (the
// `X-Internal-Token` header matching `Config.INTERNAL_JOB_TOKEN`), all support
// `?dry_run=true`. Each route binds one job slug to the `runJob` dispatcher,
// which owns the try/catch + the `{ ok, dry_run, ... }` envelope — so a job
// failure returns `200 { ok:false, error }` (cron branches on it) rather than a
// 500. `internalAuth` is the SOLE guard (jobs have no `req.auth`).
router.post("/session-cleanup", internalAuth, controller.run("session-cleanup"));
router.post(
    "/attachment-janitor",
    internalAuth,
    controller.run("attachment-janitor"),
);
router.post("/r2-purge", internalAuth, controller.run("r2-purge"));
router.post("/snooze-wake", internalAuth, controller.run("snooze-wake"));
router.post(
    "/form-submission-expiry",
    internalAuth,
    controller.run("form-submission-expiry"),
);
// recurrence-spawn, email-digest, and sla-breach-scan routes are registered
// here as each job is built.

export default router;
