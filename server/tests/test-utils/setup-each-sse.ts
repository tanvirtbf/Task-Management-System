process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb, resetTables } from "./db";

/**
 * Per-file setup for the §27 SSE suite. TRUNCATEs only the tables these tests
 * touch (never all 31) so the reset stays fast and avoids the server-wide
 * metadata-lock stall a TRUNCATE-all triggers under a concurrent session's
 * DROP/CREATE DATABASE. FK checks are disabled around the loop, so order is
 * irrelevant. The DB name is pinned by `db-name-sse.ts` (loaded first).
 *
 * ⚠️ RUN ONE FILE PER JEST PROCESS (cross-file --runInBand caveat).
 */
jest.setTimeout(60000); // first test pays the cold ts-jest compile of the full app graph

const TABLES = [
    // RBAC (P11): assignments/grants/roles are per-workspace rows and must not
    // survive a reset, or a later test inherits another test's authority.
    "user_roles",
    "role_permissions",
    "roles","notifications", "sessions", "users", "workspaces"];

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    // KI-29 (§P13): DELETE + an AUTO_INCREMENT reset where the counter moved,
    // instead of TRUNCATE. Same observable state, 11× cheaper — see
    // `resetTables` in ./db for the measurement and why the counter still
    // has to be reset.
    await resetTables(TABLES);
});
