process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §23 Templates suite.
 *
 * Deliberately omits the shared `setup-each.ts` per-test `TRUNCATE`-all reset:
 * every templates test is workspace-scoped (each assertion targets a freshly
 * minted `makeWorkspace()` / `setup()` and every query filters by that
 * workspace id), so a clean slate per test is unnecessary; `globalSetup`
 * provisions a fresh empty DB per run, which is isolation enough. This lets the
 * whole suite run in ONE jest process, exactly like the §8 Task types suite.
 *
 * The raised timeout absorbs the one-time cold start (lazy `app` import + pool
 * init + first bcrypt) on the first test, plus transient slowness when the
 * MySQL box is busy with other suites' DROP/CREATE DATABASE churn.
 */
jest.setTimeout(60000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
