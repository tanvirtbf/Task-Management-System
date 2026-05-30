process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §17 Custom Fields suite. Pins a PRIVATE DB name
 * (separate from the §10 Tasks suite's tms_tasks_test, which a concurrent
 * session drives) so neither run can DROP/CREATE the other's database.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_customfields_test";
    await provisionTestDb();
};
