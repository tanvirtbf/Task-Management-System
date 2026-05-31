import { Config } from "../../src/config";

/**
 * Pin the §29 SLA suite to its dedicated private DB `tms_sla_test` in the test
 * runtime. Listed before `setup-each-sla.ts` so the connection pool targets it.
 */
Config.DB_NAME = "tms_sla_test";
