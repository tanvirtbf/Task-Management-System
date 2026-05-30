process.env.NODE_ENV = "test";

import { connectTestDb, disconnectTestDb } from "./db";

/**
 * Per-file setup for the §8 Task types suite.
 *
 * Deliberately omits the shared `setup-each.ts` per-test `TRUNCATE`-all reset:
 * concurrent endpoint suites flood MySQL with `DROP/CREATE DATABASE` + schema
 * applies, and a truncate-all (DDL) then stalls server-wide on metadata locks —
 * the same `--runInBand` cross-file interaction that forces the §5 Spaces suite
 * to run one file per process. Every task-types test is workspace-scoped (each
 * assertion targets a freshly-minted `makeWorkspace()` and queries filter by
 * that workspace id), so a clean slate per test is unnecessary; `globalSetup`
 * provisions a fresh empty DB per run, which is isolation enough. This lets the
 * whole suite (list/create/update/delete) run in ONE jest process, exactly like
 * the §7 Statuses suite.
 *
 * The raised timeout absorbs transient slowness when the MySQL box is busy.
 */
jest.setTimeout(30000);

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await disconnectTestDb();
});
