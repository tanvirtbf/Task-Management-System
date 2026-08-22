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
 *
 * ASSIGNED_BY_PLAN P3 (2026-08-22): 30s → 60s here AND in all 13 files of this
 * suite (they each declare their own, which would otherwise win). Three
 * separate phases each lost a run to the same failure — `assignees.add` (I-1),
 * `forms/public-submit` (I-2) and `get-by-id` (I-3) — every time the FIRST test
 * of a file, every time a timeout rather than a wrong answer, every time a test
 * that takes 1.5–5s once warm. 30s simply does not cover this machine's cold
 * start on top of a test's own work. Fixing it per-file was losing to the next
 * file, so the whole suite moves at once, to the value 8 other setup-each files
 * already use.
 */
jest.setTimeout(60000);

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
