process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §17 Custom Fields suite.
 *
 * Deliberately NO per-test reset. `globalSetup` provisions a FRESH empty
 * tms_customfields_test once per jest invocation, and every test is id-scoped
 * (mints its own workspace/user/field/task and asserts only on those ids or on
 * count deltas), so a clean slate per test is unnecessary. Skipping the reset
 * also dodges the documented contention hazard — a DELETE/TRUNCATE-all
 * `beforeEach` stalls for tens of seconds on the InnoDB data-dictionary when a
 * concurrent session drives heavy DROP/CREATE DATABASE load. (Mirrors the §11
 * membership suite.)
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS (cross-file --runInBand caveat). Use the
 * absolute nvm node path to avoid the bare-`node` 127 race under concurrent nvm
 * churn:
 *   "C:/nvm4w/nodejs/node.exe" node_modules/jest/bin/jest.js --config jest.customfields.config.cjs --runInBand tests/custom-fields/<file>.test.ts
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
