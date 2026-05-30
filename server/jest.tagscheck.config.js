/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// Scoped regression runner (mine): the pre-existing baseline suite (tests/auth)
// plus the new tests/tags, on the PRIVATE database (see global-setup-tags.ts)
// so it is contention-free. Confirms the tags work did not regress the
// previously-passing auth suite. Test-only; not part of the build.
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testMatch: [
        "<rootDir>/tests/auth/**/*.test.ts",
        "<rootDir>/tests/tags/**/*.test.ts",
    ],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-tags.ts",
    setupFilesAfterEnv: ["<rootDir>/tests/test-utils/setup-each-tags.ts"],
};
