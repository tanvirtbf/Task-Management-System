/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // §22 Engineering-specials suites. PRIVATE DB `tms_eng_test` (see
    // global-setup-eng) so this run never collides with the concurrent
    // §19/§20/§21/§23 sessions running on their own private DBs. Run ONE file per
    // process and pass the specific path on the CLI.
    testMatch: ["<rootDir>/tests/eng/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-eng.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-eng.ts",
        "<rootDir>/tests/test-utils/setup-each-eng.ts",
    ],
};
