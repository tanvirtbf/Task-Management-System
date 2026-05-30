process.env.NODE_ENV = "test";

import {
    applyTestDbName,
    connectTestDb,
    disconnectTestDb,
    resetTestDb,
} from "./db";

// Pin the per-invocation DB name before any connection is opened in this
// worker, so it matches what global-setup provisioned (see resolveTestDbName).
applyTestDbName();

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await resetTestDb();
});
