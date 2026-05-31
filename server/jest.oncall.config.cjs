/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// §21 On-call suite on a PRIVATE DB (tms_oncall_test) so it never collides with
// any other suite's DB a concurrent session may be driving. NO per-test reset
// (every test is id-scoped). Test-only; not part of the build.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testMatch: ["<rootDir>/tests/on-call/**/*.test.ts"],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-oncall.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-oncall.ts",
        "<rootDir>/tests/test-utils/setup-each-oncall.ts",
    ],
};
