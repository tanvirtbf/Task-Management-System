import { Config } from "../../src/config";

/**
 * Pin the §4 Users suite to its private database in the test runtime.
 *
 * Listed in `jest.users.config.cjs` BEFORE `setup-each-users.ts`, so the pool
 * (`connectTestDb` → `initDb`) and the per-test truncation both target this
 * run's isolated DB rather than the contended shared one. See
 * `global-setup-users.ts` for the rationale.
 */
Config.DB_NAME = "taskmanagement_users_test";
