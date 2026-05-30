/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // The §10/§11 Tasks suites. Run ONE file per jest process under a clear
    // window (the shared MySQL box is worked on by multiple sessions — see
    // project-test-db-isolation memory).
    testMatch: ["<rootDir>/tests/tasks/**/*.test.ts"],

    // Private DB name (see global-setup-tasks.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-tasks.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-tasks.ts",
        "<rootDir>/tests/test-utils/setup-each-tasks.ts",
    ],
};
