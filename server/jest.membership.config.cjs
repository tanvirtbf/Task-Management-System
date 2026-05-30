/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // §11 Task-membership suites on a PRIVATE DB (tms_membership_test),
    // deliberately ISOLATED from the §10 Tasks suite — which runs on
    // tms_tasks_test and is actively driven by a concurrent session, so sharing
    // that DB would mutually corrupt both runs. Run ONE file per jest process
    // (see setup-each-membership.ts for the cross-file caveat).
    testMatch: ["<rootDir>/tests/membership/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-membership.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-membership.ts",
        "<rootDir>/tests/test-utils/setup-each-membership.ts",
    ],
};
