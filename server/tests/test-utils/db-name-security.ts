import { Config } from "../../src/config";

/**
 * Pin the tenant-security sweep to its private database.
 *
 * Listed in `jest.security.config.cjs` BEFORE `setup-each-security.ts`, so
 * both the pool and the per-test reset target this run's own DB. The sweep
 * builds two entire workspaces and then wipes everything between tests, which
 * is exactly the kind of suite that must never share a database with another.
 */
Config.DB_NAME = "tms_security_test";
