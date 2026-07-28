process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";
import { Config } from "../../src/config";

/**
 * Per-file setup for the Dynamic RBAC suite. Mirrors `setup-each-deptreview.ts`:
 *
 * 1. Clean-slate reset before EVERY test — RBAC tests assert absolute counts
 *    (56 catalog rows, 4 system roles, grants per role), so each test must
 *    start from empty. The reset is DYNAMIC (information_schema-driven), so the
 *    four RBAC tables are covered automatically.
 *
 * 2. The reset uses DELETE, not TRUNCATE — TRUNCATE takes an EXCLUSIVE MDL and
 *    can stall for minutes when another suite's jest process concurrently
 *    DROP/CREATEs its own `*_test` DB (documented contention gotcha).
 *
 * NOTE: the catalog (`permissions`) is deliberately wiped too. Any test that
 * needs it calls `syncPermissionCatalog` / `bootstrapRbac` itself — the
 * `role_permissions → permissions` FK is RESTRICT, so a test that forgets will
 * fail loudly rather than silently granting a non-existent key.
 */
jest.setTimeout(30000);

/** Clear every base table with DELETE + FK checks off (see note 2 above). */
const resetRbacDb = async (): Promise<void> => {
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
    await resetRbacDb();
});
