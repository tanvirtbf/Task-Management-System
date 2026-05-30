process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §10/§11 Tasks suites.
 *
 * Other endpoints' suites run concurrently (this project is built multi-session)
 * and repeatedly DROP/CREATE the shared test database, which races this run to
 * death. Pointing this run at a private DB removes the contention. `Config` is a
 * plain mutable object, so overriding the name here (and in `db-name-tasks.ts`
 * for the test runtime) is enough — no `src` change, no `.env.test` write.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_tasks_test";
    await provisionTestDb();
};
