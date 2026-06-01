/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only the AI Help Assistant suite.
    testMatch: ["<rootDir>/tests/assistant/**/*.test.ts"],

    // Private DB name (see global-setup-assistant.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-assistant.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-assistant.ts",
        "<rootDir>/tests/test-utils/setup-each-assistant.ts",
    ],
};
