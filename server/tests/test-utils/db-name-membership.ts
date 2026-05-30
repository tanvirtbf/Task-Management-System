import { Config } from "../../src/config";

/**
 * Pin the §11 Task-Membership suite to its private database in the test
 * runtime. Listed in jest.membership.config.cjs BEFORE setup-each-membership.ts
 * so the pool + per-test reset both target the isolated tms_membership_test.
 */
Config.DB_NAME = "tms_membership_test";
