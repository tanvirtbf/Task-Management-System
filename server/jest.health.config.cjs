/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only the §30 Health & diagnostics suite.
    testMatch: ["<rootDir>/tests/health/**/*.test.ts"],

    // Private DB name (see global-setup-health.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-health.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-health.ts",
        "<rootDir>/tests/test-utils/setup-each-health.ts",
    ],
};
