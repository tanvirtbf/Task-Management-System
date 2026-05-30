/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // The §6 Lists WRITE suites only. The read suites (list-by-space / list-all /
    // get-by-id) stay on the default `jest.config.js` (truncate-per-test): they
    // assert global side-effect counts, whereas these write suites are id-scoped
    // and run on a private no-truncate DB.
    testMatch: [
        "<rootDir>/tests/lists/create.test.ts",
        "<rootDir>/tests/lists/update.test.ts",
        "<rootDir>/tests/lists/archive.test.ts",
        "<rootDir>/tests/lists/unarchive.test.ts",
        "<rootDir>/tests/lists/delete.test.ts",
    ],

    // Private DB name (see global-setup-lists.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-lists.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-lists.ts",
        "<rootDir>/tests/test-utils/setup-each-lists.ts",
    ],
};
