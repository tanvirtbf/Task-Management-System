/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only the §19 Notifications suite.
    testMatch: ["<rootDir>/tests/notifications/**/*.test.ts"],

    // Private DB name (see global-setup-notifications.ts) so concurrent suites
    // that drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-notifications.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-notifications.ts",
        "<rootDir>/tests/test-utils/setup-each-notifications.ts",
    ],
};
