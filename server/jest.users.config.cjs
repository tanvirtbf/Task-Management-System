/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only this endpoint's suite.
    testMatch: ["<rootDir>/tests/users/**/*.test.ts"],

    // Private DB name (see global-setup-users.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-users.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-users.ts",
        "<rootDir>/tests/test-utils/setup-each-users.ts",
    ],
};
