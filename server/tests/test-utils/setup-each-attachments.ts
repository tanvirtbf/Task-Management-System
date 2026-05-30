process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §16 Attachments suite.
 *
 * No per-test TRUNCATE: every test mints a fresh `makeWorkspace()` + `makeTask()`
 * and every assertion (attachments rows, `tasks.attachments_count` deltas) is
 * scoped to that task/workspace, so a clean slate per test is unnecessary —
 * `globalSetup` provisions a fresh empty DB per run, which is isolation enough.
 * This lets the whole suite run in ONE jest process (no cross-file TRUNCATE
 * contention), exactly like the §7 Statuses suite. `attachments` has no
 * AUTO_INCREMENT column, so there is nothing a truncate would need to reset.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
