/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    /**
     * TENANT ISOLATION — one sweep across every `:id` endpoint (TEST PLAN P3).
     *
     * Its own module rather than a file inside an existing one, for two
     * reasons. It builds TWO complete workspaces at once — users, spaces,
     * lists, statuses, task types, tags, custom fields, templates, tasks,
     * roles — so it needs a reset that clears everything, not one module's
     * table list. And the property it checks is not any one router's: it is
     * the same question asked of forty-odd endpoints, and it grows as later
     * phases add theirs.
     */
    testMatch: ["<rootDir>/tests/isolation/**/*.test.ts"],

    globalSetup: "<rootDir>/tests/test-utils/global-setup-isolation.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-isolation.ts",
        "<rootDir>/tests/test-utils/setup-each-isolation.ts",
    ],
};
