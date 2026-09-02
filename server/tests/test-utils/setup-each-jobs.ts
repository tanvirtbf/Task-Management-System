process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";
import { Config } from "../../src/config";

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

/**
 * P5: this used to be a hand-written list of "the tables the seven jobs touch",
 * and a hand-written list is a list that goes stale in silence. The eighth job
 * (`assignment-request-expiry`) writes `task_assignment_requests`, which was not
 * on it — and because the reset runs with `FOREIGN_KEY_CHECKS = 0`, the
 * `ON DELETE CASCADE` from `tasks` does NOT fire to cover the omission. Rows
 * survived every reset and the second test in the file hit the
 * `uq_tar_one_pending` unique index on a request the first test had left behind.
 *
 * So the list is now derived from `information_schema`, the way the RBAC suite
 * has always done it: a new table is covered the day it is created, and nobody
 * has to remember. The one exception is named rather than assumed.
 */
const KEEP = new Set([
    // The 56-permission catalog is seeded by the schema install, not by tests,
    // and `role_permissions → permissions` is RESTRICT: deleting it would break
    // every grant a test makes, to protect nothing a test wrote.
    "permissions",
]);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    const conn = await getPool().getConnection();
    try {
        const [rows] = (await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [Config.DB_NAME],
        )) as [Array<{ TABLE_NAME: string }>, unknown];

        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const { TABLE_NAME } of rows) {
            if (KEEP.has(TABLE_NAME)) continue;
            await conn.query(`DELETE FROM \`${TABLE_NAME}\``);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
});
