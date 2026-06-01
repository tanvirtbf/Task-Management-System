process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the AI Help Assistant suite — points this run at a
 * private DB so concurrent suites that DROP/CREATE the shared test DB cannot
 * race it. Mirrors the §24 Search private-config pattern.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_assistant_test";
    await provisionTestDb();
};
