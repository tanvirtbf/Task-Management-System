/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    collectCoverage: false,
    coverageProvider: "v8",
    collectCoverageFrom: ["src/**/*.ts", "!tests/**", "!**/node_modules/**"],

    // Where tests live.
    testMatch: ["<rootDir>/tests/**/*.test.ts"],

    // Run once before any test file — provisions a fresh test DB.
    globalSetup: "<rootDir>/tests/test-utils/global-setup.ts",

    // Run before each test file (inside the test runtime) — connects to the
    // DB, truncates between tests, and disconnects at the end.
    setupFilesAfterEnv: ["<rootDir>/tests/test-utils/setup-each.ts"],
};
