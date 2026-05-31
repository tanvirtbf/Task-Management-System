/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
// §27 SSE suite on a PRIVATE DB (tms_sse_test). Test-only; not part of the build.
// Run ONE file per jest process (cross-file --runInBand caveat).
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,
    testMatch: ["<rootDir>/tests/sse/**/*.test.ts"],
    globalSetup: "<rootDir>/tests/test-utils/global-setup-sse.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-sse.ts",
        "<rootDir>/tests/test-utils/setup-each-sse.ts",
    ],
};
