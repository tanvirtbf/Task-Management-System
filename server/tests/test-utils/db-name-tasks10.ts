import { Config } from "../../src/config";

/**
 * Pin the §10 Tasks build to its dedicated private DB `tms_t10_test` in the test
 * runtime (distinct from the §11/§13 session's `tms_tasks_test`). Listed before
 * `setup-each-tasks.ts` so the pool and the per-test truncation both target it.
 */
Config.DB_NAME = "tms_t10_test";
