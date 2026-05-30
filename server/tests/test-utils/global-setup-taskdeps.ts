process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §12 Task-dependencies suite. Uses a PRIVATE DB
 * (`tms_taskdeps_test`) distinct from the §10/§11 tasks suites' `tms_tasks_test`,
 * which a concurrent session is actively running — so this run never collides
 * with theirs (both globalSetups DROP/CREATE their own DB).
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_taskdeps_test";
    await provisionTestDb();
};
