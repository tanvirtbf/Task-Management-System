process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §26 Workspace-activity suite.
 *
 * Deliberately OMITS a per-test `TRUNCATE`-all reset: under concurrent suites a
 * truncate-all (DDL) stalls server-wide on metadata locks (documented for the §5
 * Spaces / §8 Task-types suites, and observed flaking the §19 Notifications run).
 * Every test mints a fresh workspace + user and all reads are workspace-scoped,
 * and activity rows use unique (fakeId) ids, so accumulated rows never collide or
 * leak into a fresh workspace's feed — `globalSetup`'s fresh DB is isolation
 * enough.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
