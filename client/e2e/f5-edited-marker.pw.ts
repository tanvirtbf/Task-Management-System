import { test, expect, type Page } from "@playwright/test";

/**
 * F5 (ISS-063b) — an edited comment must SAY it was edited.
 *
 * `edited_at` was on the wire all along; no component rendered it, so a comment
 * could be quietly rewritten inside its 15-minute window with nothing shown to
 * readers. This spec builds its own fixture through the real API (:5501): a
 * task with two comments, one of them edited, then asserts the drawer shows
 * exactly one "(edited)" marker — on the edited comment, not its neighbour —
 * with the full timestamp in the hover title.
 *
 * Self-contained: no mysql CLI, no hardcoded ids; cleans its task up after.
 */

const API = "http://localhost:5501/api/v1";
const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

let token = "";
let taskId = "";
let listUrl = "";

const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(API + path, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    try {
        return { status: res.status, body: JSON.parse(text) };
    } catch {
        return { status: res.status, body: text };
    }
};

test.beforeAll(async () => {
    const login = await fetch(API + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    token = (await login.json()).access_token;
    expect(token).toBeTruthy();

    // First unarchived list + its space, resolved through the API (seed-proof).
    const spaces = (await api("GET", "/spaces")).body;
    const spaceRows = Array.isArray(spaces) ? spaces : (spaces.data ?? []);
    let list: { id: string; space_id: string } | undefined;
    for (const sp of spaceRows) {
        const lists = (await api("GET", `/spaces/${sp.id}/lists`)).body;
        const rows = Array.isArray(lists) ? lists : (lists.data ?? []);
        if (rows.length) {
            list = { id: rows[0].id, space_id: sp.id };
            break;
        }
    }
    expect(list, "a demo list to host the fixture task").toBeTruthy();
    listUrl = `/s/${list!.space_id}/l/${list!.id}`;

    const task = await api("POST", "/tasks", {
        primary_list_id: list!.id,
        name: "F5X edited-marker task",
    });
    taskId = task.body.id;
    expect(taskId).toBeTruthy();

    const plain = await api("POST", `/tasks/${taskId}/comments`, {
        body: "F5X untouched comment",
    });
    expect(plain.status).toBe(201);

    const edited = await api("POST", `/tasks/${taskId}/comments`, {
        body: "F5X original wording",
    });
    expect(edited.status).toBe(201);
    const patch = await api("PATCH", `/comments/${edited.body.id}`, {
        body: "F5X rewritten wording",
    });
    expect(patch.status).toBe(200);
    expect(patch.body.edited_at).toBeTruthy();
});

test.afterAll(async () => {
    if (taskId) await api("DELETE", `/tasks/${taskId}?hard=true`);
});

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 20_000,
    });
}

test("the drawer marks the edited comment — and only that one", async ({
    page,
}) => {
    await login(page);
    await page.goto(`${listUrl}?task=${taskId}`);

    // Both comments render.
    await expect(page.getByText("F5X rewritten wording")).toBeVisible({
        timeout: 15_000,
    });
    await expect(page.getByText("F5X untouched comment")).toBeVisible();

    // Exactly ONE "(edited)" marker, carrying the full timestamp as its title.
    const markers = page.getByText("(edited)", { exact: true });
    await expect(markers).toHaveCount(1);
    await expect(markers.first()).toBeVisible();
    await expect(markers.first()).toHaveAttribute("title", /^Edited /);

    await page.screenshot({
        path: "../fixing/evidence/F05/edited-marker.png",
        fullPage: false,
    });
});
