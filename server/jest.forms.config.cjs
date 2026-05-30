/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // §18 Forms suites. PRIVATE DB `tms_forms_test` (see global-setup-forms) so
    // this run never collides with a concurrent session running the §10/§11/§13
    // tasks suites on `tms_t10_test` / `tms_tasks_test`. Run ONE file per process
    // and pass the specific path on the CLI.
    testMatch: ["<rootDir>/tests/forms/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-forms.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-forms.ts",
        "<rootDir>/tests/test-utils/setup-each-forms.ts",
    ],
};
