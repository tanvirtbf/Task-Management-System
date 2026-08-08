/** F10 probe helper — run the session-cleanup job once and print the outcome. */
import { closeDb, initDb } from "../../../server/src/db/client";
import { sessionCleanup } from "../../../server/src/jobs/sessionCleanup";

const main = async () => {
    await initDb();
    const dryRun = process.argv.includes("--dry");
    const outcome = await sessionCleanup({ dryRun } as never);
    process.stdout.write("OUTCOME " + JSON.stringify(outcome) + "\n");
    await closeDb();
};
main()
    .then(() => process.exit(0))
    .catch((e) => {
        process.stdout.write("FAILED " + String(e) + "\n");
        process.exit(1);
    });
