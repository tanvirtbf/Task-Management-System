import { Config } from "../../src/config";

/**
 * Pin the Dynamic RBAC suite to its private database in the test runtime.
 *
 * Listed in `jest.rbac.config.cjs` BEFORE `setup-each-rbac.ts`, so the pool
 * (`connectTestDb` → `initDb`) and the per-test reset both target this run's
 * isolated DB rather than a contended shared one.
 */
Config.DB_NAME = "tms_rbac_test";
