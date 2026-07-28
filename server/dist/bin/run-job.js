"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../db/client");
const logger_1 = __importDefault(require("../config/logger"));
const jobs_1 = require("../jobs");
/**
 * Local-dev CLI runner for §28 background jobs:
 *   npm run job <job-name> [-- --dry-run]
 * e.g. `npm run job session-cleanup` or `npm run job session-cleanup -- --dry-run`.
 *
 * Calls the SAME `runJob` dispatcher the HTTP endpoints use (no server, no
 * token needed locally). `initDb()` runs first so the jobs' `getDb()` resolves.
 * Exits non-zero when the job reports `{ ok:false }` so cron/CI can detect it.
 */
const run = async () => {
    const name = process.argv[2];
    const dryRun = process.argv.includes("--dry-run");
    if (!name || !(0, jobs_1.isJobName)(name)) {
        logger_1.default.error(`Usage: npm run job <${jobs_1.JOB_NAMES.join("|")}> [-- --dry-run]`);
        process.exit(1);
    }
    await (0, client_1.initDb)();
    logger_1.default.info("job.runner.start", { name, dryRun });
    const result = await (0, jobs_1.runJob)(name, { dryRun });
    logger_1.default.info("job.runner.done", { name, ...result });
    await (0, client_1.closeDb)();
    process.exit(result.ok ? 0 : 1);
};
void run();
