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

test("an in-app link in an answer navigates via react-router (no full reload)", async ({
    page,
}) => {
    // P6 / gap F2: the bot emits Markdown links to real routes; clicking one
    // must navigate INSIDE the app (no new tab, no page reload). Proof that it
    // was client-side: `isOpen` is not persisted, so a full reload would have
    // closed the widget — we assert it stays open after the hop.
    await login(page);
    await page.getByRole("button", { name: "Open help assistant" }).click();
    const dialog = page.getByRole("dialog", { name: "Help assistant" });
    await expect(dialog).toBeVisible();

    await page.locator(".asst-textarea").fill("How do I change my password?");
    await page.locator(".asst-textarea").press("Enter");

    // wait for an in-app link (relative href) inside the assistant's reply
    const link = page.locator('.asst-bubble--assistant a[href^="/"]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();

    let reloaded = false;
    page.once("load", () => (reloaded = true));
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(dialog).toBeVisible(); // widget survived → client-side nav
    expect(reloaded).toBe(false);
});

test("starter questions are reachable mid-conversation via the header toggle", async ({
    page,
}) => {
    // P7 / gap F3: suggestions used to vanish after the first message. Now a
    // header toggle re-opens a persistent bar mid-conversation.
    await login(page);
    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(page.getByRole("dialog", { name: "Help assistant" })).toBeVisible();

    await page.locator(".asst-textarea").fill("What is Board view?");
    await page.locator(".asst-textarea").press("Enter");
    await expect(page.locator(".asst-bubble--user").first()).toBeVisible({
        timeout: 10_000,
    });
    // wait for the first reply to finish streaming — a chip (like the input)
    // is intentionally a no-op while streaming, so Send must be back first.
    await expect(
        page.getByRole("button", { name: "Send message" }),
    ).toBeVisible({ timeout: 30_000 });

    const toggle = page.getByRole("button", { name: "Suggested questions" });
    await expect(toggle).toBeVisible();
    await toggle.click();

    const chip = page.locator(".asst-suggestbar .asst-chip").first();
    await expect(chip).toBeVisible();
    await chip.click();

    // clicking a chip sends it (a 2nd user bubble) and closes the bar
    await expect(page.locator(".asst-suggestbar")).toHaveCount(0);
    await expect(page.locator(".asst-bubble--user")).toHaveCount(2, {
        timeout: 10_000,
    });
});

test("first-time onboarding nudge shows near the FAB, then stays dismissed", async ({
    page,
}) => {
    // P8 / gap B2/F4: a one-time, dismissible nudge helps first-timers discover
    // the assistant; the `assistantNudgeSeen` flag persists so it won't nag.
    await login(page);
    const nudge = page.getByTestId("asst-nudge");
    await expect(nudge).toBeVisible({ timeout: 10_000 });

    await nudge.getByRole("button", { name: "Dismiss" }).click();
    await expect(nudge).toHaveCount(0);

    // reload → flag persisted, nudge does NOT return; the FAB is still there
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("asst-nudge")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Open help assistant" }),
    ).toBeVisible();
});

test("a failed request shows an error banner with Retry, and Retry recovers (P9)", async ({
    page,
}) => {
    // P9 / gap B4/F6: mid-request failures used to be silent. Now an error
    // banner + Retry appears; Retry re-runs the last turn.
    await login(page);
    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(page.getByRole("dialog", { name: "Help assistant" })).toBeVisible();

    // Force the next chat request to fail (503 degraded).
    await page.route("**/assistant/chat", (route) =>
        route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "down" } }),
        }),
    );
    await page.locator(".asst-textarea").fill("How do I create a task?");
    await page.locator(".asst-textarea").press("Enter");

    const retry = page.getByTestId("asst-retry");
    await expect(retry).toBeVisible({ timeout: 15_000 });

    // Let requests through again; Retry re-runs the turn and clears the error.
    await page.unroute("**/assistant/chat");
    await retry.click();
    await expect(retry).toHaveCount(0, { timeout: 25_000 });
    await expect(page.locator(".asst-bubble--assistant").last()).toBeVisible();
});

test("closing the assistant restores focus to the FAB (a11y — P10)", async ({
    page,
}) => {
    await login(page);
    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(
        page.getByRole("dialog", { name: "Help assistant" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
        page.getByRole("button", { name: "Open help assistant" }),
    ).toBeFocused();
});

test("each answer has a Copy button that confirms the copy (P11)", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page);
    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(
        page.getByRole("dialog", { name: "Help assistant" }),
    ).toBeVisible();
    await page.locator(".asst-textarea").fill("What is Board view?");
    await page.locator(".asst-textarea").press("Enter");

    const copy = page.getByTestId("asst-copy").first();
    await expect(copy).toBeVisible({ timeout: 30_000 });
    await copy.click();
    await expect(page.locator(".asst-copy--done").first()).toBeVisible();
});
