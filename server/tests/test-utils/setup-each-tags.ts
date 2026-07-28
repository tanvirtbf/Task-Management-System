process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

// Must match the private database provisioned in global-setup-tags.ts. Set at
// module load — this file runs before its own beforeAll hook, so `initDb()`
// (called by connectTestDb) connects to the private DB, not the shared one.
Config.DB_NAME = "taskmanagement_tags_test";

// The tags suite writes these tables: workspaces ← users ← sessions, plus tags,
// and (since the §9 write endpoints landed) one `workspace_activity` row per
// create/update/delete. Truncating just this set — rather than all 31 like the
// shared `resetTestDb` — keeps the per-test reset fast and avoids piling
// metadata-lock work onto a MySQL server that may be under load from another
// test process. `workspace_activity` is included so the read suite's global
// "no activity rows" assertion stays valid even when a write suite ran first in
// the same invocation. (The DELETE-cascade test also creates `tasks`/`task_tags`
// rows; those are asserted by specific id, so they need no per-test reset.) FK
// checks are disabled so truncation order does not matter.
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

// The tags suite sets no per-file timeout, so the default 5s applies — too tight
// for a cold first test (ts-jest transform + first bcrypt hash + first pool
// connect can take ~7-8s) and for the write suites' factory-heavy / concurrent
// cases. Raise it here so it covers every tags test file at once, matching the
// spaces/users/statuses sibling suites (which all set 30000 in their setup-each).
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await resetTagsTables();
});
