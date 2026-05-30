import { Config } from "../../src/config";

/**
 * Pin the §17 Custom Fields suite to its private database in the test runtime.
 * Listed in jest.customfields.config.cjs BEFORE setup-each-customfields.ts so
 * the pool targets the isolated tms_customfields_test.
 */
Config.DB_NAME = "tms_customfields_test";
