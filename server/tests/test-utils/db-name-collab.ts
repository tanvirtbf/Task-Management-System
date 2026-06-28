import { Config } from "../../src/config";

/**
 * Pin the §14 Comments + §15 Checklists suites to their private DB in the test
 * runtime. Listed in `jest.collab.config.cjs` BEFORE `setup-each-collab.ts`.
 */
Config.DB_NAME = "tms_collab_test";
