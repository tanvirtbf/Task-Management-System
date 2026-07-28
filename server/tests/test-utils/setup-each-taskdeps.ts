process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §12 Task-dependencies suite. TRUNCATEs only the tables
 * these tests touch (never all 31) so the reset stays fast and avoids the
 * server-wide metadata-lock stall a TRUNCATE-all triggers under a concurrent
 * session's DROP/CREATE DATABASE. FK checks are disabled around the loop, so
 * truncation order is irrelevant. The DB name is pinned by `db-name-taskdeps.ts`
 * (loaded first in `setupFilesAfterEnv`).
 */
jest.setTimeout(30000);

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles",
    "task_dependencies",
    "task_assignees",
    "task_watchers",
    "task_tags",
    "task_custom_field_values",
    "task_activity",
    "tasks",
    "custom_fields",
    "statuses",
    "lists",
    "spaces",
    "task_types",
    "tags",
    "sessions",
    "users",
    "workspace_activity",
    "workspaces",
];

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
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
});
