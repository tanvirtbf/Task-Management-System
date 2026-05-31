process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §25 Home suite. No per-test TRUNCATE: every test is
 * workspace-scoped (fresh `makeWorkspace()` per test), so a fresh empty DB per
 * run is isolation enough — the whole suite runs in ONE jest process. The
 * raised timeout absorbs the one-time cold start + busy-MySQL slowness.
 */
jest.setTimeout(60000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
