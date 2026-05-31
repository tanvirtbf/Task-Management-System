import { defineConfig, devices } from "@playwright/test";

/**
 * E2E browser smoke tests against the ALREADY-RUNNING dev servers
 * (client :5173 + API :5501). Specs use the `.pw.ts` suffix so Vitest
 * (which matches *.test.* / *.spec.*) never tries to run them.
 *
 * Run: npx playwright test    (from client/)
 */
export default defineConfig({
    testDir: "./e2e",
    testMatch: /.*\.pw\.ts/,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: "http://localhost:5173",
        headless: true,
        screenshot: "only-on-failure",
        trace: "off",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
