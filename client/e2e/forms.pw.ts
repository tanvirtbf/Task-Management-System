import { test, expect, type Page } from "@playwright/test";
import { removeNotificationsLike } from "./fixtures";

// A public-form submission notifies the owning team; that row points at the
// FORM, so nothing else in the teardown reaches it.
test.afterAll(() => removeNotificationsLike("%PW Public Form %"));

/**
 * Forms feature E2E. Covers the two bugs found in QA:
 *  1. Public form with typed custom fields (date + dropdown) must SUBMIT — it
 *     used to send `{text}` for every custom field and 422 on date/dropdown.
 *  2. The "New form" button on /forms must actually create a form (was a no-op).
 *
 * Setup/teardown for the public-form test go through the API (fast, reliable);
 * the browser drives the part under test — the anonymous public page.
 */

const API = "http://localhost:5501/api/v1";
const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

let token = "";
async function api(method: string, path: string, body?: unknown, noAuth = false) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!noAuth && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let json: unknown = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
    return { status: res.status, json: json as Record<string, unknown> };
}
const arr = (j: unknown): Record<string, unknown>[] =>
    Array.isArray(j) ? j : ((j as { data?: unknown[] })?.data as Record<string, unknown>[]) ?? [];

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}

test("public form with date + dropdown fields submits successfully", async ({ page }) => {
    // ── API setup ───────────────────────────────────────────────
    const lg = await api("POST", "/auth/login", { email: EMAIL, password: PASSWORD }, true);
    token = lg.json.access_token as string;
    expect(token, "login token").toBeTruthy();

    const lists = await api("GET", "/lists");
    const list = arr(lists.json)[0];
    expect(list, "a list exists").toBeTruthy();
    const listId = list.id as string;
    const stamp = String(Date.now()).slice(-6);

    const cfDate = await api("POST", "/custom-fields", { scope_type: "list", scope_id: listId, name: "PW Date " + stamp, type: "date" });
    const cfDrop = await api("POST", "/custom-fields", { scope_type: "list", scope_id: listId, name: "PW Dropdown " + stamp, type: "dropdown", options: [{ label: "Express" }, { label: "Standard" }] });
    const dateId = cfDate.json.id as string;
    const dropId = cfDrop.json.id as string;

    const form = await api("POST", "/forms", { list_id: listId, title: "PW Public Form " + stamp });
    const formId = form.json.id as string;
    const slug = form.json.public_slug as string;
    await api("POST", `/forms/${formId}/fields`, { field_kind: "task_attr", field_key: "name", label: "Your name", is_required: true });
    await api("POST", `/forms/${formId}/fields`, { field_kind: "custom_field", field_key: dateId, label: "Delivery date" });
    await api("POST", `/forms/${formId}/fields`, { field_kind: "custom_field", field_key: dropId, label: "Shipping speed", is_required: true });

    try {
        // ── browser drives the anonymous public page ─────────────
        await page.goto(`/forms/${slug}`);
        await expect(page.getByRole("heading", { name: "PW Public Form " + stamp })).toBeVisible({ timeout: 10_000 });

        // name (the only plain text input)
        await page.locator("input.ant-input").first().fill("Browser Tester");

        // dropdown → real Select with the two options from the API
        await page.locator(".ant-select").first().click();
        await page.locator(".ant-select-item-option").filter({ hasText: "Express" }).first().click();

        // date → real DatePicker
        await page.locator(".ant-picker").first().click();
        await page.locator(".ant-picker-cell-in-view").nth(15).click();

        await page.getByRole("button", { name: "Submit" }).click();

        // success screen — this is the assertion the old {text} bug failed
        await expect(page.getByText("Submission received")).toBeVisible({ timeout: 15_000 });

        // and the submission really landed
        const subs = await api("GET", `/forms/${formId}/submissions`);
        expect(arr(subs.json).length, "submission recorded").toBeGreaterThanOrEqual(1);
    } finally {
        // ── teardown ─────────────────────────────────────────────
        const subs = await api("GET", `/forms/${formId}/submissions`);
        await api("DELETE", `/forms/${formId}`);
        await api("DELETE", `/custom-fields/${dateId}`);
        await api("DELETE", `/custom-fields/${dropId}`);
        for (const s of arr(subs.json)) {
            if (s.task_id) await api("DELETE", `/tasks/${s.task_id}`);
        }
    }
});

test('"New form" button on /forms creates a form and opens the builder', async ({ page }) => {
    const lg = await api("POST", "/auth/login", { email: EMAIL, password: PASSWORD }, true);
    token = lg.json.access_token as string;

    await login(page);
    await page.goto("/forms");
    await page.getByRole("button", { name: "New form" }).click();

    // modal
    await expect(page.getByText("Form title")).toBeVisible({ timeout: 8000 });
    await page.getByPlaceholder("e.g. Order intake form").fill("PW New-Form Test");
    // pick the first list in the Select
    await page.locator(".ant-modal .ant-select").click();
    await page.locator(".ant-select-item-option").first().click();
    await page.getByRole("button", { name: "Create form" }).click();

    // navigates to the builder
    await page.waitForURL(/\/forms\/[^/]+\/edit/, { timeout: 15_000 });
    // no error toast
    const notice = page.locator(".ant-message-notice");
    if (await notice.count()) {
        const t = (await notice.first().innerText().catch(() => "")) ?? "";
        expect(/could not|failed/i.test(t), `error toast: ${t}`).toBeFalsy();
    }

    // cleanup the created form
    const m = /\/forms\/([^/]+)\/edit/.exec(page.url());
    if (m) await api("DELETE", `/forms/${m[1]}`);
});
