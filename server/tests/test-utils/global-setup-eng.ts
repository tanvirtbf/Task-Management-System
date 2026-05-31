process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the §22 Engineering-specials build, on a DEDICATED
 * private DB (`tms_eng_test`) distinct from every other suite's DB (the §19/§20/
 * §21/§23 sessions each use their own). Provisions a fresh schema once per jest
 * invocation so concurrent sessions can never DROP/CREATE this DB out from under
 * the run.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_eng_test";
    await provisionTestDb();
};
