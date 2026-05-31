process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §22 Engineering-specials suites.
 *
 * Deliberately NO per-test reset (mirrors §11 Membership / §6 Lists). globalSetup
 * provisions a FRESH empty `tms_eng_test` per jest invocation, and every test is
 * id/workspace-scoped — it mints its own workspace + "Bug Triage" list + "Bug"
 * type and asserts only on rows in THAT workspace (or before/after deltas), never
 * on a workspace-GLOBAL absolute count. So a clean slate per test is unnecessary,
 * and skipping the reset dodges the TRUNCATE-all metadata-lock stall a concurrent
 * DROP/CREATE DATABASE session triggers on the shared MySQL server.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS:
 *   node node_modules/jest/bin/jest.js --config jest.eng.config.cjs --runInBand tests/eng/<file>.test.ts
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
