/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// §28 Background-jobs suite on a PRIVATE DB (tms_jobs_test) so it never collides
// with another suite's DB a concurrent session may run. `restoreMocks` because
// later jobs spy R2Service/MailService. Per-test DELETE reset lives in
// setup-each-jobs (jobs are global + count-asserting). Test-only.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    restoreMocks: true,
    testMatch: ["<rootDir>/tests/jobs/**/*.test.ts"],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-jobs.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-jobs.ts",
        "<rootDir>/tests/test-utils/setup-each-jobs.ts",
    ],
};
