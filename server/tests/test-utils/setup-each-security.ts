process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";
import { getApp } from "./app";

/**
 * Per-file setup for the tenant-security sweep.
 *
 * The reset clears EVERY base table rather than a hand-kept list: this suite
 * builds two complete workspaces — users, spaces, lists, statuses, task types,
 * tags, custom fields, templates, tasks, roles — and a list that falls behind
 * what the sweep creates would leave a row from workspace B visible to the
 * next test, which is the precise thing being measured.
 *
 * DELETE, not TRUNCATE. Measured in P2: 509 ms vs 1.9 ms for nine tables, and
 * TRUNCATE holds an exclusive metadata lock that can queue behind any other
 * session on this shared MySQL server — long enough to blow the hook's budget
 * and fail a run whose product code was never involved.
 */
jest.setTimeout(60000);

const resetDb = async (): Promise<void> => {
    const conn = await getPool().getConnection();
    try {
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        const [rows] = (await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [Config.DB_NAME],
        )) as [Array<{ TABLE_NAME: string }>, unknown];
        for (const { TABLE_NAME } of rows) {
            await conn.query(`DELETE FROM \`${TABLE_NAME}\``);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
};

beforeAll(async () => {
    await connectTestDb();
    // Import the app off any test's clock — a cold ts-jest compile of the
    // route tree is ~35 s and would otherwise be charged to whichever test
    // happened to run first (P2, D2.12's neighbour).
    await getApp();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await resetDb();
});
