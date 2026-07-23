process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the Dept Review V1 suite (DEPARTMENT_REVIEW_PLAN.md
 * rule 8). Same pattern as `global-setup-spaces.ts`: pin a PRIVATE database
 * name before provisioning so concurrent per-module suites (which drop/create
 * their own `*_test` DBs) can never race this run. `provisionTestDb()` builds
 * the DB fresh from `database/schema.sql` — the operative schema source — so
 * the suite always tests the current DDL (incl. task_reviews /
 * department_reports / spaces.head_user_id).
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_deptreview_test";
    await provisionTestDb();
};
