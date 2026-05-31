process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §26 Workspace-activity suite. Points this run at
 * a private DB name so other suites' DROP/CREATE of their own test DBs can't
 * race it. Mirrors the §8 Task-types / §19 Notifications private-config pattern.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_workspace_activity_test";
    await provisionTestDb();
};
