process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §27 SSE suite. Uses a PRIVATE DB
 * (`tms_sse_test`) so it never collides with the suites a concurrent session may
 * run (both globalSetups DROP/CREATE their own DB and apply database/schema.sql).
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_sse_test";
    await provisionTestDb();
};
