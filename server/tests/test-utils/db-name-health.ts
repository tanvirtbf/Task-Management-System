import { Config } from "../../src/config";

/**
 * Pin the §30 Health suite to its private database in the test runtime. Listed
 * in `jest.health.config.cjs` BEFORE `setup-each-health.ts`, so the pool (which
 * `/health/ready` pings) targets this run's isolated DB.
 */
Config.DB_NAME = "tms_health_test";
