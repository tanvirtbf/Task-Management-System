process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { connectTestDb, disconnectTestDb, resetTables } from "./db";

// Must match the private database provisioned in global-setup-workspace.ts. Set
// at module load — this file runs before its own beforeAll hook, so `initDb()`
// (called by connectTestDb) connects to the private DB, not the shared one.
Config.DB_NAME = "tms_workspace_test";

// The workspace suite only ever writes these three tables (workspaces ← users ←
// sessions, via the makeWorkspace / makeUser / makeLoggedInClient factories).
// Truncating just them — rather than all tables via the shared `resetTestDb`,
// which runs an `information_schema.TABLES` scan — keeps the per-test reset fast
// and off the global metadata locks that concurrent DROP/CREATE DATABASE test
// runs hold. FK checks are disabled so truncation order does not matter.
const TABLES = [
    "sessions",
    "user_roles",
    "role_permissions",
    "roles",
    "workspace_activity",
    "users",
    "workspaces",
] as const;

const resetWorkspaceTables = async (): Promise<void> => {
    // KI-29 (§P13): DELETE, plus TRUNCATE only where an AFTER DELETE
    // trigger makes it necessary, and an AUTO_INCREMENT reset where the
    // counter moved. Same observable state, far less DDL — see
    // `resetTables` in ./db for the measurement.
    await resetTables(TABLES);
};

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await resetWorkspaceTables();
});
