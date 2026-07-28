"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const JobsController_1 = require("../controllers/JobsController");
const internalAuth_1 = __importDefault(require("../middlewares/internalAuth"));
const router = express_1.default.Router();
// ─── DI wiring ───────────────────────────────────────────────────────────────
const controller = new JobsController_1.JobsController();
// §28 Background jobs — all POST, all guarded by `internalAuth` (the
// `X-Internal-Token` header matching `Config.INTERNAL_JOB_TOKEN`), all support
// `?dry_run=true`. Each route binds one job slug to the `runJob` dispatcher,
// which owns the try/catch + the `{ ok, dry_run, ... }` envelope — so a job
// failure returns `200 { ok:false, error }` (cron branches on it) rather than a
// 500. `internalAuth` is the SOLE guard (jobs have no `req.auth`).
router.post("/session-cleanup", internalAuth_1.default, controller.run("session-cleanup"));
router.post("/attachment-janitor", internalAuth_1.default, controller.run("attachment-janitor"));
router.post("/r2-purge", internalAuth_1.default, controller.run("r2-purge"));
router.post("/snooze-wake", internalAuth_1.default, controller.run("snooze-wake"));
// Dept Review V1 — weekly HR reports (registry AND route together; the
// form-submission-expiry route omission is not repeated here).
router.post("/department-report", internalAuth_1.default, controller.run("department-report"));
// Gap-scan M2: this job was registered but never routed — the 90-day
// encrypted-PII purge could not run under the documented curl-cron setup.
router.post("/form-submission-expiry", internalAuth_1.default, controller.run("form-submission-expiry"));
// recurrence-spawn, email-digest, and sla-breach-scan routes are registered
// here as each job is built.
exports.default = router;
