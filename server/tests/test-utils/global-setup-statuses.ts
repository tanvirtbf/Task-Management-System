process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §7 Statuses suite.
 *
 * Other endpoints' suites run concurrently and repeatedly DROP/CREATE the
 * shared `taskmanagement_*_test` database (whose name they also rewrite in
 * `.env.test`), which races this run to death. Pointing this run at a private
 * DB name removes the contention entirely. `Config` is a plain mutable object,
 * so overriding the property here (and in `db-name-statuses.ts` for the test
 * runtime) is enough — no shared file or `src` change required.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_statuses_test";
    await provisionTestDb();
};
