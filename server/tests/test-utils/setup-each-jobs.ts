process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §28 Background-jobs suite.
 *
 * Unlike the read/resource suites (which are id-scoped and skip the reset), §28
 * jobs are GLOBAL — they scan/mutate every workspace's rows and their results
 * are COUNTS (e.g. `deleted: 3`). So each test needs a clean slate for
 * deterministic count assertions. We DELETE (not TRUNCATE) the tables the seven
 * jobs touch: DELETE takes only a shared metadata lock, so it stays responsive
 * even when a concurrent session is driving heavy DROP/CREATE DATABASE DDL —
 * the documented TRUNCATE-all metadata-lock stall. FK checks are disabled around
 * the loop so delete order is irrelevant.
 *
 * 60s first-test timeout: ts-jest cold-compiles the whole app import graph
 * (every mounted router) on the first `getApp()` under concurrent compile load.
 */
jest.setTimeout(60000);

const TABLES = [
    "notifications",
    "attachments",
    "task_assignees",
    "task_watchers",
    "task_tags",
    "task_custom_field_values",
    "task_activity",
    "tasks",
    "on_call_shifts",
    "sessions",
    "password_reset_tokens",
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
            await conn.query(`DELETE FROM \`${table}\``);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
});
