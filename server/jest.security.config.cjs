/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    /**
     * INPUT ABUSE — the probes that ask what happens when somebody types
     * something hostile (TEST PLAN P7).
     *
     * Its own module for the same reason `isolation` has one: the questions
     * are not any single router's. SQL injection goes through search, filters
     * and sort params; oversize bodies go at every write; path traversal goes
     * at attachment names; unicode goes at every name field. A suite that
     * walks all of those needs a reset that clears everything, and it will
     * keep growing — P8 adds the storage edges to it.
     *
     * These tests are mostly expected to find nothing. That is the point: an
     * unasked question is not a safe answer, and "we use an ORM so we are fine"
     * is a belief until something checks.
     */
    testMatch: ["<rootDir>/tests/security/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-security.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-security.ts",
        "<rootDir>/tests/test-utils/setup-each-security.ts",
    ],
};
