import { Config } from "../../src/config";

/**
 * Pin the §25 Home suite to its private database in the test runtime.
 * Listed in `jest.home.config.cjs` BEFORE `setup-each-home.ts`, so the pool
 * targets this run's isolated DB rather than the contended shared one.
 */
Config.DB_NAME = "tms_home_test";
