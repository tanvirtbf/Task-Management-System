import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 38 — AI assistant frontend (KI-5). Proves the widget reaches the backend
 * on the DEFAULT empty .env (VITE_BACKEND_API_URL=""): with the KI-5 fix,
 * assistant.ts derives `http://<host>:5501/api/v1` instead of POSTing to the
 * Vite origin (:5173). Also checks streaming render + localStorage persistence.
 */

const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}

test("assistant widget reaches :5501, streams a reply, and persists across reload", async ({ page }) => {
    const chatRequests: string[] = [];
    page.on("request", (r) => {
        if (r.url().includes("/assistant/chat")) chatRequests.push(r.url());
    });

    await login(page);

    // Open the widget.
    await page.getByRole("button", { name: "Open help assistant" }).click();
    const dialog = page.getByRole("dialog", { name: "Help assistant" });
    await expect(dialog).toBeVisible();

    // Send a message.
    await page.locator(".asst-textarea").fill("How do I create a new task?");
    await page.locator(".asst-textarea").press("Enter");

    // The user bubble shows immediately; the assistant bubble streams in.
    await expect(page.locator(".asst-bubble--user").first()).toBeVisible({ timeout: 10_000 });
    const reply = page.locator(".asst-bubble--assistant").first();
    await expect(reply).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
        const txt = (await reply.textContent()) ?? "";
        expect(txt.trim().length).toBeGreaterThan(10);
    }).toPass({ timeout: 30_000 });

    // KI-5 PROOF: the chat request targeted the backend (:5501), NOT the Vite origin (:5173).
    expect(chatRequests.length).toBeGreaterThan(0);
    expect(chatRequests[0]).toContain(":5501/api/v1/assistant/chat");
    expect(chatRequests[0]).not.toContain(":5173");

    // Persistence: reload, reopen — the prior turn survives (localStorage-persisted store).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(page.getByRole("dialog", { name: "Help assistant" })).toBeVisible();
    await expect(page.locator(".asst-bubble--user").first()).toBeVisible({ timeout: 10_000 });
});
