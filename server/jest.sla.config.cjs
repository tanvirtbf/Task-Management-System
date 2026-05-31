/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // §29 SLA suites. PRIVATE DB `tms_sla_test` (see global-setup-sla) so this run
    // never collides with the concurrent §19-§28 sessions running on their own
    // private DBs. Run ONE file per process and pass the path on the CLI.
    testMatch: ["<rootDir>/tests/sla/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-sla.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-sla.ts",
        "<rootDir>/tests/test-utils/setup-each-sla.ts",
    ],
};
