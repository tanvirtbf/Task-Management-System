process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb, resetTestDb } from "./db";

/**
 * Per-file setup for the §6 Lists READ suites.
 *
 * Unlike its WRITE sibling (`setup-each-lists.ts`, which skips the reset because
 * those suites are id-scoped), these three assert WORKSPACE-WIDE truths — "every
 * list in the workspace", `total_estimate`, "no activity rows" — so a row left
 * behind by the previous test changes the answer. They keep the shared
 * truncate-per-test reset.
 *
 * The private DB from `global-setup-listsread.ts` is what makes that safe to do
 * concurrently: a TRUNCATE-all is DDL, and on the SHARED database it stalls
 * server-wide on metadata locks whenever another suite is DROP/CREATE-ing. On a
 * database only this run touches, it is cheap.
 *
 * Timeout is 60s, double the usual private-DB suite. 30s was not enough: the
 * first full-gate run had this module green only on RETRY. It carries a cost the
 * others do not — a truncate-all before EVERY test, on a database that was
 * created seconds earlier, in files that seed 250 rows to exercise pagination —
 * and it pays that on top of the usual cold-start bill (ts-jest transform, first
 * bcrypt hash, first pool connect). A module that needs a retry to be green is a
 * module nobody trusts, so the timeout matches the work instead.
 */
jest.setTimeout(60000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});

beforeEach(async () => {
    await resetTestDb();
});
