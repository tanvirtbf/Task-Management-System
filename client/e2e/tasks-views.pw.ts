import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Phase 45 — Browser tasks: List/Board/Calendar views, TaskDetailDrawer panels,
 * dev-type gating (Bug vs Task), quick-add, list-header controls, KI-8 inert Invite.
 * The drawer opens via the `?task=<id>` URL param (ListPage reads searchParams).
 */
const MYSQL = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
const sql = (q: string) => execFileSync(MYSQL, ["-uroot", "-proot", "taskmanagement_qa", "-N", "-e", q], { encoding: "utf8" }).trim();
const LIST = "/s/sp--ueSzuQKREl5iSMVpSpTIg/l/l-63STZdlEZ2QOoWk61X-kOw";
const ALPHA = "t-i-lZYwQtOsh0FCDoUV27rw"; // Task
const GAMMA = "t-SM8n-5khukenNA_4jHueAQ"; // Bug

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill("owner@company.local");
    await page.getByPlaceholder("Enter your password").fill("Owner@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}
async function openList(page: Page) {
    await page.goto(LIST);
    await page.waitForTimeout(2500);
    await expect(page.getByText("P45X Alpha task", { exact: false }).first()).toBeVisible({ timeout: 12_000 });
}
const drawer = (page: Page) => page.getByRole("dialog");
test.afterAll(() => { sql(`DELETE FROM tasks WHERE name LIKE 'P45X quick%'`); });

test("List view renders tasks + status groups", async ({ page }) => {
    await login(page); await openList(page);
    await expect(page.getByText("QA List B", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("To Do", { exact: false }).first()).toBeVisible();
    for (const n of ["P45X Alpha task", "P45X Beta task", "P45X Gamma bug"]) await expect(page.getByText(n, { exact: false }).first()).toBeVisible();
});

test("view switch → Board renders", async ({ page }) => {
    await login(page); await openList(page);
    await page.getByRole("link", { name: "Board", exact: true }).click();
    await page.waitForTimeout(1500);
    // board keeps the status columns + the tasks
    await expect(page.getByText("P45X Alpha task", { exact: false }).first()).toBeVisible({ timeout: 8000 });
});

test("view switch → Calendar renders", async ({ page }) => {
    await login(page); await openList(page);
    await page.getByRole("link", { name: "Calendar", exact: true }).click();
    await page.waitForTimeout(1500);
    // month grid shows weekday headers
    await expect(page.getByText(/Sun|Mon|Sunday|Monday/).first()).toBeVisible({ timeout: 8000 });
});

test("drawer opens via ?task= deep-link (the mechanism every affordance uses)", async ({ page }) => {
    // ListViewRow/BoardCard/CalendarEventCard/subtask+dependency cross-links all
    // open the drawer by setting `?task=<id>` — verify that path shows the full drawer.
    await login(page);
    await page.goto(`${LIST}?task=${ALPHA}`);
    await expect(drawer(page)).toBeVisible({ timeout: 10_000 });
    await expect(drawer(page).getByText("P45X Alpha task", { exact: false })).toBeVisible({ timeout: 8000 });
});

test("multi-select checkboxes → bulk action bar appears", async ({ page }) => {
    await login(page); await openList(page);
    // hover rows to reveal their checkboxes, then select two tasks
    for (const name of ["P45X Alpha task", "P45X Beta task"]) {
        await page.getByText(name, { exact: false }).first().hover();
        await page.waitForTimeout(250);
    }
    const boxes = page.locator('.ant-checkbox-input');
    const n = await boxes.count();
    // click the last two checkboxes (row checkboxes; avoids a possible header select-all)
    await boxes.nth(n - 1).click({ force: true });
    await boxes.nth(n - 2).click({ force: true });
    await page.waitForTimeout(700);
    await expect(page.getByText(/\bselected\b/i).first()).toBeVisible({ timeout: 6000 });
});

test("regular Task drawer: base panels, NO dev panels", async ({ page }) => {
    await login(page);
    await page.goto(`${LIST}?task=${ALPHA}`);
    await expect(drawer(page)).toBeVisible({ timeout: 10_000 });
    await expect(drawer(page).getByText("P45X Alpha task", { exact: false })).toBeVisible({ timeout: 8000 }); // content loaded
    const text = await drawer(page).innerText();
    expect(text).toMatch(/Status/); expect(text).toMatch(/Priority/); expect(text).toMatch(/DESCRIPTION/i); expect(text).toMatch(/COMMENTS/i);
    // dev-only panels must be ABSENT for a non-dev task
    expect(text).not.toMatch(/BUG DETAILS/i);
    expect(text).not.toMatch(/\bGIT\b/);
    expect(text).not.toMatch(/Severity/i);
});

test("Bug drawer: dev-type panels rendered (BUG DETAILS/GIT/Severity/SLA/Subtasks/Deps)", async ({ page }) => {
    await login(page);
    await page.goto(`${LIST}?task=${GAMMA}`);
    await expect(drawer(page)).toBeVisible({ timeout: 10_000 });
    await expect(drawer(page).getByText("P45X Gamma bug", { exact: false })).toBeVisible({ timeout: 8000 }); // content loaded
    const text = await drawer(page).innerText();
    for (const panel of [/BUG DETAILS/i, /\bGIT\b/, /Severity/i, /Reviewer/i, /SUBTASKS/i, /DEPENDENCIES/i, /SLA/i]) {
        expect(text, `expected Bug drawer to contain ${panel}`).toMatch(panel);
    }
});

test("quick-add a task into a status group", async ({ page }) => {
    await login(page); await openList(page);
    const name = "P45X quick add " + Date.now().toString().slice(-5);
    await page.getByRole("button", { name: /add task in to do/i }).first().click();
    const input = page.locator("input:focus, textarea:focus").first();
    await input.fill(name);
    await input.press("Enter");
    await page.waitForTimeout(1500);
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 8000 });
    expect(Number(sql(`SELECT COUNT(*) FROM tasks WHERE name='${name}'`))).toBe(1);
});

test("list-header controls: Show closed + Me Mode filter the list", async ({ page }) => {
    await login(page); await openList(page);
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.getByRole("button", { name: /show closed/i }).click();
    await page.waitForTimeout(600);
    // Me Mode filters to tasks assigned to me — the P45X tasks are unassigned, so they hide.
    await page.getByRole("button", { name: /me mode/i }).click();
    await page.waitForTimeout(900);
    const hidden = await page.getByText("P45X Alpha task", { exact: false }).first().isVisible().catch(() => false);
    expect(hidden).toBe(false); // Me Mode correctly hides unassigned tasks
    await page.getByRole("button", { name: /me mode/i }).click(); // toggle back
    await page.waitForTimeout(900);
    await expect(page.getByText("P45X Alpha task", { exact: false }).first()).toBeVisible({ timeout: 8000 });
    expect(errs).toEqual([]);
});

test("KI-8: inert list-header 'Invite' present + does not crash", async ({ page }) => {
    await login(page); await openList(page);
    const invite = page.getByRole("button", { name: "Invite", exact: true }).first();
    await expect(invite).toBeVisible();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await invite.click().catch(() => {});
    await page.waitForTimeout(600);
    expect(errs).toEqual([]); // inert placeholder — no handler crash
    await page.keyboard.press("Escape").catch(() => {});
});
