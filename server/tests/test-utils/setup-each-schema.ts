process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the schema-parity suite. No per-test reset: this suite
 * reads `information_schema` and writes nothing, so truncating between tests
 * would cost DDL time to prove nothing.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
