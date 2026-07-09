/**
 * Shared types for §28 background jobs.
 *
 * Each job is a pure async function `(ctx: JobContext) => Promise<JobOutcome>`
 * registered in `jobs/index.ts`. The `runJob` dispatcher wraps the outcome in
 * the uniform `JobRunResult` envelope (adding `ok` + `dry_run`, catching errors
 * into `{ ok:false, error }`) so the HTTP layer and the CLI runner share one
 * contract and a failing job never crashes the process.
 */

export interface JobContext {
    /** When true, run the same read/scan path but skip every write. */
    dryRun: boolean;
}

/**
 * A job's own result: always a `processed` count, plus job-specific counters
 * (e.g. `deleted` / `wouldDelete`, or a nested `byType` breakdown).
 */
export type JobOutcome = { processed: number } & Record<
    string,
    number | Record<string, number>
>;

/**
 * Uniform envelope returned by `runJob` and every `/jobs/*` endpoint. On
 * success it spreads the job's `JobOutcome`; on failure it carries `error`.
 */
export interface JobRunResult {
    ok: boolean;
    dry_run: boolean;
    error?: string;
    [key: string]: unknown;
}
