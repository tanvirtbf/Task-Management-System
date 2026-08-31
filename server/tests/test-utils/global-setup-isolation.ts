process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Global setup for the tenant-isolation sweep (TEST PLAN P3).
 *
 * A private database, built fresh from `database/schema.sql`, for the same
 * reason every other module has one: concurrent suites drop and recreate
 * their own `*_test` DBs, and a run that loses its tables mid-flight reports
 * dozens of failures that have nothing to do with the product.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_isolation_test";
    await provisionTestDb();
};
