process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the AI Help Assistant suite. No per-test TRUNCATE: every
 * test makes a fresh user (so the user-scoped conversation queries are isolated
 * without a reset), like the §24 Search suite. The raised timeout absorbs the
 * one-time cold start + busy-MySQL slowness.
 */
jest.setTimeout(60000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
