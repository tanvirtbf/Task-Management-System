import { defineConfig, devices } from "@playwright/test";

/**
 * E2E browser tests against the ALREADY-RUNNING dev servers
 * (client :5173 + API :5501). Specs use the `.pw.ts` suffix so Vitest
 * (which matches *.test.* / *.spec.*) never tries to run them.
 *
 * Run: npx playwright test                     (everything)
 *      npx playwright test --project=mobile-390 (one profile)
 *
 * ── Projects ────────────────────────────────────────────────────────────────
 * chromium       the original desktop suite. Deliberately does NOT run the
 *                mobile/desktop-guard specs — those own their own viewports.
 * mobile-390     iPhone 12/13 class (390×844). Runs the mobile acceptance set.
 * mobile-360     mid-range Android (360×640) — the narrowest real device we
 *                support, and where every failure is worst.
 * desktop-guard  MOBILE REBUILD PLAN A11: proves a mobile-only change did not
 *                leak into the desktop app. See e2e/desktop-guard.pw.ts.
 */

const MOBILE_SPECS = /mobile-acceptance\.pw\.ts/;
const GUARD_SPECS = /desktop-guard\.pw\.ts/;

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
        // Defaults to the vite dev server. Point it at a served client/dist
        // (E2E_BASE_URL=http://localhost:4180) to run the same acceptance net
        // against the ACTUAL artifact being deployed — P8 found two crashes
        // that only ever appeared in a production build.
        baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
        headless: true,
        screenshot: "only-on-failure",
        trace: "off",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
            testIgnore: [MOBILE_SPECS, GUARD_SPECS],
        },
        {
            name: "mobile-390",
            use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
            testMatch: MOBILE_SPECS,
        },
        {
            name: "mobile-360",
            use: { ...devices["Pixel 5"], viewport: { width: 360, height: 640 } },
            testMatch: MOBILE_SPECS,
        },
        {
            name: "desktop-guard",
            use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
            testMatch: GUARD_SPECS,
        },
    ],
});
