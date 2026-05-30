process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §6 Lists WRITE suites (create / update / archive
 * / unarchive / delete).
 *
 * Like the §7 Statuses suite, these run against a PRIVATE database
 * (`tms_lists_test`) so other endpoints' suites — which repeatedly DROP/CREATE
 * the shared `taskmanagement_*_test` DB and rewrite its name in `.env.test` —
 * cannot race this run to death. `Config` is a plain mutable object, so
 * overriding the name here (and in `db-name-lists.ts` for the test runtime) is
 * enough. The read suites (list-by-space / list-all / get-by-id) keep running
 * under the default config; only the write suites, which need stable side-effect
 * counts, move here.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_lists_test";
    await provisionTestDb();
};
