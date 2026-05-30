process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

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
const TABLES = ["sessions", "users", "workspaces"] as const;

const resetWorkspaceTables = async (): Promise<void> => {
    const conn = await getPool().getConnection();
    try {
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const table of TABLES) {
            await conn.query(`TRUNCATE TABLE \`${table}\``);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
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
