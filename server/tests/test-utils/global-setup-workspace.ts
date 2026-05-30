process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §3 Workspace suite.
 *
 * Other endpoints' suites run concurrently and repeatedly DROP/CREATE the
 * shared test database (whose name they also rewrite in `.env.test`), which
 * races this run to death. Pointing this run at a private DB name removes the
 * contention entirely. `Config` is a plain mutable object read at call-time by
 * `provisionTestDb` / `initDb`, so overriding the property here (and in
 * `db-name-workspace.ts` for the test runtime) is enough — no shared file or
 * `src` change required.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_workspace_test";
    await provisionTestDb();
};
