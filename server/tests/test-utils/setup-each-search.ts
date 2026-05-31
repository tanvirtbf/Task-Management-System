process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §24 Search suite. No per-test TRUNCATE: every test is
 * workspace-scoped (fresh `makeWorkspace()` per test, all queries filter by
 * that workspace id), so a fresh empty DB per run is isolation enough — the
 * whole suite runs in ONE jest process like the §23 Templates suite. The raised
 * timeout absorbs the one-time cold start + busy-MySQL slowness.
 */
jest.setTimeout(60000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
