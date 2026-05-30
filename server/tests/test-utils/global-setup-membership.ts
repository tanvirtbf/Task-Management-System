process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §11 Task-Membership suite. Pins a PRIVATE DB
 * name (separate from the §10 Tasks suite's tms_tasks_test, which a concurrent
 * session drives) so neither run can DROP/CREATE the other's database. See
 * global-setup-spaces.ts for the rationale.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_membership_test";
    await provisionTestDb();
};
