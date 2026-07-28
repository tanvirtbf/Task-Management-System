process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §14 Comments + §15 Checklists suites. TRUNCATEs the
 * tables these tests touch (FK checks off, so order is irrelevant). DB name is
 * pinned by `db-name-collab.ts` (loaded first in `setupFilesAfterEnv`).
 */
jest.setTimeout(30000);

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles",
    "comments",
    "checklist_items",
    "checklists",
    "task_assignees",
    "task_watchers",
    "task_tags",
    "task_custom_field_values",
    "task_activity",
    "notifications",
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
