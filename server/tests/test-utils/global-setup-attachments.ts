process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §16 Attachments suite — points this run at a
 * private DB so concurrently-running suites can't DROP/CREATE it out from under
 * us. Mirrors the §7 Statuses / §8 Task-types private-config pattern.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_attachments_test";
    await provisionTestDb();
};
