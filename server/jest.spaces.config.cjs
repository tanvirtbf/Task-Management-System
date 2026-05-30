/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Only this endpoint's suite. NOTE: run ONE file per jest process (see the
    // cross-file caveat in setup-each-spaces.ts) — pass the specific test file
    // on the CLI rather than letting jest batch the whole folder.
    testMatch: ["<rootDir>/tests/spaces/**/*.test.ts"],

    // Private DB name (see global-setup-spaces.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-spaces.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-spaces.ts",
        "<rootDir>/tests/test-utils/setup-each-spaces.ts",
    ],
};
