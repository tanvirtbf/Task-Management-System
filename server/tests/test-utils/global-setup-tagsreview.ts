process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * THROWAWAY isolated global-setup — private DB `tms_tagsreview_test` used by the
 * adversarial-review confirmation run so it cannot collide with the concurrent
 * `taskmanagement_tags_test` / `tms_tagsx_test` sessions. Safe to delete after.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_tagsreview_test";
    await provisionTestDb();
};
