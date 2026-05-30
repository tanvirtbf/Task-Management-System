process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §18 Forms suites.
 *
 * Truncates between tests (resets AUTO_INCREMENT on form_submissions.internal_id
 * + tasks.internal_id, clears the forms.submission_count trigger counter, and
 * resets workspace-global side-effect rows). It truncates ONLY the tables these
 * suites touch — never all of them — so the reset stays fast and avoids the
 * server-wide metadata-lock stall a TRUNCATE-all triggers under a concurrent
 * session's DROP/CREATE DATABASE. FK checks are disabled around the loop, so
 * truncation order is irrelevant.
 */
jest.setTimeout(30000);

const TABLES = [
    "form_submissions",
    "form_fields",
    "forms",
    "task_assignees",
    "task_watchers",
    "task_tags",
    "task_custom_field_values",
    "task_activity",
    "tasks",
    "custom_field_options",
    "custom_fields",
    "statuses",
    "lists",
    "spaces",
    "task_types",
    "tags",
    "sprints",
    "notifications",
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
