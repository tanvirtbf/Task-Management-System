process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §30 Health suite. Connects the pool so `/health/ready`
 * can ping it; no per-test truncate is needed (these probes read process / pool
 * state, never table data).
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
