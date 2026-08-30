import { test, expect, request, type Page } from "@playwright/test";
import { removeTasksByName } from "./fixtures";

/**
 * Team-access P10 — the three office rules, end to end in a real browser,
 * against the RUNNING dev stack (:5173 + :5501, DISABLE_RATE_LIMIT=1) seeded
 * by the updated demo seed (tightened visibility + the mid-negotiation
 * cross-team request).
 *
 *   1. R1.3 — a member's sidebar holds their own team(s), nothing else.
 *   2. R2.2 — a same-team non-assignee gets the view-only drawer.
 *   3. R1.4 — the assignee picker warns BEFORE a cross-team pick, and the
 *             drawer shows the pending negotiation.
 *   4. R1.4/R1.5 — the receiver accepts from the Inbox "Requests" tab, and
 *             the task then OPENS for them (B1) even though its list is
 *             outside their sidebar (B5's drawer-on-blank). Runs LAST —
 *             it consumes the seeded pending request.
 */

const PASSWORD = "Owner@12345";

// The live SSE notification stream keeps the network permanently busy, so
// `networkidle` NEVER settles — wait for a concrete post-login landmark
// instead. Vite cold-compiles each page on first visit, so the first test
// absorbs the warm-up: give the whole file room.
test.setTimeout(90_000);

async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(email);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 30_000,
    });
    await expect(
        page.getByRole("button", { name: "Workspace menu" }),
    ).toBeVisible({ timeout: 30_000 });
}

/**
 * Resolve a seeded task's ids over the API (the seed generates random ids),
 * so the drawer can open via the `?task=<id>` URL param — the established
 * mechanism every affordance uses (tasks-views.pw.ts).
 */
async function findTask(
    email: string,
    listName: string,
    taskName: string,
): Promise<{ spaceId: string; listId: string; taskId: string }> {
    const api = await request.newContext({
        baseURL: "http://localhost:5501",
    });
    const loginRes = await api.post("/api/v1/auth/login", {
        data: { email, password: PASSWORD },
    });
    const token = (await loginRes.json()).access_token as string;
    const auth = { Authorization: `Bearer ${token}` };
    const spaces = (await (
        await api.get("/api/v1/spaces", { headers: auth })
    ).json()) as { data: { id: string }[] };
    for (const sp of spaces.data) {
        const lists = (await (
            await api.get(`/api/v1/spaces/${sp.id}/lists`, { headers: auth })
        ).json()) as { data: { id: string; name: string }[] };
        const list = lists.data.find((l) => l.name === listName);
        if (!list) continue;
        const tasks = (await (
            await api.get(`/api/v1/lists/${list.id}/tasks?limit=200`, {
                headers: auth,
            })
        ).json()) as { data: { id: string; name: string }[] };
        const task = tasks.data.find((t) => t.name === taskName);
        if (task) {
            await api.dispose();
            return { spaceId: sp.id, listId: list.id, taskId: task.id };
        }
    }
    await api.dispose();
    throw new Error(`task not found: ${taskName}`);
}

test("R1.3: a member's sidebar shows their own team(s) and nothing else", async ({
    page,
}) => {
    // Sumaiya belongs to Marketing AND Social (the two-team case, Q1).
    // Space entries are BUTTONS in the tree — the static "Engineering" NAV
    // GROUP header (Eng Home / Sprint Board links) is a plain div and must
    // not be confused with the Engineering SPACE.
    await login(page, "sumaiya@beautybooth.com.bd");
    const aside = page.locator("aside");
    await expect(
        aside.getByRole("button", { name: "Marketing", exact: true }),
    ).toBeVisible();
    await expect(
        aside.getByRole("button", {
            name: "Social Media & Content",
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        aside.getByRole("button", { name: "Engineering", exact: true }),
    ).toHaveCount(0);
    await expect(
        aside.getByRole("button", { name: "Customer Service", exact: true }),
    ).toHaveCount(0);
    await expect(
        aside.getByRole("button", {
            name: "Orders & Fulfillment",
            exact: true,
        }),
    ).toHaveCount(0);
});

test("R2.2: a same-team non-assignee sees the view-only drawer", async ({
    page,
}) => {
    // "Write Eid email campaign copy" is Nusrat's task; Sumaiya is same-team
    // but neither assignee nor creator — she may read, not touch.
    const t = await findTask(
        "sumaiya@beautybooth.com.bd",
        "Eid Campaign 2026",
        "Write Eid email campaign copy",
    );
    await login(page, "sumaiya@beautybooth.com.bd");
    await page.goto(`/s/${t.spaceId}/l/${t.listId}?task=${t.taskId}`);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await expect(
        page.getByText(/View only — only assignees, the creator or/),
    ).toBeVisible({ timeout: 15_000 });
});

// ─── a per-run PROBE negotiation (the suite must be re-runnable) ─────────────
// The seed's mid-query request is for HUMAN demos — a previous e2e run may
// already have consumed it. Tests 3+4 therefore build their OWN: Nusrat
// creates a fresh Marketing task, asks for Jhankar (→ pending request),
// Jhankar queries it over the API; the UI then shows the negotiation, and
// test 4 accepts it. Cleanup hard-deletes the probe task (cascades the
// request), so demo data stays pristine run after run.
const PROBE_NAME = `E2E approval probe ${Date.now()}`;
let probe: {
    spaceId: string;
    listId: string;
    taskId: string;
    requestId: string;
} | null = null;

async function apiClient(email: string) {
    const api = await request.newContext({
        baseURL: "http://localhost:5501",
    });
    const loginRes = await api.post("/api/v1/auth/login", {
        data: { email, password: PASSWORD },
    });
    const token = (await loginRes.json()).access_token as string;
    return { api, auth: { Authorization: `Bearer ${token}` } };
}

test.beforeAll(async () => {
    const nusrat = await apiClient("nusrat@beautybooth.com.bd");
    const eid = await findTask(
        "nusrat@beautybooth.com.bd",
        "Eid Campaign 2026",
        "Set up 25% Eid discount codes",
    );
    const created = (await (
        await nusrat.api.post("/api/v1/tasks", {
            headers: nusrat.auth,
            data: { primary_list_id: eid.listId, name: PROBE_NAME },
        })
    ).json()) as { id: string };
    // Jhankar (Engineering) is cross-team for Marketing → a pending request.
    const jhankar = await apiClient("jhankar@beautybooth.com.bd");
    const jhankarId = (
        (await (
            await jhankar.api.get("/api/v1/auth/me", {
                headers: jhankar.auth,
            })
        ).json()) as { id: string }
    ).id;
    await nusrat.api.post(`/api/v1/tasks/${created.id}/assignees`, {
        headers: nusrat.auth,
        data: { user_ids: [jhankarId] },
    });
    const box = (await (
        await jhankar.api.get("/api/v1/assignment-requests", {
            headers: jhankar.auth,
        })
    ).json()) as { data: { id: string; task: { id: string } }[] };
    const req = box.data.find((r) => r.task.id === created.id);
    if (!req) throw new Error("probe request was not created");
    await jhankar.api.post(
        `/api/v1/assignment-requests/${req.id}/query`,
        {
            headers: jhankar.auth,
            data: { note: "need 2 more days", proposed_due_date: null },
        },
    );
    probe = {
        spaceId: eid.spaceId,
        listId: eid.listId,
        taskId: created.id,
        requestId: req.id,
    };
    await nusrat.api.dispose();
    await jhankar.api.dispose();
});

test.afterAll(() => {
    // DELETE /tasks archives rather than removes, so the probe row survived
    // every run. Removed for real, or the dev DB never returns to baseline.
    removeTasksByName(PROBE_NAME);
});

test("R1.4: the drawer shows the pending negotiation, and the picker warns before a cross-team pick", async ({
    page,
}) => {
    if (!probe) throw new Error("probe missing");
    await login(page, "nusrat@beautybooth.com.bd");
    await page.goto(`/s/${probe.spaceId}/l/${probe.listId}?task=${probe.taskId}`);
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible({ timeout: 15_000 });

    // The approval panel, with the receiver's query, right in the drawer.
    await expect(drawer.getByText("Assignment approval")).toBeVisible({
        timeout: 15_000,
    });
    await expect(drawer.getByText(/need 2 more days/)).toBeVisible();
    await expect(drawer.getByText("Pending approval").first()).toBeVisible();

    // The picker: searching a cross-team person shows the warning BEFORE
    // any commit (Q11 mirrored client-side). Post-switch, Nusrat cannot see
    // CS's roster in the teams directory, so the warning gracefully names
    // "their" team instead of "Customer Service" — either wording is the
    // required honesty.
    await drawer.getByLabel("Edit assignees").first().click();
    await page.getByPlaceholder("Search people...").fill("Arif");
    await expect(
        page.getByText(/Cross-team — will need .* approval/),
    ).toBeVisible();
});

test("R1.4/R1.5: the receiver accepts from the Inbox and the task opens for them (B1 + B5)", async ({
    page,
}) => {
    if (!probe) throw new Error("probe missing");
    // Jhankar — Engineering member, the probe request's target. Marketing's
    // list is NOT in his sidebar; after accepting, the task must still open.
    await login(page, "jhankar@beautybooth.com.bd");
    await page.goto("/inbox");
    await page.getByRole("button", { name: /^Requests/ }).click();

    // The card root = the SMALLEST div holding both the probe task's name
    // and its Accept button.
    const card = page
        .locator("div")
        .filter({ has: page.getByText(PROBE_NAME, { exact: true }) })
        .filter({
            has: page.getByRole("button", { name: "Accept", exact: true }),
        })
        .last();
    await expect(card.getByText("Pending approval")).toBeVisible({
        timeout: 15_000,
    });
    await expect(card.getByText(/need 2 more days/)).toBeVisible();

    await card.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByText("Assignment accepted").first()).toBeVisible({
        timeout: 15_000,
    });

    // B1 + B5: the deep-link now opens the task — as a drawer right on
    // /t/:id, because the owning list is outside his sidebar.
    await page.goto(`/t/${probe.taskId}`);
    await expect(page.getByText(PROBE_NAME).first()).toBeVisible({
        timeout: 20_000,
    });
    // He is the assignee now — the view-only bar must NOT appear.
    await expect(
        page.getByText(/View only — only assignees/),
    ).toHaveCount(0);
});
