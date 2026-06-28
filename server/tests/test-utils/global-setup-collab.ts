process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * One-time setup for the §14 Comments + §15 Checklists suites (new Layer C
 * coverage). Private DB `tms_collab_test` so it never collides with other suites.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_collab_test";
    await provisionTestDb();
};
