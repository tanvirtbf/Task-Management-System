process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";
import { Config } from "../../src/config";

/**
 * Per-file setup for the Dept Review V1 suite. Mirrors `setup-each-spaces.ts`:
 *
 * 1. Clean-slate reset before EVERY test — dept-review tests assert
 *    workspace-global counts (queue/summary/report tallies), so each test must
 *    start empty. The reset is DYNAMIC (information_schema-driven), so the
 *    feature's new tables (task_reviews, department_reports) are covered
 *    automatically.
 *
 * 2. The reset uses DELETE, not TRUNCATE — TRUNCATE takes an EXCLUSIVE MDL and
 *    can stall for minutes when another suite's jest process concurrently
 *    DROP/CREATEs its own `*_test` DB (documented contention gotcha).
 *    AUTO_INCREMENT is not reset; tests must assert counts/ids, never absolute
 *    `internal_id` values.
 *
 * ⚠️ Historical caveat (inherited from the spaces kit): batching many test
 * files into ONE jest process once produced later-file failures with empty
 * error bodies. That symptom matched the since-fixed service file-casing bug;
 * whole-config runs currently pass. If it ever resurfaces, fall back to one
 * file per process:
 *   npx jest --config jest.deptreview.config.cjs --runInBand tests/dept-review/<file>.test.ts
 */
jest.setTimeout(30000);

/** Clear every base table with DELETE + FK checks off (see note 2 above). */
const resetDeptReviewDb = async (): Promise<void> => {
    const pool = getPool();
    const conn = await pool.getConnection();
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
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await resetDeptReviewDb();
});
