process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §7 Statuses suite.
 *
 * Deliberately omits the shared `setup-each.ts` per-test `TRUNCATE`-all reset:
 * concurrent endpoint suites flood MySQL with `DROP/CREATE DATABASE` + schema
 * applies, and a truncate-all (DDL) then stalls server-wide on metadata locks.
 * This suite's tests are id-scoped — every assertion targets a freshly-created
 * `listId`/workspace, and side-effect checks are before/after deltas — so a
 * clean slate per test is unnecessary. `globalSetup` provisions a fresh empty
 * DB at the start of each run, which is isolation enough.
 *
 * The raised timeout absorbs transient slowness when the MySQL box is busy.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
