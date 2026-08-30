import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Phase 44 — Browser sidebar / structure. Space/list names render as plain text
 * in buttons/links (no per-name aria-label), so target them with getByText(exact).
 * "New space"/"New list"/"Space actions" aria-labels repeat per space → .first().
 */
const MYSQL = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";

/**
 * The database the RUNNING API serves — not the one this spec was born
 * against. It read `taskmanagement_qa` while the dev API writes
 * `taskmanagement`, so the two create-and-verify tests below were asserting
 * against a database nothing under test had touched: they could only pass by
 * coincidence, and they counted rows left behind by an environment that has
 * not existed for a while.
 */
const DB = process.env.E2E_DB ?? "taskmanagement";
const sql = (q: string) => execFileSync(MYSQL, ["-uroot", "-proot", DB, "-N", "-e", q], { encoding: "utf8" }).trim();

const API = process.env.E2E_API ?? "http://localhost:5501/api/v1";

/**
 * These nine tests are about the SIDEBAR — does the tree render, expand,
 * navigate, filter, star, persist. Not one of them cares which Space it is
 * looking at. They hardcoded `QA Space` / `QA List A` / `QA List B` anyway,
 * which tied the whole file to one particular seed: against the demo-seeded
 * dev database every one of them failed on a name that was never there.
 *
 * So the names are RESOLVED from the API instead — the first Space that has
 * at least two Lists, and its first two Lists. Nothing is created, so nothing
 * needs cleaning up, and the file is green against any seed. (Same approach as
 * assignee-picker.pw.ts, which resolves its target list the same way.)
 */
let SPACE = "";
let LIST_A = "";
let LIST_B = "";

async function resolveFixtures(): Promise<void> {
    const token = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@company.local", password: "Owner@12345" }),
    })
        .then((r) => r.json())
        .then((b) => b.access_token as string);
    const auth = { Authorization: `Bearer ${token}` };
    const unwrap = (b: unknown) =>
        Array.isArray(b) ? b : ((b as { data?: unknown[] }).data ?? []);

    const spaces = unwrap(
        await fetch(`${API}/spaces`, { headers: auth }).then((r) => r.json()),
    ) as { id: string; name: string }[];
    for (const space of spaces) {
        const lists = unwrap(
            await fetch(`${API}/spaces/${space.id}/lists`, { headers: auth }).then(
                (r) => r.json(),
            ),
        ) as { name: string }[];
        if (lists.length >= 2) {
            SPACE = space.name;
            LIST_A = lists[0].name;
            LIST_B = lists[1].name;
            return;
        }
    }
    throw new Error(
        "no Space with two Lists in this workspace — the sidebar tree tests need one",
    );
}

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill("owner@company.local");
    await page.getByPlaceholder("Enter your password").fill("Owner@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
    await page.waitForTimeout(1500);
}
const purge = () => { sql(`DELETE FROM lists WHERE name LIKE 'P44X%'`); sql(`DELETE FROM spaces WHERE name LIKE 'P44X%'`); };
test.beforeAll(async () => {
    purge();
    await resolveFixtures();
});
test.afterAll(() => purge());

// A Space is collapsed by default — expand it so its lists are in the DOM.
async function ensureExpanded(page: Page) {
    const listA = page.getByText(LIST_A, { exact: true }).first();
    if (!(await listA.isVisible().catch(() => false))) {
        await page.getByText(SPACE, { exact: true }).first().click();
        await page.waitForTimeout(700);
    }
    await expect(listA).toBeVisible({ timeout: 8000 });
}

test("sidebar renders the space tree (a Space + its lists)", async ({ page }) => {
    await login(page);
    await expect(page.getByText(SPACE, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await ensureExpanded(page); // asserts the first List becomes visible once expanded
});

test("list click → navigates to /s/:space/l/:list", async ({ page }) => {
    await login(page);
    await ensureExpanded(page);
    await page.getByText(LIST_B, { exact: true }).first().click();
    await page.waitForURL(/\/s\/[^/]+\/l\/[^/]+/, { timeout: 12_000 });
    expect(page.url()).toMatch(/\/s\/.+\/l\/.+/);
});

test("filter box narrows the tree + clears", async ({ page }) => {
    await login(page);
    const filter = page.getByPlaceholder("Filter spaces & lists...");
    await filter.fill(LIST_A);
    await page.waitForTimeout(600);
    await expect(page.getByText(LIST_A, { exact: true }).first()).toBeVisible();
    await page.locator('[aria-label="Clear filter"]').click();
    await expect(filter).toHaveValue("");
});

test("quick-create space (modal) → appears in tree", async ({ page }) => {
    await login(page);
    const name = "P44X Space A";
    await page.locator('[aria-label="New space"]').first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await dialog.locator('input[type="text"], input:not([type])').first().fill(name);
    await page.getByRole("button", { name: "Create space" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 12_000 });
    expect(Number(sql(`SELECT COUNT(*) FROM spaces WHERE name='${name}'`))).toBe(1);
});

test("quick-create list (modal) → row created in DB", async ({ page }) => {
    await login(page);
    const name = "P44X List A";
    await page.locator('[aria-label="New list"]').first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await dialog.locator('input[type="text"], input:not([type])').first().fill(name);
    await page.getByRole("button", { name: "Create list" }).click();
    await page.waitForTimeout(1500);
    expect(Number(sql(`SELECT COUNT(*) FROM lists WHERE name='${name}'`))).toBeGreaterThanOrEqual(1);
});

test("space expand state persists across reload", async ({ page }) => {
    await login(page);
    await ensureExpanded(page); // expand (default is collapsed) → List A visible
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1800);
    // expanded state persisted (localStorage useUiStore) → List A still visible without re-clicking
    await expect(page.getByText(LIST_A, { exact: true }).first()).toBeVisible({ timeout: 8000 });
});

test("star a list → a Favorites section appears (persists across reload)", async ({ page }) => {
    await login(page);
    await ensureExpanded(page);
    const list = page.getByText(LIST_A, { exact: true }).first();
    await list.hover();
    await page.locator('[title="Add to favorites"]').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1800);
    await expect(page.getByText("Favorites", { exact: false }).first()).toBeVisible({ timeout: 8000 });
    // cleanup: unfavorite
    await page.getByText(LIST_A, { exact: true }).first().hover();
    await page.locator('[title="Unfavorite"]').first().click({ timeout: 4000 }).catch(() => {});
});

test("context menu (Space actions) opens with rename/archive/delete", async ({ page }) => {
    await login(page);
    await page.getByText(SPACE, { exact: true }).first().hover();
    await page.locator('[aria-label="Space actions"]').first().click();
    const menu = page.locator(".ant-dropdown-menu").last();
    await expect(menu).toBeVisible({ timeout: 5000 });
    expect((await menu.innerText()).toLowerCase()).toMatch(/rename|new list|archive|delete/);
    await page.keyboard.press("Escape");
});

test("collapse / expand the sidebar rail", async ({ page }) => {
    await login(page);
    await page.locator('[aria-label="Collapse sidebar"]').click();
    await expect(page.locator('[aria-label="Expand sidebar"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[aria-label="Expand sidebar"]').click();
    await expect(page.locator('[aria-label="Collapse sidebar"]')).toBeVisible({ timeout: 5000 });
});
