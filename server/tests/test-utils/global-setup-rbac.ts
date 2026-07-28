process.env.NODE_ENV = "test";
import { Config } from "../../src/config";
import { provisionTestDb } from "./db";

/**
 * Isolated global-setup for the Dynamic RBAC suite (RBAC_DYNAMIC_PLAN.md).
 * Same pattern as `global-setup-deptreview.ts`: pin a PRIVATE database name
 * before provisioning so concurrent per-module suites (which drop/create their
 * own `*_test` DBs) can never race this run. `provisionTestDb()` builds the DB
 * fresh from `database/schema.sql`, so the suite always tests the current DDL —
 * including §38-41 (permissions / roles / role_permissions / user_roles) and
 * `workspaces.permissions_version`.
 */
export default async (): Promise<void> => {
    Config.DB_NAME = "tms_rbac_test";
    await provisionTestDb();
};
