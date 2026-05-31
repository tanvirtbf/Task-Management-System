process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §20 Sprints suite. Uses a PRIVATE DB
 * (`tms_sprints_test`) distinct from other suites' DBs a concurrent session may
 * run — so this run never collides with theirs (both globalSetups DROP/CREATE
 * their own DB and apply database/schema.sql).
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_sprints_test";
    await provisionTestDb();
};
