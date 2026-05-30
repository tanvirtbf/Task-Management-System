process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §2 Authentication suite. Mirrors the isolated-suite
 * pattern (see `setup-each-users.ts`): the private DB is pinned by
 * `db-name-auth.ts` and the timeout is raised to absorb transient slowness when
 * the shared MySQL box is busy with other suites' `DROP/CREATE DATABASE` work.
 *
 * It truncates ONLY the tables the auth flows write — never all 31 — so the
 * reset stays fast and avoids the server-wide metadata-lock stall that a
 * TRUNCATE-all triggers under concurrent load. The set covers every table any
 * §2 endpoint touches: workspaces ← users ← {sessions, password_reset_tokens},
 * invitations (workspace + invited_by), and workspace_activity (written by the
 * invitation-accept flow). Listed child-first for readability; FK checks are
 * disabled during truncation so order is not load-bearing.
 */
jest.setTimeout(30000);

const TABLES = [
    "workspace_activity",
    "invitations",
    "password_reset_tokens",
    "sessions",
    "users",
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
