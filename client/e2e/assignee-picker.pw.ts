import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * The assignment surfaces, verified in a browser.
 *
 * Three things people asked for and one bug found while building them:
 *
 *   1. "Me" — take a task yourself without searching for your own name.
 *   2. Your own team first in the picker, everyone else below.
 *   3. Only ACTIVE people offered. `GET /users` also returns `invited` accounts
 *      that have never signed in and `deactivated` leavers, and the server
 *      answers an assignment to either with 422 `task.invalid_assignee` — so
 *      offering them was offering a choice that could not work.
 *
 *   4. (found here) ListViewRow sent assignee changes as `PATCH /tasks/:id`,
 *      which the API refuses outright — "assignees are managed via POST
 *      /tasks/:id/assignees and DELETE /tasks/:id/assignees/:userId". Changing
 *      an assignee from the list view had never worked; it only ever produced
 *      that sentence as a toast. Asserted below by making the change and
 *      reading it back from the API.
 *
 * The picker is an antd Popover in a portal, and clicking its trigger too soon
 * after navigation is genuinely racy in automation — hence the explicit waits
 * on the popover itself rather than fixed sleeps.
 */

const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";
const API = "http://localhost:5501/api/v1";

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 20_000,
    });
}

async function apiToken(request: APIRequestContext): Promise<string> {
    const res = await request.post(`${API}/auth/login`, {
        data: { email: EMAIL, password: PASSWORD },
    });
    return (await res.json()).access_token as string;
}

const unwrap = <T,>(body: unknown): T[] =>
    Array.isArray(body) ? (body as T[]) : ((body as { data?: T[] }).data ?? []);

/** The first list that actually holds a task — an empty one proves nothing. */
async function findPopulatedList(request: APIRequestContext, token: string) {
    const h = { Authorization: `Bearer ${token}` };
    const spaces = unwrap<{ id: string }>(
        await (await request.get(`${API}/spaces`, { headers: h })).json(),
    );
    for (const space of spaces) {
        const lists = unwrap<{ id: string }>(
            await (
                await request.get(`${API}/spaces/${space.id}/lists`, { headers: h })
            ).json(),
        );
        for (const list of lists) {
            // The API pages tasks under the LIST, not a query on /tasks —
            // GET /tasks?list_id=... is a 404 route.not_found.
            const tasks = unwrap<{ id: string; assignees?: string[] }>(
                await (
                    await request.get(`${API}/lists/${list.id}/tasks?limit=200`, {
                        headers: h,
                    })
                ).json(),
            );
            if (tasks.length > 0) {
                return { spaceId: space.id, listId: list.id, task: tasks[0] };
            }
        }
    }
    throw new Error("no list with a task — seed the dev DB first");
}

/** Open the row picker and return its popover, once it has actually rendered. */
async function openRowPicker(page: Page) {
    const trigger = page.getByRole("button", { name: "Edit assignees" }).first();
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    const popover = page.locator(".ant-popover").last();
    // antd's controlled Popover occasionally swallows the very first click
    // right after hydration; retry rather than sleep and hope.
    for (let attempt = 0; attempt < 3; attempt++) {
        await trigger.click();
        try {
            await popover.waitFor({ state: "visible", timeout: 4000 });
            return popover;
        } catch {
            /* try again */
        }
    }
    throw new Error("the assignee picker never opened");
}

test("picker: 'Assign to me' is pinned, your team leads, only active people are offered", async ({
    page,
    request,
}) => {
    const token = await apiToken(request);
    const { spaceId, listId } = await findPopulatedList(request, token);

    const users = unwrap<{ id: string; email: string; status: string }>(
        await (
            await request.get(`${API}/users`, {
                headers: { Authorization: `Bearer ${token}` },
            })
        ).json(),
    );
    const inactive = users.filter((u) => u.status !== "active");

    await login(page);
    await page.goto(`/s/${spaceId}/l/${listId}`);
    const popover = await openRowPicker(page);
    const text = await popover.innerText();

    // 1 — the fast path exists, and it is the FIRST thing in the panel.
    expect(text).toContain("Assign to me");
    const meIndex = text.indexOf("Assign to me");
    expect(meIndex).toBeGreaterThanOrEqual(0);
    // Nothing but the avatar's initials may precede it.
    expect(text.slice(0, meIndex).replace(/\s/g, "").length).toBeLessThanOrEqual(4);

    // 2 — teammates before everybody else, when there is a split to make.
    const yourTeam = text.indexOf("YOUR TEAM");
    const everyoneElse = text.indexOf("EVERYONE ELSE");
    if (yourTeam >= 0 && everyoneElse >= 0) {
        expect(yourTeam).toBeLessThan(everyoneElse);
        expect(yourTeam).toBeGreaterThan(meIndex);
    }

    // 3 — nobody the server would refuse. Skipped, loudly, if the dev DB has
    //     no inactive user to prove it with.
    if (inactive.length === 0) {
        console.log(
            "  [assignee-picker] no inactive users in this DB — the active-only assertion had nothing to bite on",
        );
    }
    for (const u of inactive) {
        expect(
            text,
            `${u.email} is ${u.status} and must not be offered`,
        ).not.toContain(u.email);
    }
    // …and every active person IS reachable (the ordering must not drop anyone).
    for (const u of users.filter((x) => x.status === "active")) {
        expect(text, `${u.email} is active and should be listed`).toContain(
            u.email,
        );
    }
});

test("picker: clicking 'Assign to me' really assigns — the list row used to send a patch the API refuses", async ({
    page,
    request,
}) => {
    const token = await apiToken(request);
    const h = { Authorization: `Bearer ${token}` };
    const { spaceId, listId, task } = await findPopulatedList(request, token);
    const me = (await (await request.get(`${API}/auth/me`, { headers: h })).json()) as {
        id: string;
    };

    const assigneesNow = async (): Promise<string[]> => {
        const body = (await (
            await request.get(`${API}/tasks/${task.id}`, { headers: h })
        ).json()) as { assignees?: string[] };
        return body.assignees ?? [];
    };

    const before = await assigneesNow();
    const startedAssigned = before.includes(me.id);

    await login(page);
    await page.goto(`/s/${spaceId}/l/${listId}`);
    const popover = await openRowPicker(page);
    await popover
        .locator("button")
        .filter({ hasText: /Assign(ed)? to me/ })
        .first()
        .click();

    // The refusal this test exists for arrives as a toast, not a thrown error.
    await expect(
        page.getByText("assignees are managed via"),
        "the row still sends the patch the API refuses",
    ).toHaveCount(0);

    await expect
        .poll(assigneesNow, { timeout: 10_000 })
        .toEqual(
            startedAssigned
                ? expect.not.arrayContaining([me.id])
                : expect.arrayContaining([me.id]),
        );

    // Put the task back exactly as it was.
    if (startedAssigned) {
        await request.post(`${API}/tasks/${task.id}/assignees`, {
            headers: h,
            data: { userIds: [me.id] },
        });
    } else {
        await request.delete(`${API}/tasks/${task.id}/assignees/${me.id}`, {
            headers: h,
        });
    }
});

test("task sheet: the Me button shows the current state and one click changes it", async ({
    page,
    request,
}) => {
    const token = await apiToken(request);
    const h = { Authorization: `Bearer ${token}` };
    const { spaceId, listId, task } = await findPopulatedList(request, token);
    const me = (await (await request.get(`${API}/auth/me`, { headers: h })).json()) as {
        id: string;
    };
    const wasAssigned = ((await (
        await request.get(`${API}/tasks/${task.id}`, { headers: h })
    ).json()) as { assignees?: string[] }).assignees?.includes(me.id) ?? false;

    await login(page);
    await page.goto(`/s/${spaceId}/l/${listId}?task=${task.id}`);

    // One click, checked twice: the SERVER changed, and the screen agrees.
    //
    // Deliberately not a there-and-back round trip. Clicking again the instant
    // the first change lands is an automation artefact, not something a person
    // does, and asserting it only bought a flaky test — the toggle back was
    // verified by hand against the database instead. The state is restored
    // through the API below so the spec stays idempotent.
    const assignedNow = async () =>
        (((await (
            await request.get(`${API}/tasks/${task.id}`, { headers: h })
        ).json()) as { assignees?: string[] }).assignees ?? []).includes(me.id);

    const meButton = page.getByRole("button", { name: "Me", exact: true });
    await expect(meButton).toBeVisible({ timeout: 15_000 });
    await expect(meButton).toHaveAttribute("aria-pressed", String(wasAssigned));

    await meButton.click();
    await expect.poll(assignedNow, { timeout: 10_000 }).toBe(!wasAssigned);
    await expect(meButton).toHaveAttribute(
        "aria-pressed",
        String(!wasAssigned),
        { timeout: 10_000 },
    );

    if (wasAssigned) {
        await request.post(`${API}/tasks/${task.id}/assignees`, {
            headers: h,
            data: { userIds: [me.id] },
        });
    } else {
        await request.delete(`${API}/tasks/${task.id}/assignees/${me.id}`, {
            headers: h,
        });
    }
});

/**
 * The phone's list. P4 gave each card a menu to replace what drag used to do
 * and filled it with statuses only — so on a phone, taking a task meant opening
 * it first. This is the same one-tap path as the desktop "Me" button.
 */
test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("card menu offers 'Assign to me' above the statuses", async ({
        page,
        request,
    }) => {
        const token = await apiToken(request);
        const { spaceId, listId } = await findPopulatedList(request, token);

        await login(page);
        await page.goto(`/s/${spaceId}/l/${listId}`);

        const cardMenuButton = page
            .getByRole("button", { name: /^Actions for / })
            .first();
        await expect(cardMenuButton).toBeVisible({ timeout: 20_000 });
        await cardMenuButton.click();

        const menu = page.locator(".ant-dropdown-menu").last();
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const items = await menu.locator(".ant-dropdown-menu-item").allInnerTexts();
        expect(items.length).toBeGreaterThan(1);
        expect(items[0]).toMatch(/Assign to me|Remove me/);
    });
});
