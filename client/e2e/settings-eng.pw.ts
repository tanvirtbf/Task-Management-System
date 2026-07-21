import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 46 — Browser settings + KI-13 EngHome fix verification.
 * KI-13: the eng dashboard used hardcoded seed ids (sp-eng/l-bug-triage/…); the
 * fix resolves the real list from a representative task. A bug was seeded into
 * the real "Bug Triage" list (l-9krS0i8aig7nbSdVZEh0VQ).
 */
const REAL_BUG_LIST = "l-9krS0i8aig7nbSdVZEh0VQ";
async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill("owner@company.local");
    await page.getByPlaceholder("Enter your password").fill("Owner@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}
const isReal = (t: string) => !/(ResizeObserver|favicon|401|Unauthorized|manifest|deprecated|antd)/i.test(t);

test("🎯 KI-13: 'Open bugs' KPI navigates to the REAL Bug Triage list (not sp-eng)", async ({ page }) => {
    await login(page);
    await page.goto("/eng");
    await page.waitForTimeout(2500);
    await page.getByText("Open bugs", { exact: true }).first().click();
    await page.waitForTimeout(1500);
    // lands on the real list URL, never the old hardcoded seed id
    expect(page.url()).toContain(`/l/${REAL_BUG_LIST}`);
    expect(page.url()).not.toContain("sp-eng");
    expect(page.url()).not.toContain("l-bug-triage");
});

test("🎯 KI-13: a bug card row opens via /t/ redirect → real list", async ({ page }) => {
    await login(page);
    await page.goto("/eng");
    await page.waitForTimeout(2500);
    // click the first bug row in the "Open bugs (top 6)" card (the custom-id/severity button)
    await page.getByText("P46 KI-13 bug", { exact: false }).first().click();
    await page.waitForURL(/\/s\/[^/]+\/l\/[^/]+/, { timeout: 12_000 });
    expect(page.url()).toContain(`/l/${REAL_BUG_LIST}`);
    expect(page.url()).not.toContain("sp-eng");
});

test("all settings pages render without real console errors", async ({ page }) => {
    await login(page);
    const routes = ["profile", "workspace", "members", "task-types", "tags", "statuses", "custom-fields", "templates", "import-export"];
    const problems: Record<string, string[]> = {};
    for (const r of routes) {
        const errs: string[] = [];
        const onErr = (e: Error) => errs.push("PAGEERROR: " + e.message);
        page.on("pageerror", onErr);
        await page.goto(`/settings/${r}`);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(900);
        if (new URL(page.url()).pathname.includes("/login")) errs.push("REDIRECTED TO LOGIN");
        const text = (await page.locator("body").innerText().catch(() => "")) ?? "";
        if (text.trim().length < 5) errs.push("BLANK PAGE");
        page.off("pageerror", onErr);
        if (errs.filter(isReal).length) problems[r] = errs;
    }
    expect(problems, JSON.stringify(problems)).toEqual({});
});

test("Members: invite modal opens with email + role", async ({ page }) => {
    await login(page);
    await page.goto("/settings/members");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /invite member/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 6000 });
    await expect(dialog.locator("input").first()).toBeVisible(); // email field
    await page.keyboard.press("Escape");
});

test("KI-7: Import/Export is a placeholder (export shows a 'would download' toast)", async ({ page }) => {
    await login(page);
    await page.goto("/settings/import-export");
    await page.waitForTimeout(1200);
    await expect(page.getByText(/import/i).first()).toBeVisible();
    await expect(page.getByText(/export/i).first()).toBeVisible();
    // trigger an export → faked success toast (KI-7: not a real feature)
    const exportBtn = page.getByRole("button", { name: "Export", exact: true }).first();
    await exportBtn.click();
    // handleExport simulates a delay before the faked-success toast
    await expect(page.getByText(/would download|export ready/i).first()).toBeVisible({ timeout: 6000 });
});

test("Profile: change-password modal opens (avatar inert = KI-8)", async ({ page }) => {
    await login(page);
    await page.goto("/settings/profile");
    await page.waitForTimeout(1200);
    const changeBtn = page.getByRole("button", { name: /change password/i }).first();
    await changeBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 6000 });
    await page.keyboard.press("Escape");
});
