/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only the §26 Workspace-activity suite.
    testMatch: ["<rootDir>/tests/workspace-activity/**/*.test.ts"],

    // Private DB name (see global-setup-workspace-activity.ts) so concurrent
    // suites that drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-workspace-activity.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-workspace-activity.ts",
        "<rootDir>/tests/test-utils/setup-each-workspace-activity.ts",
    ],
};
