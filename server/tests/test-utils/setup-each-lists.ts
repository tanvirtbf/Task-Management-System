process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §6 Lists WRITE suites.
 *
 * Deliberately omits the shared `setup-each.ts` per-test `TRUNCATE`-all reset:
 * a truncate-all is DDL, and when other endpoint suites are concurrently
 * DROP/CREATE-ing databases it stalls server-wide on metadata locks (the cause
 * of the 5s-hook timeouts we saw). These suites are instead written to be
 * id-scoped — every test mints a fresh workspace/space/list and asserts side
 * effects scoped to those ids — so a clean slate per test is unnecessary;
 * `globalSetup` provisions a fresh empty DB once per run, which is isolation
 * enough. The raised timeout absorbs transient slowness when MySQL is busy.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
