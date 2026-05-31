process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §29 SLA suites.
 *
 * Deliberately NO per-test reset (mirrors §22 Engineering / §11 Membership).
 * globalSetup provisions a FRESH empty `tms_sla_test` per jest invocation, and
 * every test is id/workspace-scoped — it mints its own workspace and asserts
 * only on rows in THAT workspace (or before/after deltas), never on a
 * workspace-GLOBAL absolute count. So skipping the reset dodges the TRUNCATE-all
 * metadata-lock stall a concurrent DROP/CREATE DATABASE session triggers.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS:
 *   node node_modules/jest/bin/jest.js --config jest.sla.config.cjs --runInBand tests/sla/<file>.test.ts
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
