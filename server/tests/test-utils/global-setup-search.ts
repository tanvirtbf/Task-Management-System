process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §24 Search suite — points this run at a private
 * DB so concurrent suites that DROP/CREATE the shared test DB cannot race it.
 * Mirrors the §23 Templates / §8 Task types private-config pattern.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_search_test";
    await provisionTestDb();
};
