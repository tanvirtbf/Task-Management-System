process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §20 Sprints suite. TRUNCATEs only the tables these
 * tests touch (never all 31) so the reset stays fast and avoids the server-wide
 * metadata-lock stall a TRUNCATE-all triggers under a concurrent session's
 * DROP/CREATE DATABASE. FK checks are disabled around the loop, so truncation
 * order is irrelevant. The DB name is pinned by `db-name-sprints.ts` (loaded
 * first in `setupFilesAfterEnv`).
 *
 * A per-test reset (rather than the id-scoped no-reset style) is deliberate:
 * `GET /sprints` and `GET /sprints/active` assert on workspace-GLOBAL result
 * sets (the single active sprint, the full sprint list), so a stale row from a
 * prior test would corrupt those assertions.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS (cross-file --runInBand caveat).
 */
// 60s (not 30s): the first test pays a one-time ts-jest compile of the whole
// app import graph (now spanning every built §) plus DB pool warmup, which can
// exceed 30s under a concurrent session's MySQL load.
jest.setTimeout(60000);

const TABLES = [
    "task_activity",
    "tasks",
    "sprints",
    "statuses",
    "lists",
    "spaces",
    "task_types",
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
