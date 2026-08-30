import { test, expect, type Page } from "@playwright/test";
import { removeSpacesLike, removeNotificationsLike } from "./fixtures";
import { execFileSync } from "node:child_process";

/**
 * Dept Review V1 — P30 committed E2E: the full department-review loop in one
 * spec (per DEPARTMENT_REVIEW_PLAN.md Stage G).
 *
 *   assign (owner sets the head on the space page)
 *   → review (head approves + flags with a note from /dept)
 *   → flag notification (assignee inbox, note visible)
 *   → report (generated through the job's shared `generateFor` path — the
 *     weekly job itself is token-gated + CLI-proven, not browser-reachable)
 *   → HR ack (owner deep-links from the report_ready notification, Mark seen).
 *
 * Self-seeding against the QA stack (same contract as auth.pw.ts): API for
 * fixtures, SQL only to backdate activity into the LAST COMPLETED Dhaka week
 * so the report carries real numbers. Unique dept name per run; the space is
 * archived in afterAll (reports stay listed by design — P28 lock).
 */

const MYSQL = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
/**
 * The database the RUNNING API serves. Hardcoded to `taskmanagement_qa` before
 * KI-4 — a database the dev API never writes — so every "the row is in the DB"
 * assertion here was reading a different database from the one under test.
 * Override with E2E_DB when pointing the API at another one.
 */
const DB = process.env.E2E_DB ?? "taskmanagement";
const sql = (q: string) =>
    execFileSync(
        MYSQL,
        ["-uroot", "-proot", DB, "-N", "-e", q],
        { encoding: "utf8" },
    ).trim();
const API = "http://localhost:5501/api/v1";

const OWNER = "owner@company.local", OPASS = "Owner@12345";
/**
 * KI-4: this was `member@qa.local` / `Member@12345`, a login that only existed
 * in a hand-seeded `taskmanagement_qa` database — against the demo seed the
 * spec's very first API call 401'd. An existing active member is resolved
 * instead, and every seeded account shares the same password.
 *
 * Note on §A rule 4 / rule 11: the resolved account is on the staff domain,
 * and that is safe HERE because the head is only ever the ACTOR. The three
 * tasks under review are assigned to the OWNER, so the `task_reviewed` fanout
 * (and any mail it triggers) goes to `owner@company.local`, never to staff.
 */
let HEAD = "";
const HPASS = "Owner@12345";
const DEPT = `Dept E2E ${Date.now().toString().slice(-6)}`;
const FLAG_NOTE = "Second pass needed - the export is low-res.";

// ─── Dhaka week math (fixed +06:00, no DST — mirrors utils/dhakaTime.ts) ─────
const DAY = 86_400_000;
const lastWeekMonday = (): string => {
    const dhakaNow = new Date(Date.now() + 6 * 3_600_000);
    const sinceMonday = (dhakaNow.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const thisMonday = new Date(dhakaNow.getTime() - sinceMonday * DAY);
    return new Date(thisMonday.getTime() - 7 * DAY).toISOString().slice(0, 10);
};
const addDays = (ymd: string, n: number): string =>
    new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY)
        .toISOString()
        .slice(0, 10);

const LW = lastWeekMonday();
const DONE_AT = `${addDays(LW, 3)} 04:00:00`; // Thu 10:00 Dhaka — in-window
const REVIEWED_AT = `${addDays(LW, 4)} 05:00:00`; // Fri 11:00 Dhaka

let ip = 120;
const jfetch = async (
    path: string,
    opts: { method?: string; token?: string; body?: unknown } = {},
) => {
    const r = await fetch(`${API}${path}`, {
        method: opts.method ?? "GET",
        headers: {
            "content-type": "application/json",
            ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
            "x-forwarded-for": `93.0.0.${ip++}`,
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await r.text();
    if (r.status >= 400)
        throw new Error(`${opts.method ?? "GET"} ${path} → ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
};

async function loginUI(page: Page, email: string, pass: string) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(email);
    await page.getByPlaceholder("Enter your password").fill(pass);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 20_000,
    });
}

let oTok = "", hTok = "";
let ownerId = "", headName = "";
let spaceId = "", t1 = "", t2 = "";

test.beforeAll(async () => {
    const oLogin = await jfetch("/auth/login", {
        method: "POST", body: { email: OWNER, password: OPASS },
    });
    oTok = oLogin.access_token;
    ownerId = oLogin.user.id;
    const people = await jfetch("/users", { token: oTok });
    const roster = (Array.isArray(people) ? people : (people.data ?? [])) as {
        email: string;
        role: string;
        status: string;
    }[];
    const candidate = roster.find(
        (u) =>
            u.status === "active" && u.role === "member" && u.email !== OWNER,
    );
    if (!candidate) {
        throw new Error("no active member to act as the department head");
    }
    HEAD = candidate.email;

    const hLogin = await jfetch("/auth/login", {
        method: "POST", body: { email: HEAD, password: HPASS },
    });
    hTok = hLogin.access_token;
    headName = `${hLogin.user.first_name} ${hLogin.user.last_name}`;

    // Dept + list + 3 tasks assigned to the OWNER (assignee ≠ head so the
    // task_reviewed fanout actually fires — self-reviews are skipped).
    const space = await jfetch("/spaces", {
        method: "POST", token: oTok, body: { name: DEPT },
    });
    spaceId = space.id;
    const list = await jfetch("/lists", {
        method: "POST", token: oTok, body: { space_id: spaceId, name: "Sprint" },
    });
    const statuses = (await jfetch(`/lists/${list.id}/statuses`, {
        token: oTok,
    })) as { id: string; status_group: string }[];
    const done = statuses.find((s) =>
        ["done", "closed"].includes(s.status_group),
    );
    if (!done) throw new Error("default list has no done-group status");

    const mk = async (name: string, due: string) => {
        const t = await jfetch("/tasks", {
            method: "POST", token: oTok,
            body: { primary_list_id: list.id, name, due_date: due },
        });
        await jfetch(`/tasks/${t.id}/assignees`, {
            method: "POST", token: oTok, body: { user_ids: [ownerId] },
        });
        return t.id as string;
    };
    t1 = await mk("Landing page refresh", addDays(LW, 4)); // done on time
    t2 = await mk("Catalog shoot retouch", addDays(LW, 1)); // done LATE
    await mk("Q3 campaign brief", addDays(LW, 5)); // open + overdue
    await jfetch(`/tasks/${t1}`, {
        method: "PATCH", token: oTok, body: { status_id: done.id },
    });
    await jfetch(`/tasks/${t2}`, {
        method: "PATCH", token: oTok, body: { status_id: done.id },
    });
    sql(
        `UPDATE tasks SET completed_at='${DONE_AT}' WHERE id IN ('${t1}','${t2}')`,
    );
});

test.afterAll(async () => {
    // Tidy the QA workspace; the dept's reports stay listed (P28 lock).
    if (spaceId && oTok)
        await jfetch(`/spaces/${spaceId}/archive`, {
            method: "POST", token: oTok,
        }).catch(() => undefined);
});

test.afterAll(() => {
    // The department Space, its List and the three review tasks all
    // survived every run: DELETE /tasks only archives, and a Space that has
    // been reported on refuses to drop while department_reports points at
    // it. Swept for real so the phase can end at the dev-DB baseline.
    removeSpacesLike("Dept E2E %");
    // the weekly report fans a report_ready row out to four people; those point
    // at the REPORT, so sweeping the Space does not reach them
    removeNotificationsLike("%Dept E2E %");
});

test.describe.configure({ mode: "serial" });

test("owner assigns the department head from the space page", async ({
    browser,
}) => {
    const page = await (await browser.newContext()).newPage();
    await loginUI(page, OWNER, OPASS);
    await page.goto(`/s/${spaceId}`);

    const card = page.getByTestId("dept-head-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    // antd6: open via the combobox role; options render in a body portal.
    await card.getByRole("combobox").click();
    await page
        .locator(".ant-select-item-option", { hasText: headName })
        .first()
        .click();
    await expect(card.getByText(headName)).toBeVisible({ timeout: 10_000 });
    await page.close();
});

test("head reviews from /dept: approve one, flag one with a note", async ({
    browser,
}) => {
    const page = await (await browser.newContext()).newPage();
    await loginUI(page, HEAD, HPASS);
    await page.goto(`/dept?space=${spaceId}`);

    const queue = page.getByTestId("dept-queue");
    await expect(queue).toBeVisible({ timeout: 15_000 });
    const rows = page.getByTestId("dept-queue-row");
    await expect(rows).toHaveCount(2, { timeout: 15_000 }); // t1 + t2 need review

    // Approve t1 — the row leaves "Needs review" (no optimistic cache).
    await rows
        .filter({ hasText: "Landing page refresh" })
        .getByRole("button", { name: "Approve" })
        .click();
    await expect(rows).toHaveCount(1, { timeout: 15_000 });

    // Flag t2 with the note (modal, ≤500 chars).
    await rows
        .filter({ hasText: "Catalog shoot retouch" })
        .getByRole("button", { name: "Flag" })
        .click();
    await page.locator(".ant-modal textarea").fill(FLAG_NOTE);
    await page.getByRole("button", { name: "Flag task" }).click();
    await expect(rows).toHaveCount(0, { timeout: 15_000 });

    // The Flagged tab now carries t2.
    await page.getByRole("tab", { name: /Flagged/ }).click();
    await expect(
        page.getByTestId("dept-queue-row").filter({
            hasText: "Catalog shoot retouch",
        }),
    ).toBeVisible({ timeout: 15_000 });
    await page.close();

    // Backdate the just-made reviews into the report week, then generate
    // through the shared job path (as the head).
    sql(
        `UPDATE task_reviews SET created_at='${REVIEWED_AT}' WHERE task_id IN ('${t1}','${t2}')`,
    );
    sql(
        `UPDATE tasks SET reviewed_at='${REVIEWED_AT}' WHERE id IN ('${t1}','${t2}')`,
    );
    const report = await jfetch("/reports/generate", {
        method: "POST", token: hTok, body: { space_id: spaceId },
    });
    const tot = report.payload.totals;
    expect(report.week_start).toBe(LW);
    expect(tot.completed).toBe(2);
    expect(tot.completed_late).toBe(1);
    expect(tot.approved).toBe(1);
    expect(tot.flagged).toBe(1);
    expect(tot.overdue_now).toBe(1);
});

test("assignee sees the flag note; HR deep-links from report_ready and acks", async ({
    browser,
}) => {
    const page = await (await browser.newContext()).newPage();
    await loginUI(page, OWNER, OPASS);

    await page.goto("/inbox");
    // The flag's note travels in the task_reviewed notification body.
    await expect(page.getByText(FLAG_NOTE).first()).toBeVisible({
        timeout: 15_000,
    });

    // report_ready → deep-link → detail (title text is unique to this dept).
    await page.getByText(`Weekly report ready: ${DEPT}`).first().click();
    await page.waitForURL(/\/reports\//, { timeout: 15_000 });
    await expect(
        page.getByRole("heading", { name: `${DEPT} — weekly report` }),
    ).toBeVisible();
    await expect(page.getByText("Flags this week (1)")).toBeVisible();
    await expect(page.getByText(FLAG_NOTE)).toBeVisible();

    // HR ack: Mark seen → Seen chip, button gone (first-wins, idempotent).
    await page.getByTestId("mark-seen-btn").click();
    await expect(
        page.locator(".ant-tag", { hasText: "Seen by" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("mark-seen-btn")).toHaveCount(0);
    await page.close();
});
