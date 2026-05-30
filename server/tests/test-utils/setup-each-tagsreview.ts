process.env.NODE_ENV = "test";

import { Config } from "../../src/config";
import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/** THROWAWAY per-file setup pinned to the private `tms_tagsreview_test` DB. */
Config.DB_NAME = "tms_tagsreview_test";

const TABLES = [
    "sessions",
    "tags",
    "workspace_activity",
    "users",
    "workspaces",
] as const;

const reset = async (): Promise<void> => {
    const conn = await getPool().getConnection();
    try {
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const t of TABLES) {
            await conn.query(`TRUNCATE TABLE \`${t}\``);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
};

jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await reset();
});
