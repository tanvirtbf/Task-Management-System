import { Config } from "../../src/config";

/**
 * Pin the tenant-isolation sweep to its private database.
 *
 * Listed in `jest.isolation.config.cjs` BEFORE `setup-each-isolation.ts`, so
 * both the pool and the per-test reset target this run's own DB. The sweep
 * builds two entire workspaces and then wipes everything between tests, which
 * is exactly the kind of suite that must never share a database with another.
 */
Config.DB_NAME = "tms_isolation_test";
