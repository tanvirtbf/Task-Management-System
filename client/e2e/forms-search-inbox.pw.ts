import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 47 — Browser forms/search/inbox/eng/AI (last Stage-K surfaces).
 * AI widget (P38), forms builder (P42), eng-home/KI-13 (P46) already covered —
 * this focuses on Search, Inbox, Report-a-bug, Sprint board, On-call, + a light
 * AI-widget re-verify.
 */
async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill("owner@company.local");
    await page.getByPlaceholder("Enter your password").fill("Owner@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}
const isReal = (t: string) => !/(ResizeObserver|favicon|401|Unauthorized|manifest|deprecated|antd)/i.test(t);

/**
 * KI-4: this searched for the literal "QA List" and expected "QA List A/B" —
 * names that only ever existed in a hand-seeded `taskmanagement_qa` database,
 * so against the demo seed the query returned nothing and the test failed on
 * a missing fixture rather than on search. What it is really asserting is
 * that a query returns results and that clicking one navigates, so it now
 * searches for a list this workspace actually has.
 */
let SEARCH_TERM = "";

test.beforeAll(async () => {
    const api = process.env.E2E_API ?? "http://localhost:5501/api/v1";
    const token = await fetch(api + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "owner@company.local",
            password: "Owner@12345",
        }),
    })
        .then((r) => r.json())
        .then((b) => b.access_token as string);
    const body = await fetch(api + "/lists", {
        headers: { Authorization: "Bearer " + token },
    }).then((r) => r.json());
    const lists = (Array.isArray(body) ? body : (body.data ?? [])) as {
        name: string;
    }[];
    if (lists.length === 0) throw new Error("no lists to search for");
    SEARCH_TERM = lists[0].name;
});

test("Search: query returns results + clicking a result navigates", async ({ page }) => {
    await login(page);
    await page.goto("/search");
    await page.getByPlaceholder("Search everything...").fill(SEARCH_TERM);
    await page.waitForTimeout(1500);
    // the lists bucket shows the list we searched for
    await expect(page.getByText(SEARCH_TERM).first()).toBeVisible({ timeout: 8000 });
    await page.getByText(SEARCH_TERM).first().click();
    await page.waitForTimeout(1200);
    // navigated somewhere meaningful (a list URL) — search didn't crash
    expect(new URL(page.url()).pathname).not.toContain("/login");
});

test("Inbox: renders notifications + filter tabs switch", async ({ page }) => {
    await login(page);
    await page.goto("/inbox");
    await page.waitForTimeout(1800);
    await expect(page.getByText(/Inbox/i).first()).toBeVisible();
    await expect(page.getByText(/unread/i).first()).toBeVisible();
    // filter tabs
    await page.getByText(/^Unread/).first().click();
    await page.waitForTimeout(600);
    await page.getByText(/Assigned to me/).first().click();
    await page.waitForTimeout(600);
    await page.getByText(/^All/).first().click();
    await page.waitForTimeout(600);
    // a notification item is present
    await expect(page.getByText(/form submission|assigned/i).first()).toBeVisible({ timeout: 6000 });
});

test("Inbox: clicking a notification routes to its target", async ({ page }) => {
    await login(page);
    await page.goto("/inbox");
    await page.waitForTimeout(1800);
    const notif = page.getByText(/assigned to|form submission/i).first();
    await notif.click();
    await page.waitForTimeout(1500);
    // routed away from a blank state (to a task/list/form) — no crash
    expect(new URL(page.url()).pathname).not.toContain("/login");
});

test("Report-a-bug: modal opens with the report form", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await page.waitForTimeout(1200);
    await page.getByText("Report a bug", { exact: false }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 6000 });
    // the report form has multiple text inputs/areas (steps / happened / etc.)
    await expect(dialog.locator("textarea, input").first()).toBeVisible();
    await page.keyboard.press("Escape");
});

test("Engineering: Sprint board + On-call pages render", async ({ page }) => {
    await login(page);
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    for (const path of ["/eng/sprint", "/eng/on-call"]) {
        await page.goto(path);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1200);
        expect(new URL(page.url()).pathname, `${path} should render`).not.toContain("/login");
        const text = (await page.locator("body").innerText().catch(() => "")) ?? "";
        expect(text.trim().length, `${path} not blank`).toBeGreaterThan(20);
    }
    expect(errs.filter(isReal)).toEqual([]);
});

test("AI widget re-verify: opens + streams a reply (KI-5 fix intact)", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Open help assistant" }).click();
    await expect(page.getByRole("dialog", { name: "Help assistant" })).toBeVisible({ timeout: 6000 });
    await page.locator(".asst-textarea").fill("How do I create a task?");
    await page.locator(".asst-textarea").press("Enter");
    await expect(page.locator(".asst-bubble--user").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator(".asst-bubble--assistant").first()).toBeVisible({ timeout: 30_000 });
});
