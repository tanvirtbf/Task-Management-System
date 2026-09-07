process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { connectTestDb, disconnectTestDb, resetTables } from "./db";

/** THROWAWAY per-file setup pinned to the private `tms_tagsreview_test` DB. */
Config.DB_NAME = "tms_tagsreview_test";

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles",
    "sessions",
    "tags",
    "workspace_activity",
    "users",
    "workspaces",
] as const;

const reset = async (): Promise<void> => {
    // KI-29 (§P13): DELETE, plus TRUNCATE only where an AFTER DELETE
    // trigger makes it necessary, and an AUTO_INCREMENT reset where the
    // counter moved. Same observable state, far less DDL — see
    // `resetTables` in ./db for the measurement.
    await resetTables(TABLES);
};

jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await reset();
});
