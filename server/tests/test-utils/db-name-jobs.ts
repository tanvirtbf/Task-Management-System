import { Config } from "../../src/config";

/**
 * Pin the §28 Background-jobs suite to its private database in the test runtime.
 * Listed in `jest.jobs.config.cjs` BEFORE `setup-each-jobs.ts`, so the pool
 * (`connectTestDb` → `initDb`) targets this run's isolated DB. See
 * `global-setup-jobs.ts`.
 */
Config.DB_NAME = "tms_jobs_test";
