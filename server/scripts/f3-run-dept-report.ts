/**
 * F3 helper — run the weekly department-report job once, on demand.
 *
 * The demo baseline includes the 12 generated reports, so a re-seed has to be
 * followed by this. `tsx -e` swallowed the job's return value, hence a real file.
 */
import { closeDb, initDb } from "../src/db/client";
import { departmentReport } from "../src/jobs/departmentReport";

const main = async () => {
    // The job assumes a pool already exists — server boot and the cron runner
    // both call this first, so a standalone invocation has to as well.
    await initDb();
    const outcome = await departmentReport({ dryRun: false } as never);
    await closeDb();
    process.stdout.write(
        "JOB_OUTCOME " + JSON.stringify(outcome) + "\n",
    );
};

main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
        process.stdout.write(
            "JOB_FAILED " +
                (err instanceof Error ? err.stack ?? err.message : String(err)) +
                "\n",
        );
        process.exit(1);
    });
