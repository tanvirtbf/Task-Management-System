/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // §17 Custom Fields on a PRIVATE DB (tms_customfields_test), ISOLATED from
    // the §10 Tasks suite (tms_tasks_test) which a concurrent session drives —
    // and which already truncates custom_fields/task_custom_field_values, so
    // sharing it would mutually corrupt both runs. Run ONE file per jest process
    // (see setup-each-customfields.ts).
    testMatch: ["<rootDir>/tests/custom-fields/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-customfields.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-customfields.ts",
        "<rootDir>/tests/test-utils/setup-each-customfields.ts",
    ],
};
