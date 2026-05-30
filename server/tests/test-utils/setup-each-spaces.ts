process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";
import { Config } from "../../src/config";

/**
 * Per-file setup for the §5 Spaces suite.
 *
 * Two deliberate choices:
 *
 * 1. The suite KEEPS a clean-slate reset before every test: several spaces
 *    tests assert workspace-GLOBAL counts (e.g. `create.test.ts` "writes no
 *    space or activity row when forbidden" expects zero `workspace_activity`
 *    rows across the whole DB), so each test must start empty.
 *
 * 2. The reset uses DELETE, not TRUNCATE. TRUNCATE needs an EXCLUSIVE metadata
 *    lock and serialises on the InnoDB data-dictionary, so it can STALL for
 *    minutes (observed: a ~28-minute hook hang) whenever another suite's jest
 *    process is concurrently DROP/CREATE-ing its own `*_test` database — the
 *    documented test-DB contention gotcha. DELETE takes only a shared MDL per
 *    table, so it stays responsive under that contention. AUTO_INCREMENT is not
 *    reset, which the spaces tests don't rely on (they assert row counts, not
 *    specific `internal_id`s). FK checks are disabled so delete order is free.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS. There is a pre-existing cross-file
 * interaction in this repo's `--runInBand` harness: when several test files run
 * in a single jest process, only the FIRST file passes and every later file's
 * tests fail with empty error messages. Each spaces file passes cleanly in its
 * own process, e.g.:
 *   npx jest --config jest.spaces.config.cjs --runInBand tests/spaces/create.test.ts
 *
 * `db-name-spaces.ts` (listed first in the config) has already pinned
 * `Config.DB_NAME` to the isolated `tms_spaces_test`, so the connection + reset
 * target that DB. The raised timeout absorbs bcrypt's cold-cache cost.
 */
jest.setTimeout(30000);

/** Clear every base table with DELETE + FK checks off (see note 2 above). */
const resetSpacesDb = async (): Promise<void> => {
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
    await resetSpacesDb();
});
