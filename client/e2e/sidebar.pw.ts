import { test, expect } from "@playwright/test";

/**
 * Regression for the sidebar "options squish instead of scroll" bug: when the
 * Space tree / nav content is taller than the sidebar, the middle area must
 * SCROLL and the items must keep their natural height — not flex-shrink to fit.
 * A short viewport forces overflow regardless of how many spaces exist.
 */
const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

test("sidebar scrolls instead of squishing when content overflows", async ({
    page,
}) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 20_000,
    });

    // Force the sidebar to overflow.
    await page.setViewportSize({ width: 1280, height: 360 });
    await page.waitForTimeout(500);

    const scroll = page.getByTestId("sidebar-scroll");
    await expect(scroll).toBeVisible();

    const m = await scroll.evaluate((el) => ({
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
    }));
    // The area is scrollable AND its content overflows (so it must scroll).
    expect(m.overflowY, "scroll area must be scrollable").toMatch(
        /auto|scroll/,
    );
    expect(
        m.scrollH,
        "content should overflow the short viewport",
    ).toBeGreaterThan(m.clientH);

    // A top nav item keeps its natural height — NOT squished to fit.
    const home = page
        .locator("aside")
        .getByRole("link", { name: "Home", exact: true })
        .first();
    const box = await home.boundingBox();
    expect(
        box?.height ?? 0,
        "Home nav item must not be squished",
    ).toBeGreaterThan(26);
});
