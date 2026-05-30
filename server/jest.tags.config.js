/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// Isolated runner for the §9 tags suite. Identical to jest.config.js except it
// points at a PRIVATE test database (taskmanagement_tags_test) so it can run
// concurrently with another process's suite without both stomping the shared
// `taskmanagement_test` database. Test-only; not part of the build.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testMatch: ["<rootDir>/tests/tags/**/*.test.ts"],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-tags.ts",
    setupFilesAfterEnv: ["<rootDir>/tests/test-utils/setup-each-tags.ts"],
};
