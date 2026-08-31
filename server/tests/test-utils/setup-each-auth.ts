process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";
import { getPool } from "../../src/db/client";
import { getApp } from "./app";

/**
 * Per-file setup for the §2 Authentication suite. Mirrors the isolated-suite
 * pattern (see `setup-each-users.ts`): the private DB is pinned by
 * `db-name-auth.ts` and the timeout is raised to absorb transient slowness when
 * the shared MySQL box is busy with other suites' `DROP/CREATE DATABASE` work.
 *
 * It clears ONLY the tables the auth flows write — never all 31 — so the
 * reset stays fast, and it clears them with DELETE rather than TRUNCATE, which
 * is what keeps it fast AND unable to stall (see the `beforeEach` below: 509 ms
 * vs 1.9 ms, and no exclusive metadata lock). The set covers every table any
 * §2 endpoint touches: workspaces ← users ← {sessions, password_reset_tokens},
 * invitations (workspace + invited_by), and workspace_activity (written by the
 * invitation-accept flow). Listed child-first for readability; FK checks are
 * disabled during the reset so order is not load-bearing.
 */
jest.setTimeout(30000);

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles",
    "workspace_activity",
    "invitations",
    "password_reset_tokens",
    "sessions",
    "users",
    "workspaces",
];

beforeAll(async () => {
    await connectTestDb();

    // Import the app HERE, before any test's clock starts.
    //
    // The first `getApp()` in a jest worker compiles the entire route tree —
    // every controller, service and repository — through ts-jest, which takes
    // roughly 35 seconds cold. Whichever test triggers it therefore spends most
    // of the 30-second budget on a compile it did not ask for, and fails on a
    // timeout that has nothing to do with what it was testing. WHICH test that
    // is depends on file ordering, so the flake moves around: P2 saw it land on
    // `me.test.ts`'s first assertion, and P0 recorded the same shape in three
    // other modules.
    //
    // `getApp()` memoises, so this costs one import for the whole run and every
    // test after it measures only itself.
    await getApp();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    const conn = await getPool().getConnection();
    try {
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const table of TABLES) {
            // DELETE, not TRUNCATE. Measured on this machine, resetting these
            // nine tables costs a median of 509 ms by TRUNCATE and 1.9 ms by
            // DELETE — 268× — because TRUNCATE is DDL: InnoDB drops and
            // recreates each tablespace file and takes an exclusive metadata
            // lock while it does. Across this module's 432 tests that was about
            // 220 seconds of the run spent on the reset alone, and the lock is
            // what made it fragile: a TRUNCATE queued behind another session on
            // this shared MySQL server can hold the hook past its 30-second
            // budget, which failed a run whose product code was perfectly fine.
            //
            // Nothing here depends on what TRUNCATE does differently. None of
            // these nine tables has an AUTO_INCREMENT column (checked, not
            // assumed — ids are application-generated strings), no test holds a
            // transaction across the hook, and reclaiming disk space is not a
            // concern for a few dozen rows.
            //
            // The other 30 setup files still TRUNCATE, some of 25 tables. That
            // is the larger part of the gate's runtime and is measured and
            // routed to P13; it is not changed here because a phase should not
            // quietly alter the isolation semantics of modules it is not
            // testing.
            await conn.query(`DELETE FROM \`${table}\``);
        }
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        conn.release();
    }
});
