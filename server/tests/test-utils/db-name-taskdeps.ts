import { Config } from "../../src/config";

/**
 * Pin the §12 Task-dependencies suite to its private database in the test
 * runtime. Listed in `jest.taskdeps.config.cjs` BEFORE `setup-each-taskdeps.ts`,
 * so the pool (`connectTestDb` → `initDb`) targets this run's isolated DB rather
 * than the contended `tms_tasks_test`. See `global-setup-taskdeps.ts`.
 */
Config.DB_NAME = "tms_taskdeps_test";
