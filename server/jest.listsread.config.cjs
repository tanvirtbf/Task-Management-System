/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // The §6 Lists READ suites. `jest.lists.config.cjs` claims the WRITE suites
    // only, so before this config existed these three files were claimed by
    // nothing but the root config — which nobody runs on purpose — and four
    // stale asserts stayed red and unseen for seventeen days. They live in the
    // gate now.
    testMatch: [
        "<rootDir>/tests/lists/list-all.test.ts",
        "<rootDir>/tests/lists/list-by-space.test.ts",
        "<rootDir>/tests/lists/get-by-id.test.ts",
    ],

    // Private DB (see global-setup-listsread.ts) + the truncate-per-test reset
    // these workspace-wide assertions require.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-listsread.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-listsread.ts",
        "<rootDir>/tests/test-utils/setup-each-listsread.ts",
    ],
};
