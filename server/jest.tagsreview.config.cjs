/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// THROWAWAY runner: §9 tags suite on a PRIVATE DB (tms_tagsreview_test) for the
// adversarial-review confirmation. Safe to delete once §9 is signed off.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testMatch: ["<rootDir>/tests/tags/**/*.test.ts"],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-tagsreview.ts",
    setupFilesAfterEnv: ["<rootDir>/tests/test-utils/setup-each-tagsreview.ts"],
};
