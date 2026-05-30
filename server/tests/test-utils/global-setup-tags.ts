process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * One-time setup for the isolated tags suite. Redirects `Config.DB_NAME` to a
 * PRIVATE database before provisioning so this run never collides with another
 * jest process operating on the shared `taskmanagement_test` DB. `Config` is a
 * plain mutable object read at call-time by `provisionTestDb` / `initDb`, so
 * this reassignment is all that is needed — no shared file is touched.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "taskmanagement_tags_test";
    await provisionTestDb();
};
