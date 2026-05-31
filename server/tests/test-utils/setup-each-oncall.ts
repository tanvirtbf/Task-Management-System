process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §21 On-call suite.
 *
 * Deliberately NO per-test reset. `globalSetup` provisions a FRESH empty
 * `tms_oncall_test` once per jest invocation, and every test is id-scoped — it
 * mints its OWN workspace/engineer/shift (so the `uq_on_call_shifts_week` unique
 * key never collides across tests) and asserts only on those ids. `on_call_shifts`
 * has a STRING PK, so there is no AUTO_INCREMENT to reset. Skipping the reset
 * also dodges the documented contention hazard — a TRUNCATE-all `beforeEach`
 * stalls for tens of seconds on the InnoDB data-dictionary under a concurrent
 * session's DROP/CREATE DATABASE. (Mirrors the §11 membership / §17 custom-fields
 * suites.)
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS. Use the absolute nvm node path:
 *   "C:/nvm4w/nodejs/node.exe" node_modules/jest/bin/jest.js --config jest.oncall.config.cjs --runInBand tests/on-call/<file>.test.ts
 */
// 60s (not the usual 30s): the FIRST test pays a cold start — ts-jest compiles
// the whole app import graph (every mounted router) on first `getApp()` — which
// can exceed 30s when concurrent sessions are compiling + driving MySQL DDL at
// the same time. Steady-state tests run in well under a second.
jest.setTimeout(60000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
