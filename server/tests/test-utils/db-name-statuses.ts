import { Config } from "../../src/config";

/**
 * Pin the §7 Statuses suite to its private database in the test runtime.
 *
 * Listed in `jest.statuses.config.cjs` BEFORE `setup-each.ts`, so the pool
 * (`connectTestDb` → `initDb`) and the per-test truncation both target this
 * run's isolated DB rather than the contended shared one. See
 * `global-setup-statuses.ts` for the rationale.
 */
Config.DB_NAME = "tms_statuses_test";
