/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // §10 Tasks suites. PRIVATE DB `tms_t10_test` (see global-setup-tasks10) so
    // this run never collides with a concurrent session running the §11/§13
    // tasks suites on `tms_tasks_test` via jest.tasks.config.cjs. Run ONE file
    // per process and pass the specific path on the CLI.
    testMatch: ["<rootDir>/tests/tasks/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-tasks10.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-tasks10.ts",
        "<rootDir>/tests/test-utils/setup-each-tasks.ts",
    ],
};
