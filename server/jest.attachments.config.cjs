/** @type {import('ts-jest').JestConfigWithTsJest} */
// eslint-disable-next-line no-undef
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    verbose: true,

    // A thrown assertion must never leak a `jest.spyOn(R2Service.prototype, …)`
    // mock into a later test in the same --runInBand process.
    restoreMocks: true,

    // Only the §16 Attachments suite.
    testMatch: ["<rootDir>/tests/attachments/**/*.test.ts"],

    // Private DB name (see global-setup-attachments.ts) so concurrent suites that
    // drop/recreate the shared test DB cannot race this run.
    globalSetup: "<rootDir>/tests/test-utils/global-setup-attachments.ts",
    setupFilesAfterEnv: [
        "<rootDir>/tests/test-utils/db-name-attachments.ts",
        "<rootDir>/tests/test-utils/setup-each-attachments.ts",
    ],
};
