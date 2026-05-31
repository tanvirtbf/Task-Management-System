import { Config } from "../../src/config";

/**
 * Pin the §21 On-call suite to its private database in the test runtime. Listed
 * in `jest.oncall.config.cjs` BEFORE `setup-each-oncall.ts`, so the pool
 * (`connectTestDb` → `initDb`) targets this run's isolated DB rather than any
 * contended shared DB. See `global-setup-oncall.ts`.
 */
Config.DB_NAME = "tms_oncall_test";
