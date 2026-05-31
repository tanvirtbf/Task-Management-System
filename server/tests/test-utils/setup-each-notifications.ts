process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §19 Notifications suite.
 *
 * Deliberately OMITS a per-test `TRUNCATE`-all reset: under concurrent suites a
 * truncate-all (DDL) stalls server-wide on metadata locks (the same interaction
 * documented for the §5 Spaces / §8 Task-types suites, which also skip it).
 * Every test mints a fresh `makeWorkspace()` + `makeUser()` and ALL notification
 * queries are user-scoped, so a clean slate per test is unnecessary —
 * `globalSetup` provisions a fresh empty DB per run, which is isolation enough.
 * Tests use unique (fakeId) notification ids so accumulated rows never collide.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
