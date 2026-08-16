import logger from "../config/logger";
import { assignmentRequestExpiry } from "./assignmentRequestExpiry";
import { attachmentJanitor } from "./attachmentJanitor";
import { departmentReport } from "./departmentReport";
import { overdueAlert } from "./overdueAlert";
import { r2Purge } from "./r2Purge";
import { recurrenceSpawn } from "./recurrenceSpawn";
import { sessionCleanup } from "./sessionCleanup";
import { snoozeWake } from "./snoozeWake";
import { formSubmissionExpiry } from "./formSubmissionExpiry";
import type { JobContext, JobRunResult } from "./types";

/**
 * Registry of §28 background jobs, keyed by their URL slug (`/api/v1/jobs/<slug>`
 * and `npm run job <slug>`). Add a job here + a route in `routes/jobs.ts` as it
 * is built.
 */
const JOBS = {
    "session-cleanup": sessionCleanup,
    "attachment-janitor": attachmentJanitor,
    "r2-purge": r2Purge,
    "snooze-wake": snoozeWake,
    "form-submission-expiry": formSubmissionExpiry,
    "department-report": departmentReport,
    "overdue-alert": overdueAlert,
    "assignment-request-expiry": assignmentRequestExpiry,
    // upgrades/024 — creates the next occurrence of a recurring task.
    "recurrence-spawn": recurrenceSpawn,
} as const;

export type JobName = keyof typeof JOBS;

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

export const isJobName = (s: string): s is JobName =>
    Object.prototype.hasOwnProperty.call(JOBS, s);

/**
 * Run a §28 background job by name under the uniform contract: it NEVER throws
 * to the caller — a failure is caught, logged, and returned as
 * `{ ok:false, error }` so cron/k8s can branch and the process never crashes
 * (§28 note: "Failures should not crash the process"). Success returns
 * `{ ok:true, dry_run, ...jobCounts }`. The same dispatcher backs both the HTTP
 * endpoints and the `src/bin/run-job.ts` CLI runner, so they share one code
 * path. Assumes `initDb()` has already run (the server boot / the runner do it).
 */
export const runJob = async (
    name: JobName,
    ctx: JobContext & { requestId?: string },
): Promise<JobRunResult> => {
    const { dryRun, requestId } = ctx;
    try {
        const outcome = await JOBS[name]({ dryRun });
        logger.info(`job.${name}.ok`, { requestId, dryRun, ...outcome });
        return { ok: true, dry_run: dryRun, ...outcome };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`job.${name}.fail`, {
            requestId,
            dryRun,
            error: message,
            stack: err instanceof Error ? err.stack : undefined,
        });
        return { ok: false, dry_run: dryRun, error: message };
    }
};
