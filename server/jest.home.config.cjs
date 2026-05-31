/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only the §25 Home suite.
    testMatch: ["<rootDir>/tests/home/**/*.test.ts"],

    // Private DB name (see global-setup-home.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-home.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-home.ts",
        "<rootDir>/tests/test-utils/setup-each-home.ts",
    ],
};
