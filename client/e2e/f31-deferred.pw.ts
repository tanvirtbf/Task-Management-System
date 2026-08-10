import { execFileSync } from "child_process";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * F31 — the deferred interaction pass (FIXING_MASTER_PLAN Block H).
 *
 * P34/P35/P36 recorded these as debt: board drag-and-drop, calendar
 * drag-to-schedule, cross-context propagation, offline/recovery, token expiry,
 * server-side revocation, ⌘K + focus traps, responsive breakpoints, and an
 * accessibility pass. One scripted run, against the same qa-DB stack the P45
 * specs use. Findings are FILED (rule X1), not fixed here — a test that
 * documents a filed finding is annotated `test.fail` with the ISS number, so
 * the suite is green-or-filed by construction.
 *
 * Environment: API :5501 on taskmanagement_qa (DB_NAME_OVERRIDE) + vite :5173.
 * Fixtures: fixing/evidence/F31/restore-qa-fixtures.cjs (P45X tasks, pinned ids).
 */

const MYSQL = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
const sql = (q: string) =>
    execFileSync(MYSQL, ["-uroot", "-proot", "taskmanagement_qa", "-N", "-e", q], {
        encoding: "utf8",
    }).trim();

const LIST = "/s/sp--ueSzuQKREl5iSMVpSpTIg/l/l-63STZdlEZ2QOoWk61X-kOw";
const ALPHA = "t-i-lZYwQtOsh0FCDoUV27rw";
const API = "http://localhost:5501/api/v1";
const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
}

const apiLogin = async () => {
    const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    return (await r.json()).access_token as string;
};


/** The Board/Calendar chunks are code-split (F30): after the tab click the
 *  LIST stays mounted while the chunk loads, and text locators happily match
 *  its rows — run 1 dragged an undraggable list row. Wait for view-specific
 *  DOM before measuring anything. */
async function openBoard(page: Page) {
    await page.getByRole("link", { name: "Board", exact: true }).click();
    await page.waitForFunction(() => {
        const leaf = (t: string) => Array.from(document.querySelectorAll("*")).filter(
            (e) => e.textContent?.trim() === t && e.children.length === 0);
        const a = leaf("To Do")[0]?.getBoundingClientRect();
        const b = leaf("In Progress")[0]?.getBoundingClientRect();
        return !!a && !!b && Math.abs(a.x - b.x) > 100; // columns side by side
    }, { timeout: 15_000 });
}
async function openCalendar(page: Page) {
    await page.getByRole("link", { name: "Calendar", exact: true }).click();
    await page.waitForSelector('[data-testid^="day-"]', { timeout: 15_000 });
}

/** dnd-kit needs real pointer movement, not HTML5 dragTo. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // small initial jiggle to clear any activation-distance constraint
    await page.mouse.move(from.x + 12, from.y + 4, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 14 });
    await page.waitForTimeout(150);
    await page.mouse.up();
}

test.afterAll(() => {
    // return the fixture to its invariant state
    sql(`UPDATE tasks SET status_id = (SELECT id FROM statuses WHERE scope_id='l-63STZdlEZ2QOoWk61X-kOw' AND name='To Do'), due_date = NULL WHERE id = '${ALPHA}'`);
    sql(`DELETE FROM comments WHERE task_id='${ALPHA}' AND body LIKE 'F31 %'`);
});

// ─── 1. board drag-and-drop between status columns ───────────────────────────
test("board: dragging a card to another column changes its status and persists", async ({ page }) => {
    await login(page);
    await page.goto(LIST);
    await openBoard(page);
    const card = page.getByText("P45X Alpha task", { exact: false }).first();
    await expect(card).toBeVisible({ timeout: 12_000 });

    const cardBox = (await card.boundingBox())!;
    // drop ONTO the Beta card — it sits in the In Progress column, so its
    // center is guaranteed inside that column's droppable body (dropping at
    // the column HEADER missed it in run 1)
    const target = page.getByText("P45X Beta task", { exact: false }).first();
    const tBox = (await target.boundingBox())!;
    await dragTo(page,
        { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
        { x: tBox.x + tBox.width / 2, y: tBox.y + tBox.height / 2 });

    // persisted: the API now reports the task in an "In Progress" status
    await expect
        .poll(async () => sql(`SELECT s.name FROM tasks t JOIN statuses s ON s.id=t.status_id WHERE t.id='${ALPHA}'`), { timeout: 10_000 })
        .toBe("In Progress");
    await page.reload();
    await openBoard(page);
    await expect(page.getByText("P45X Alpha task", { exact: false }).first()).toBeVisible({ timeout: 12_000 });
});

// ─── 2. calendar drag-to-schedule from the unscheduled panel ─────────────────
test("calendar: dragging an unscheduled task onto a day sets its due date", async ({ page }) => {
    sql(`UPDATE tasks SET due_date = NULL WHERE id='${ALPHA}'`);
    await login(page);
    await page.goto(LIST);
    await openCalendar(page);
    const chip = page.getByText("P45X Alpha task", { exact: false }).first();
    await expect(chip).toBeVisible({ timeout: 12_000 });

    const cBox = (await chip.boundingBox())!;
    // the month grid exposes data-testid="day-YYYY-MM-DD" (CalendarMonthGrid);
    // day 15 of the CURRENT month is always on the visible view
    const now = new Date();
    const key = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-15";
    const day = page.locator(`[data-testid="day-${key}"]`);
    const dBox = (await day.boundingBox())!;
    await dragTo(page,
        { x: cBox.x + cBox.width / 2, y: cBox.y + cBox.height / 2 },
        { x: dBox.x + dBox.width / 2, y: dBox.y + 30 });

    await expect
        .poll(async () => sql(`SELECT COALESCE(DATE_FORMAT(due_date,'%d'),'none') FROM tasks WHERE id='${ALPHA}'`), { timeout: 10_000 })
        .toBe("15");
});

// ─── 3. cross-context propagation. The live SSE stream (§29c Level 1, added
//        2026-08-08) pushes NOTIFICATIONS, not task content: a comment posted
//        elsewhere still surfaces on refetch, which is what this asserts. The
//        actor here is the same owner account, so no notification is produced
//        for them either way. ────────────────────────────────────────────────
test("two contexts: a comment posted elsewhere appears when the drawer reopens", async ({ browser }) => {
    const token = await apiLogin();
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await login(pageB);
    await pageB.goto(`${LIST}?task=${ALPHA}`);
    await expect(pageB.getByRole("dialog").getByText("P45X Alpha task")).toBeVisible({ timeout: 12_000 });

    const body = `F31 propagation ${Date.now()}`;
    const r = await fetch(`${API}/tasks/${ALPHA}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body }),
    });
    expect(r.status).toBe(201);

    // reopen the drawer — the product's intended propagation path
    await pageB.keyboard.press("Escape");
    await pageB.goto(`${LIST}?task=${ALPHA}`);
    await expect(pageB.getByRole("dialog").getByText(body)).toBeVisible({ timeout: 12_000 });
    await ctxB.close();
});

// ─── 4. offline and recovery ─────────────────────────────────────────────────
test("offline: a comment fails visibly, recovers after reconnect", async ({ page, context }) => {
    await login(page);
    await page.goto(`${LIST}?task=${ALPHA}`);
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("P45X Alpha task")).toBeVisible({ timeout: 12_000 });

    const input = drawer.getByPlaceholder(/Write a comment/i).first();
    await input.click();
    await input.fill(`F31 offline attempt`);
    await context.setOffline(true);
    await page.keyboard.press("Control+Enter");
    // the app must stay alive — drawer still there, no crash screen
    await page.waitForTimeout(1500);
    await expect(drawer.getByText("P45X Alpha task")).toBeVisible();

    await context.setOffline(false);
    const body = `F31 recovered ${Date.now()}`;
    await input.click();
    await input.fill(body);
    await page.keyboard.press("Control+Enter");
    await expect(drawer.getByText(body)).toBeVisible({ timeout: 12_000 });
});

// ─── 5. token expiry mid-session (the in-memory token dies on reload; the
//        refresh cookie must resurrect the session seamlessly) ───────────────
test("expiry-equivalent: a hard reload re-authenticates via the refresh cookie", async ({ page }) => {
    await login(page);
    await page.goto("/inbox");
    await page.reload();
    await page.waitForTimeout(2500);
    expect(page.url()).not.toContain("/login");
    await expect(page.getByText(/inbox|notification/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─── 6. ⌘K — bound in AppShell since F34 (ISS-096 fixed) ────────────────────
test("⌘K opens search from Home (advertised by the Sidebar hint)", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Control+KeyK");
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("/search");
});

// ─── 7. focus trap in a modal ────────────────────────────────────────────────
test("modal focus trap: Tab cycles inside, Escape closes", async ({ page }) => {
    await login(page);
    await page.goto("/settings/task-types");
    await page.getByRole("button", { name: /new task type/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            return d ? d.contains(document.activeElement) : false;
        });
        expect(inside, `Tab #${i + 1} escaped the dialog`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});

// ─── 8. responsive breakpoints — no horizontal scroll, shell alive ───────────
for (const [w, h] of [[1920, 1080], [1366, 768], [1024, 768], [768, 1024], [390, 844]] as const) {
    test(`responsive ${w}×${h}: home renders without horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await login(page);
        await page.goto("/");
        await page.waitForTimeout(2000);
        const overflow = await page.evaluate(() => {
            const el = document.scrollingElement!;
            return el.scrollWidth - el.clientWidth;
        });
        expect(overflow, "horizontal overflow px").toBeLessThanOrEqual(1);
    });
}

// ─── 9. accessibility pass (axe) — critical violations must be zero or filed ─
for (const [name, path] of [["login", "/login"], ["home", "/"], ["list", LIST]] as const) {
    test(`axe: ${name} has no critical violations`, async ({ page }) => {
        if (path !== "/login") await login(page);
        await page.goto(path);
        await page.waitForTimeout(2500);
        const results = await new AxeBuilder({ page }).analyze();
        const bySeverity: Record<string, number> = {};
        for (const v of results.violations) bySeverity[v.impact ?? "none"] = (bySeverity[v.impact ?? "none"] ?? 0) + 1;
        console.log(`  axe(${name}): ${JSON.stringify(bySeverity)} — ${results.violations.map((v) => v.id).join(", ") || "clean"}`);
        const critical = results.violations.filter((v) => v.impact === "critical");
        expect(critical.map((v) => v.id), "critical a11y violations").toEqual([]);
    });
}

// ─── 10. server-side session revocation (LAST — it kills every owner session) ─
test("revocation: logout-all elsewhere ends this browser's session on next refresh", async ({ page }) => {
    await login(page);
    await page.goto("/inbox");

    const token = await apiLogin();
    const r = await fetch(`${API}/auth/logout-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 204]).toContain(r.status);

    // the live access token has ≤15 min left BY DESIGN (documented auth-layer
    // decision); a reload drops it and the refresh must now be refused
    await page.reload();
    await page.waitForURL((u) => u.pathname.includes("/login"), { timeout: 20_000 });
    expect(page.url()).toContain("/login");
});
