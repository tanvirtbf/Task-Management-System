process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §11 Task-Membership suite.
 *
 * Deliberately NO per-test reset. `globalSetup` (global-setup-membership.ts)
 * provisions a FRESH empty `tms_membership_test` at the start of each jest
 * invocation, and every membership test is id-scoped — it mints its own
 * workspace / user / task and asserts only on THAT task (task_assignees /
 * task_watchers / task_tags / task_activity filtered by the fresh task id) or on
 * before/after notification-count DELTAS, never on a workspace-GLOBAL absolute
 * count. So a clean slate per test is unnecessary.
 *
 * Skipping the reset also dodges the documented contention hazard: a
 * TRUNCATE/DELETE-all-tables `beforeEach` serializes on the InnoDB
 * data-dictionary and STALLS for tens of seconds (observed a trivial test
 * taking ~30s → hook timeout → empty-message mass-fail) whenever a concurrent
 * session is driving heavy DROP/CREATE DATABASE load on the same MySQL server.
 * The no-reset, id-scoped pattern (mirrors the §6 Lists write suite) is both
 * ~10x faster and immune to that stall.
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS (cross-file --runInBand caveat):
 *   node node_modules/jest/bin/jest.js --config jest.membership.config.cjs --runInBand tests/membership/<file>.test.ts
 *
 * db-name-membership.ts (listed first) has already pinned Config.DB_NAME to the
 * isolated tms_membership_test. The raised timeout absorbs bcrypt cold-cache +
 * transient slowness when the MySQL box is busy.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
