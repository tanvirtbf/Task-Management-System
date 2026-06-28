/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// §14 Comments + §15 Checklists suites on a PRIVATE DB (tms_collab_test). These
// two endpoint groups shipped WITHOUT any backend tests; this config drives the
// new coverage added during the Layer C deep-test. Test-only; not in the build.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testTimeout: 30000,
    testMatch: [
        "<rootDir>/tests/comments/**/*.test.ts",
        "<rootDir>/tests/checklists/**/*.test.ts",
    ],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-collab.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-collab.ts",
        "<rootDir>/tests/test-utils/setup-each-collab.ts",
    ],
};
