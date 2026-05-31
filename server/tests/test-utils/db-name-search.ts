import { Config } from "../../src/config";

/**
 * Pin the §24 Search suite to its private database in the test runtime.
 * Listed in `jest.search.config.cjs` BEFORE `setup-each-search.ts`, so the pool
 * targets this run's isolated DB rather than the contended shared one.
 */
Config.DB_NAME = "tms_search_test";
