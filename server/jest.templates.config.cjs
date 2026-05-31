/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only the §23 Templates suite.
    testMatch: ["<rootDir>/tests/templates/**/*.test.ts"],

    // Private DB name (see global-setup-templates.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-templates.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-templates.ts",
        "<rootDir>/tests/test-utils/setup-each-templates.ts",
    ],
};
