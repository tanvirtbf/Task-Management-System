process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";

/**
 * Per-file setup for the §4 Users suite. Mirrors the isolated-suite pattern
 * (see `setup-each-statuses.ts`): the private DB is pinned by `db-name-users.ts`
 * and the timeout is raised to absorb transient slowness when the shared MySQL
 * box is busy with other suites' `DROP/CREATE DATABASE` work.
 *
 * Unlike the statuses suite, this one DOES reset between tests: its pagination
 * fixtures reuse fixed primary ids (`u-000`…) that would collide on re-insert
 * without a wipe. It truncates ONLY the tables this suite writes — never all 31
 * — so the reset stays fast and avoids the server-wide metadata-lock stall that
 * a TRUNCATE-all triggers under concurrent load.
 *
 * The list MUST cover every table any §4 endpoint writes, or rows leak across
 * tests and make them order-dependent: `invitations` (POST /users/invite) and
 * `password_reset_tokens` (POST /users/:id/reset-password) are easy to forget
 * because the invite/reset suites reuse a fixed email per test — without a wipe
 * those rows accumulate and break count/identity assertions. FK checks are
 * disabled around the loop, so truncation order is irrelevant.
 */
jest.setTimeout(30000);

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles",
    "sessions",
    "password_reset_tokens",
    "invitations",
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
