import { Config } from "../../src/config";

/**
 * Pin the §6 Lists READ suites to their private database in the test runtime.
 *
 * Listed in `jest.listsread.config.cjs` BEFORE `setup-each-listsread.ts`, so the
 * pool (`connectTestDb` → `initDb`) targets this run's isolated DB rather than
 * the contended shared one. See `global-setup-listsread.ts` for the rationale.
 */
Config.DB_NAME = "tms_listsread_test";
