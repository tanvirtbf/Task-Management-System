import { Config } from "../../src/config";

/**
 * Pin the Dept Review V1 suite to its private database in the test runtime.
 *
 * Listed in `jest.deptreview.config.cjs` BEFORE `setup-each-deptreview.ts`, so
 * the pool (`connectTestDb` → `initDb`) and the per-test reset both target this
 * run's isolated DB rather than a contended shared one. See
 * `global-setup-deptreview.ts` for the rationale.
 */
Config.DB_NAME = "tms_deptreview_test";
