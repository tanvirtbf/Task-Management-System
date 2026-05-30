import { Config } from "../../src/config";

/**
 * Pin the §6 Lists write suites to their private database in the test runtime.
 *
 * Listed in `jest.lists.config.cjs` BEFORE `setup-each-lists.ts`, so the pool
 * (`connectTestDb` → `initDb`) targets this run's isolated DB rather than the
 * contended shared one. See `global-setup-lists.ts` for the rationale.
 */
Config.DB_NAME = "tms_lists_test";
