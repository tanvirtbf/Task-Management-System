import { Config } from "../../src/config";

/**
 * Pin the §2 Authentication suite to its private database in the test runtime.
 *
 * Listed in `jest.auth.config.cjs` BEFORE `setup-each-auth.ts`, so the pool
 * (`connectTestDb` → `initDb`) and the per-test truncation both target this
 * run's isolated DB rather than the contended shared one. See
 * `global-setup-auth.ts` for the rationale.
 */
Config.DB_NAME = "taskmanagement_auth_test";
