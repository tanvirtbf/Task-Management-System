/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Dynamic RBAC suite (plan: RBAC_DYNAMIC_PLAN.md).
    testMatch: ["<rootDir>/tests/rbac/**/*.test.ts"],

    // Private DB name (see global-setup-rbac.ts) so concurrent suites that
    // drop/recreate their own test DBs cannot race this run. Added at P4 when
    // the first DB-touching test (the repositories) landed; P1-P3's pure
    // catalog/schema/contract tests simply ignore the connection.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-rbac.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-rbac.ts",
        "<rootDir>/tests/test-utils/setup-each-rbac.ts",
    ],
};
