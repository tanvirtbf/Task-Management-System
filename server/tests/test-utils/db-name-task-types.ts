import { Config } from "../../src/config";

/**
 * Pin the §8 Task types suite to its private database in the test runtime.
 *
 * Listed in `jest.taskTypes.config.cjs` BEFORE `setup-each-task-types.ts`, so
 * the pool (`connectTestDb` → `initDb`) targets this run's isolated DB rather
 * than the contended shared one. See `global-setup-task-types.ts` for rationale.
 */
Config.DB_NAME = "tms_task_types_test";
