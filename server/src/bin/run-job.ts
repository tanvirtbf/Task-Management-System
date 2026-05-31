import { initDb, closeDb } from "../db/client";
import logger from "../config/logger";
import { JOB_NAMES, isJobName, runJob } from "../jobs";

/**
 * Local-dev CLI runner for §28 background jobs:
 *   npm run job <job-name> [-- --dry-run]
 * e.g. `npm run job session-cleanup` or `npm run job session-cleanup -- --dry-run`.
 *
 * Calls the SAME `runJob` dispatcher the HTTP endpoints use (no server, no
 * token needed locally). `initDb()` runs first so the jobs' `getDb()` resolves.
 * Exits non-zero when the job reports `{ ok:false }` so cron/CI can detect it.
 */
const run = async (): Promise<void> => {
    const name = process.argv[2];
    const dryRun = process.argv.includes("--dry-run");

    if (!name || !isJobName(name)) {
        logger.error(
            `Usage: npm run job <${JOB_NAMES.join("|")}> [-- --dry-run]`,
        );
        process.exit(1);
    }

    await initDb();
    logger.info("job.runner.start", { name, dryRun });

    const result = await runJob(name, { dryRun });
    logger.info("job.runner.done", { name, ...result });

    await closeDb();
    process.exit(result.ok ? 0 : 1);
};

void run();
