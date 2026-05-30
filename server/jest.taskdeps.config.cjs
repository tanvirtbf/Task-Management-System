/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// §12 Task-dependencies suite on a PRIVATE DB (tms_taskdeps_test) so it never
// collides with the §10/§11 tasks suites (tms_tasks_test) a concurrent session
// is running. Test-only; not part of the build.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testMatch: ["<rootDir>/tests/task-dependencies/**/*.test.ts"],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-taskdeps.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-taskdeps.ts",
        "<rootDir>/tests/test-utils/setup-each-taskdeps.ts",
    ],
};
