"use strict";
/**
 * Shared types for §28 background jobs.
 *
 * Each job is a pure async function `(ctx: JobContext) => Promise<JobOutcome>`
 * registered in `jobs/index.ts`. The `runJob` dispatcher wraps the outcome in
 * the uniform `JobRunResult` envelope (adding `ok` + `dry_run`, catching errors
 * into `{ ok:false, error }`) so the HTTP layer and the CLI runner share one
 * contract and a failing job never crashes the process.
 */
Object.defineProperty(exports, "__esModule", { value: true });
