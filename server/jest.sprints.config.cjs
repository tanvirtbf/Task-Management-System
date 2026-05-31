/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// §20 Sprints suite on a PRIVATE DB (tms_sprints_test) so it never collides with
// other suites' DBs that a concurrent session may be running. Test-only; not part
// of the build. Run ONE file per jest process (cross-file --runInBand caveat).
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testMatch: ["<rootDir>/tests/sprints/**/*.test.ts"],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-sprints.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-sprints.ts",
        "<rootDir>/tests/test-utils/setup-each-sprints.ts",
    ],
};
