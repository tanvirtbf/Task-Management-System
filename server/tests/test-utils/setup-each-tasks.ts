process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §10/§11 Tasks suites.
 *
 * DOES reset between tests via TRUNCATE: `list-by-list.test.ts` relies on
 * `tasks.internal_id` AUTO_INCREMENT restarting at 1 each test (keyset /
 * pagination order) — only TRUNCATE resets AUTO_INCREMENT, DELETE does not — and
 * several suites assert workspace-global side-effect counts (`task_activity`,
 * `notifications`). It truncates ONLY the tables these suites touch — never all
 * 31 — so the reset stays fast and avoids the server-wide metadata-lock stall a
 * TRUNCATE-all triggers under a concurrent session's DROP/CREATE DATABASE. FK
 * checks are disabled around the loop, so truncation order is irrelevant.
 */
jest.setTimeout(30000);

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles",
    "task_assignees",
    "task_watchers",
    "task_tags",
    "task_dependencies",
    "task_custom_field_values",
    "task_activity",
    "comments",
    "notifications",
    "tasks",
    "custom_fields",
    "statuses",
    "lists",
    "spaces",
    "task_types",
    "tags",
    "sprints",
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
