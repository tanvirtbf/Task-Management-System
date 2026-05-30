import { Config } from "../../src/config";

/**
 * Pin the §16 Attachments suite to its private database in the test runtime,
 * listed BEFORE `setup-each-attachments.ts` so the pool targets the isolated DB.
 */
Config.DB_NAME = "tms_attachments_test";
