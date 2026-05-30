import { Config } from "../../src/config";

/**
 * Pin the §10/§11 Tasks suites to their private database in the test runtime.
 *
 * Listed in `jest.tasks.config.cjs` BEFORE `setup-each-tasks.ts`, so the pool
 * (`connectTestDb` → `initDb`) AND the per-test truncation both target this
 * run's isolated DB rather than the contended shared one.
 */
Config.DB_NAME = "tms_tasks_test";
