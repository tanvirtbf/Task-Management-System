/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Schema parity (TEST PLAN KI-12): Drizzle's tables vs the database the
    // canonical SQL actually builds.
    testMatch: ["<rootDir>/tests/schema/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-schema.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-schema.ts",
        "<rootDir>/tests/test-utils/setup-each-schema.ts",
    ],
};
