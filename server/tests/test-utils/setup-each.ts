process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb, resetTestDb } from "./db";

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await resetTestDb();
});
