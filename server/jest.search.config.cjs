/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only the §24 Search suite.
    testMatch: ["<rootDir>/tests/search/**/*.test.ts"],

    // Private DB name (see global-setup-search.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-search.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-search.ts",
        "<rootDir>/tests/test-utils/setup-each-search.ts",
    ],
};
