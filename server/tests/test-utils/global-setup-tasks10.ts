process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §10 Tasks build, on a DEDICATED private DB
 * (`tms_t10_test`) distinct from `tms_tasks_test`. A concurrent session is
 * building the §11/§13 tasks endpoints and runs `jest.tasks.config.cjs`
 * (DB `tms_tasks_test`); sharing that name made the two runs DROP/CREATE the
 * same DB and wipe each other mid-test. A separate name removes the collision
 * (only server-wide MySQL load remains, which slows but never wipes).
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_t10_test";
    await provisionTestDb();
};
