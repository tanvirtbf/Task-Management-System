/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// Isolated runner for the §3 Workspace suite. Identical to jest.config.js except
// it points at a PRIVATE test database (tms_workspace_test) so it can run
// concurrently with other suites without both stomping the shared
// `taskmanagement_test` database. Test-only; not part of the build.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // The first test pays a one-time ts-jest compile of the whole app router
    // graph on the initial `getApp()` import (~13s under concurrent server
    // load); subsequent tests reuse it and run in well under a second. A
    // generous timeout absorbs that cold start without masking real slowness.
    testTimeout: 30000,

    // Only this endpoint's suite.
    testMatch: ["<rootDir>/tests/workspace/**/*.test.ts"],

    // Private DB name (see global-setup-workspace.ts + setup-each-workspace.ts)
    // so concurrent suites that drop/recreate the shared test DB cannot race this
    // run. setup-each-workspace.ts also uses a fixed-list TRUNCATE (no
    // information_schema scan) so the per-test reset stays off the global
    // metadata locks held by concurrent DROP/CREATE DATABASE runs.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-workspace.ts",
    setupFilesAfterEnv: ["<rootDir>/tests/test-utils/setup-each-workspace.ts"],
};
