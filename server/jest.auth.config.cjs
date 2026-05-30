/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only this endpoint group's suite.
    testMatch: ["<rootDir>/tests/auth/**/*.test.ts"],

    // Private DB name (see global-setup-auth.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-auth.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-auth.ts",
        "<rootDir>/tests/test-utils/setup-each-auth.ts",
    ],
};
