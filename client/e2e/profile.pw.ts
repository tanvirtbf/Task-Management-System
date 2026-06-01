import { test, expect, type Page } from "@playwright/test";

const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

// The profile inputs aren't label-linked (no htmlFor) and the sidebar has its
// own search input, so target by the field-row structure: the <label> text →
// its row → the input in the sibling cell.
const fieldInput = (page: Page, label: string) =>
    page.locator(
        `xpath=//label[normalize-space()="${label}"]/ancestor::div[1]/following-sibling::div//input`,
    );

test("profile edit saves + persists", async ({ page }) => {
    const errs: string[] = [];
    page.on("console", (m) => {
        if (m.type() === "error") errs.push(m.text());
    });
    page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));

    let patch: { status: number; reqBody: string; body: string } | null = null;
    page.on("response", async (r) => {
        if (r.request().method() === "PATCH" && /\/users\//.test(r.url())) {
            patch = {
                status: r.status(),
                reqBody: r.request().postData() ?? "",
                body: await r.text().catch(() => ""),
            };
        }
    });

    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });

    await page.goto("/settings/profile");
    const firstName = fieldInput(page, "First name");
    await firstName.waitFor({ timeout: 8000 });
    const original = await firstName.inputValue();
    const newName = "Tanvir" + (Date.now() % 1000);
    await firstName.fill(newName);

    const saveBtn = page.getByRole("button", { name: /save changes/i });
    console.log("after edit — save button disabled?", await saveBtn.isDisabled());
    await saveBtn.click();
    await page.waitForTimeout(2000);

    const toasts = page.locator(".ant-message-notice");
    const toastTexts: string[] = [];
    for (let i = 0; i < (await toasts.count()); i++) {
        toastTexts.push((await toasts.nth(i).innerText().catch(() => "")) ?? "");
    }
    console.log("PATCH:", JSON.stringify(patch));
    console.log("TOASTS:", JSON.stringify(toastTexts));
    console.log("CONSOLE ERRORS:", JSON.stringify(errs));

    await page.reload();
    await page.waitForTimeout(1200);
    const afterReload = await fieldInput(page, "First name").inputValue();
    console.log("first name after reload:", afterReload, "(was:", original, ")");

    // restore
    await fieldInput(page, "First name").fill(original || "Owner");
    await page.getByRole("button", { name: /save changes/i }).click();
    await page.waitForTimeout(1000);

    expect(afterReload, "edited first name should persist after reload").toBe(newName);
});
