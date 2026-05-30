process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §18 Forms build, on a DEDICATED private DB
 * (`tms_forms_test`) distinct from the concurrent tasks sessions'
 * `tms_tasks_test` / `tms_t10_test`. Sharing a name lets two runs DROP/CREATE
 * the same DB and wipe each other mid-test; a separate name removes the
 * collision (only server-wide MySQL load remains, which slows but never wipes).
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_forms_test";
    await provisionTestDb();
};
