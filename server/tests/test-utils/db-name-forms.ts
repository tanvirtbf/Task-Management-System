import { Config } from "../../src/config";

/**
 * Pin the §18 Forms build to its dedicated private DB `tms_forms_test` in the
 * test runtime. Listed before `setup-each-forms.ts` so the pool and the per-test
 * truncation both target it.
 */
Config.DB_NAME = "tms_forms_test";
