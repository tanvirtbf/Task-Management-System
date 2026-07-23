/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // Dept Review V1 suite only (plan: DEPARTMENT_REVIEW_PLAN.md, rule 8).
    // Mirrors the per-module isolation pattern (jest.spaces.config.cjs).
    testMatch: ["<rootDir>/tests/dept-review/**/*.test.ts"],

    // Private DB name (see global-setup-deptreview.ts) so concurrent suites
    // that drop/recreate their own test DBs cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-deptreview.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-deptreview.ts",
        "<rootDir>/tests/test-utils/setup-each-deptreview.ts",
    ],
};
