import { Config } from "../../src/config";

/**
 * Pin the §20 Sprints suite to its private database in the test runtime. Listed
 * in `jest.sprints.config.cjs` BEFORE `setup-each-sprints.ts`, so the pool
 * (`connectTestDb` → `initDb`) targets this run's isolated DB. See
 * `global-setup-sprints.ts`.
 */
Config.DB_NAME = "tms_sprints_test";
