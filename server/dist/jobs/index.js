"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runJob = exports.isJobName = exports.JOB_NAMES = void 0;
const logger_1 = __importDefault(require("../config/logger"));
const attachmentJanitor_1 = require("./attachmentJanitor");
const departmentReport_1 = require("./departmentReport");
const overdueAlert_1 = require("./overdueAlert");
const r2Purge_1 = require("./r2Purge");
const sessionCleanup_1 = require("./sessionCleanup");
const snoozeWake_1 = require("./snoozeWake");
const formSubmissionExpiry_1 = require("./formSubmissionExpiry");
/**
 * Registry of §28 background jobs, keyed by their URL slug (`/api/v1/jobs/<slug>`
 * and `npm run job <slug>`). Add a job here + a route in `routes/jobs.ts` as it
 * is built.
 */
const JOBS = {
    "session-cleanup": sessionCleanup_1.sessionCleanup,
    "attachment-janitor": attachmentJanitor_1.attachmentJanitor,
    "r2-purge": r2Purge_1.r2Purge,
    "snooze-wake": snoozeWake_1.snoozeWake,
    "form-submission-expiry": formSubmissionExpiry_1.formSubmissionExpiry,
    "department-report": departmentReport_1.departmentReport,
    "overdue-alert": overdueAlert_1.overdueAlert,
};
exports.JOB_NAMES = Object.keys(JOBS);
const isJobName = (s) => Object.prototype.hasOwnProperty.call(JOBS, s);
exports.isJobName = isJobName;
/**
 * Run a §28 background job by name under the uniform contract: it NEVER throws
 * to the caller — a failure is caught, logged, and returned as
 * `{ ok:false, error }` so cron/k8s can branch and the process never crashes
 * (§28 note: "Failures should not crash the process"). Success returns
 * `{ ok:true, dry_run, ...jobCounts }`. The same dispatcher backs both the HTTP
 * endpoints and the `src/bin/run-job.ts` CLI runner, so they share one code
 * path. Assumes `initDb()` has already run (the server boot / the runner do it).
 */
const runJob = async (name, ctx) => {
    const { dryRun, requestId } = ctx;
    try {
        const outcome = await JOBS[name]({ dryRun });
        logger_1.default.info(`job.${name}.ok`, { requestId, dryRun, ...outcome });
        return { ok: true, dry_run: dryRun, ...outcome };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.default.error(`job.${name}.fail`, {
            requestId,
            dryRun,
            error: message,
            stack: err instanceof Error ? err.stack : undefined,
        });
        return { ok: false, dry_run: dryRun, error: message };
    }
};
exports.runJob = runJob;
