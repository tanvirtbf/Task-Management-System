process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §21 On-call suite. Pins a PRIVATE DB
 * (`tms_oncall_test`) distinct from every other suite's DB, so a concurrent
 * session's run can never DROP/CREATE this one out from under it.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_oncall_test";
    await provisionTestDb();
};
