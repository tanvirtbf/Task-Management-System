/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only this endpoint family's suite.
    testMatch: ["<rootDir>/tests/task-types/**/*.test.ts"],

    // Private DB name (see global-setup-task-types.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-task-types.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-task-types.ts",
        "<rootDir>/tests/test-utils/setup-each-task-types.ts",
    ],
};
