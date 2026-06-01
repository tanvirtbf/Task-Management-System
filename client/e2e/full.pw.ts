import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

/**
 * Comprehensive action-level E2E. Unlike the smoke route-sweep (which only
 * checks rendering + console errors), this drives real CREATE/EDIT actions and
 * fails if any produces a "Could not …/Failed" toast — the class of bug behind
 * the reported "calendar could not create task". One big sweep collects ALL
 * problems so a single run reports everything at once.
 *
 * Needs the live dev servers (client :5173, API :5501). See FULL_QA_TEST_PLAN.md.
 */

const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

const IGNORE = [
    /favicon/i,
    /Download the React DevTools/i,
    /\[antd:/i,
    /antd v5 support React is 16/i,
    /Failed to load resource.*401/i,
    /401 \(Unauthorized\)/i,
];
const isReal = (t: string) => !IGNORE.some((re) => re.test(t));

const todayKey = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 20_000,
    });
}

/** Throw if any antd toast with error-ish text is on screen (action failed). */
async function assertNoErrorToast(page: Page) {
    await page.waitForTimeout(600);
    const notices = page.locator(".ant-message-notice");
    const n = await notices.count();
    for (let i = 0; i < n; i++) {
        const t = (await notices.nth(i).innerText().catch(() => "")) ?? "";
        if (/could not|failed|unable|went wrong|error/i.test(t)) {
            throw new Error(`error toast: "${t.trim()}"`);
        }
    }
}

test("full feature sweep — actions succeed, no error toasts", async ({
    page,
}) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("console", (m: ConsoleMessage) => {
        if (m.type() === "error" && isReal(m.text())) errors.push("CONSOLE: " + m.text());
    });
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

    const problems: string[] = [];
    const step = async (name: string, fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (e) {
            problems.push(`[${name}] ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    const stamp = Date.now().toString().slice(-5);
    const spaceName = `QA Space ${stamp}`;
    const listName = `QA List ${stamp}`;
    let spaceId = "";
    let listId = "";

    await login(page);

    await step("create space", async () => {
        await page.getByLabel("New space").first().click();
        await expect(page.getByPlaceholder("e.g. Marketing")).toBeVisible({
            timeout: 8000,
        });
        await page.getByPlaceholder("e.g. Marketing").fill(spaceName);
        await page.getByRole("button", { name: "Create space" }).click();
        await assertNoErrorToast(page);
        await expect(page.getByText(spaceName).first()).toBeVisible({
            timeout: 10_000,
        });
    });

    await step("create list", async () => {
        const spaceRow = page.getByText(spaceName).first();
        await spaceRow.hover();
        await page.getByLabel("New list").first().click();
        await expect(page.getByPlaceholder("e.g. Sprint backlog")).toBeVisible({
            timeout: 8000,
        });
        await page.getByPlaceholder("e.g. Sprint backlog").fill(listName);
        await page.getByRole("button", { name: "Create list" }).click();
        await assertNoErrorToast(page);
        await expect(page.getByText(listName).first()).toBeVisible({
            timeout: 10_000,
        });
    });

    await step("open list + capture ids", async () => {
        await page.getByText(listName).first().click();
        await page.waitForURL(/\/s\/[^/]+\/l\/[^/?]+/, { timeout: 10_000 });
        const m = /\/s\/([^/]+)\/l\/([^/?]+)/.exec(page.url());
        if (!m) throw new Error("did not land on a list URL: " + page.url());
        spaceId = m[1];
        listId = m[2];
    });

    await step("list view — quick-add task", async () => {
        if (!listId) throw new Error("skipped: no list");
        await page.goto(`/s/${spaceId}/l/${listId}`);
        await page
            .getByRole("button", { name: /add task in/i })
            .first()
            .click();
        const input = page.getByPlaceholder(/Add task in/i);
        await input.fill("QA task one");
        await input.press("Enter");
        await assertNoErrorToast(page);
        await expect(page.getByText("QA task one").first()).toBeVisible({
            timeout: 8000,
        });
    });

    await step("CALENDAR — click date → create task (the reported bug)", async () => {
        if (!listId) throw new Error("skipped: no list");
        await page.goto(`/s/${spaceId}/l/${listId}/calendar`);
        const cell = page.locator(`[data-testid="day-${todayKey()}"]`);
        await expect(cell).toBeVisible({ timeout: 8000 });
        await cell.click();
        const nameInput = page.getByPlaceholder("Task name...");
        await expect(nameInput).toBeVisible({ timeout: 6000 });
        await nameInput.fill("QA calendar task");
        await page
            .getByRole("button", { name: "Create", exact: true })
            .click();
        await assertNoErrorToast(page); // would have failed on the old bug
        await expect(page.getByText("QA calendar task").first()).toBeVisible({
            timeout: 8000,
        });
    });

    await step("task detail — open drawer + edit due date", async () => {
        if (!listId) throw new Error("skipped: no list");
        await page.goto(`/s/${spaceId}/l/${listId}`);
        await page.getByText("QA task one").first().click();
        // Drawer opens (a dialog). Edit the due date via the AntD date picker if present.
        await page.waitForTimeout(800);
        const picker = page.locator(".ant-picker").first();
        if (await picker.count()) {
            await picker.click();
            const someDay = page
                .locator(".ant-picker-cell-in-view .ant-picker-cell-inner")
                .nth(10);
            if (await someDay.count()) {
                await someDay.click();
                await assertNoErrorToast(page); // inline due-date edit (same fix)
            }
        }
    });

    await step("task detail — upload an attachment (reported bug)", async () => {
        if (!listId) throw new Error("skipped: no list");
        await page.goto(`/s/${spaceId}/l/${listId}`);
        // Open the drawer by clicking the ROW — NOT the task name (its inline
        // editor stops propagation). Click ~62% across, a gap that bubbles to the
        // row's openDetail handler.
        const row = page.locator(".list-row", { hasText: "QA task one" }).first();
        await row.waitFor({ timeout: 8000 });
        const box = await row.boundingBox();
        if (!box) throw new Error("task row not found");
        await page.mouse.click(box.x + box.width * 0.62, box.y + box.height / 2);
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: "attached", timeout: 8000 });
        await fileInput.setInputFiles({
            name: "qa-upload.png",
            mimeType: "image/png",
            buffer: Buffer.from("fake-png-bytes-for-qa-upload-test", "utf8"),
        });
        await assertNoErrorToast(page); // would catch the "upload doesn't work" bug
        await expect(page.getByText("qa-upload.png").first()).toBeVisible({
            timeout: 15_000,
        });
    });

    await step("AI assistant — open + ask (help question)", async () => {
        await page.goto("/");
        await page.getByLabel("Open help assistant").click();
        const q = page.getByPlaceholder("আপনার প্রশ্ন লিখুন…");
        await expect(q).toBeVisible({ timeout: 6000 });
        await q.fill("How do I create a new task?");
        await q.press("Enter");
        // Wait for a streamed assistant reply to appear.
        await expect
            .poll(
                async () => {
                    const bubbles = page.locator(".asst-bubble--assistant");
                    const c = await bubbles.count();
                    if (c === 0) return 0;
                    const txt = (await bubbles.last().innerText().catch(() => "")) ?? "";
                    return txt.trim().length;
                },
                { timeout: 25_000, intervals: [500, 1000, 2000] },
            )
            .toBeGreaterThan(3);
        await assertNoErrorToast(page);
    });

    // Roll the captured console/page errors into the problem list.
    if (errors.length) problems.push("CONSOLE/PAGE ERRORS:\n  " + errors.join("\n  "));

    expect(problems, "\n\nISSUES FOUND:\n" + problems.join("\n") + "\n").toEqual(
        [],
    );
});
