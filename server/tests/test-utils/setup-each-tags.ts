process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

// Must match the private database provisioned in global-setup-tags.ts. Set at
// module load — this file runs before its own beforeAll hook, so `initDb()`
// (called by connectTestDb) connects to the private DB, not the shared one.
Config.DB_NAME = "taskmanagement_tags_test";

// The tags suite only ever writes these four tables (workspaces ← users ←
// sessions, plus tags). Truncating just them — rather than all 31 like the
// shared `resetTestDb` — keeps the per-test reset fast and avoids piling
// metadata-lock work onto a MySQL server that may be under load from another
// test process. FK checks are disabled so truncation order does not matter.
const TABLES = ["sessions", "tags", "users", "workspaces"] as const;

const resetTagsTables = async (): Promise<void> => {
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
    await resetTagsTables();
});
