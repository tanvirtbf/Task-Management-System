import { Config } from "../../src/config";

/**
 * Pin the §22 Engineering suite to its dedicated private DB `tms_eng_test` in
 * the test runtime. Listed before `setup-each-eng.ts` so the connection pool
 * targets it.
 */
Config.DB_NAME = "tms_eng_test";
