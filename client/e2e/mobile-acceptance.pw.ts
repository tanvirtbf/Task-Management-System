import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * MOBILE REBUILD PLAN — P0 acceptance net (A1–A12).
 *
 * Runs under the `mobile-390` and `mobile-360` projects (see playwright.config.ts).
 * Every test asserts the TARGET state from MOBILE_REBUILD_PLAN.md §4, not today's.
 *
 * ── How this file is meant to be used ───────────────────────────────────────
 * Criteria that today's code cannot meet are listed in NOT_YET below and are
 * marked `test.fail()`, so the suite is GREEN right now. When a phase fixes one,
 * Playwright reports "expected to fail, but passed" — that is the signal to
 * delete the NOT_YET entry, at which point the criterion becomes a permanent
 * regression guard. Never delete an entry without re-running both projects.
 *
 * ⚠️ The pre-existing responsive check in f31-deferred.pw.ts measures
 * `document.scrollingElement.scrollWidth`, which is ALWAYS equal to clientWidth
 * in this app because <main> carries overflow-x:auto. That is why it passes on a
 * broken app. A3 below measures the thing that actually matters instead:
 * content clipped by an overflow:hidden container, unreachable by any gesture.
 */

const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";
const API = "http://localhost:5501/api/v1";
const TAP_MIN = 44; // px — Apple HIG 44pt / Android 48dp
const REPORT = fileURLToPath(new URL("../mobile-baseline.json", import.meta.url));

/** Criteria today's code cannot meet, and the phase that is meant to fix each. */
const NOT_YET: Record<string, string> = {
};

const measured: Record<string, unknown> = {};
function record(id: string, viewport: string, value: unknown) {
    measured[`${id}@${viewport}`] = value;
    console.log(`  [measure] ${id}@${viewport} = ${JSON.stringify(value)}`);
}
test.afterAll(() => {
    if (!Object.keys(measured).length) return;
    let prev: Record<string, unknown> = {};
    try {
        prev = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    } catch {
        /* first run */
    }
    fs.writeFileSync(REPORT, JSON.stringify({ ...prev, ...measured }, null, 2));
});

const vp = (page: Page) => `${page.viewportSize()!.width}x${page.viewportSize()!.height}`;

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // SSE app — never wait for networkidle. Wait for the route change instead.
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
    await page.waitForTimeout(1500);
}

/** Real ids from the API, so the spec never hard-codes demo data. */
let fixture: { spaceId: string; listId: string; taskId: string; taskName: string } | null = null;
async function discover(page: Page) {
    if (fixture) return fixture;
    const ctx = page.request;
    const auth = await (await ctx.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } })).json();
    const h = { Authorization: `Bearer ${auth.access_token}` };
    const spaces = await (await ctx.get(`${API}/spaces`, { headers: h })).json();
    const spaceArr = Array.isArray(spaces) ? spaces : (spaces.data ?? []);
    for (const s of spaceArr) {
        const lr = await (await ctx.get(`${API}/spaces/${s.id}/lists`, { headers: h })).json();
        for (const l of Array.isArray(lr) ? lr : (lr.data ?? [])) {
            const tr = await (await ctx.get(`${API}/lists/${l.id}/tasks?limit=20`, { headers: h })).json();
            const tasks = Array.isArray(tr) ? tr : (tr.data ?? []);
            const named = tasks.find((t: { name?: string }) => (t.name ?? "").length >= 18);
            if (named) {
                fixture = { spaceId: s.id, listId: l.id, taskId: named.id, taskName: named.name };
                return fixture;
            }
        }
    }
    throw new Error("no list with a long-enough task name found — seed demo data first");
}

/* ── measurement helpers ───────────────────────────────────────────────────── */

/** A3: content clipped by an overflow:hidden box = unreachable by ANY gesture. */
async function unreachableClips(page: Page) {
    return page.evaluate(() => {
        const out: { tag: string; cls: string; hiddenPx: number; text: string }[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
            const hidden = el.scrollWidth - el.clientWidth;
            if (hidden <= 16) continue;
            const st = getComputedStyle(el);
            if (!/hidden|clip/.test(st.overflowX)) continue; // it scrolls, so it is reachable
            if (st.textOverflow === "ellipsis") continue; // deliberate text truncation
            if (el.childElementCount === 0) continue; // a text leaf, not a container
            // antd tabs clip their nav strip by design and render a "more"
            // dropdown for what does not fit — verified live at 390px
            // (.ant-tabs-nav-more present and visible), so the tabs are
            // reachable and this is a false positive, not a defect.
            if (el.classList.contains("ant-tabs-nav-wrap")) continue;
            if (el.getBoundingClientRect().width < 80) continue;
            out.push({
                tag: el.tagName.toLowerCase(),
                cls: (typeof el.className === "string" ? el.className : "").slice(0, 44),
                hiddenPx: hidden,
                text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40),
            });
        }
        return out;
    });
}

/** A4: visible interactive controls smaller than the touch minimum. */
async function tinyTargets(page: Page, min: number) {
    return page.evaluate((MIN) => {
        const sel =
            'button,a[href],input,select,textarea,[role="button"],[role="menuitem"],[role="tab"],.ant-select-selector,.ant-checkbox,.ant-switch';
        const bad: { label: string; w: number; h: number }[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (getComputedStyle(el).visibility === "hidden") continue;
            if (r.width < MIN || r.height < MIN) {
                bad.push({
                    label: (el.getAttribute("aria-label") || el.textContent || el.tagName)
                        .trim()
                        .replace(/\s+/g, " ")
                        .slice(0, 28),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                });
            }
        }
        return bad;
    }, min);
}

/** A5: a focusable text field under 16px makes iOS Safari zoom the page in. */
async function smallInputs(page: Page) {
    return page.evaluate(() => {
        const sel =
            "input,textarea,select,.ant-input,.ant-select-selection-search-input,.ant-select-selection-item,.ant-picker-input > input";
        const bad: { tag: string; fs: number; ph: string }[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 16) bad.push({ tag: el.tagName.toLowerCase(), fs, ph: (el.getAttribute("placeholder") || "").slice(0, 24) });
        }
        return bad;
    });
}

/* ── A1 · the task name you cannot read ────────────────────────────────────── */
test("A1 — list view shows at least 20 characters of the task name", async ({ page }) => {
    if (NOT_YET.A1) test.fail();
    await login(page);
    const f = await discover(page);
    await page.goto(`/s/${f.spaceId}/l/${f.listId}`);
    await page.waitForTimeout(3500);
    const m = await page.evaluate((name) => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
            if (el.childElementCount) continue;
            if (!(el.textContent || "").trim().startsWith(name)) continue;
            const r = el.getBoundingClientRect();
            const fs = parseFloat(getComputedStyle(el).fontSize);
            return { renderedPx: Math.round(r.width), fontSize: fs, chars: Math.floor(r.width / (fs * 0.52)) };
        }
        return null;
    }, f.taskName);
    record("A1", vp(page), m);
    expect(m, `task "${f.taskName}" never rendered as a leaf node`).not.toBeNull();
    expect(m!.chars, "characters of the task name actually visible").toBeGreaterThanOrEqual(20);
});
/* ── A2 · can a phone user reach a list at all? ────────────────────────────
   Rewritten in P3. The first version counted `<a href>` elements on Home, which
   only ever described the desktop sidebar tree. The criterion was always "a
   list is reachable in at most three taps"; this now walks that path for real —
   tap Spaces, tap a space, tap a list — and asserts where it lands. It would
   have failed the same way before P3 (the rail had no Spaces door at all), and
   it keeps working whatever the navigation is made of. */
test("A2 — a list is reachable from Home in at most three taps", async ({ page }) => {
    if (NOT_YET.A2) test.fail();
    await login(page);
    await page.goto("/");
    await page.waitForTimeout(2500);

    const taps: string[] = [];
    // 1 — the Spaces destination, however it is presented.
    await page.getByRole("button", { name: "Spaces" }).click({ timeout: 8000 });
    taps.push("Spaces");
    await page.waitForURL("**/spaces", { timeout: 10_000 });
    await page.waitForTimeout(1500);

    // 2 — a space.
    const space = page.locator("main button").first();
    const spaceName = (await space.innerText()).split("\n")[0].trim();
    await space.click({ timeout: 8000 });
    taps.push(spaceName);
    await page.waitForTimeout(1800);

    // 3 — a list inside it.
    const list = page.locator("main button").first();
    const listName = (await list.innerText()).split("\n")[0].trim();
    await list.click({ timeout: 8000 });
    taps.push(listName);
    await page.waitForTimeout(2500);

    const landed = new URL(page.url()).pathname;
    record("A2", vp(page), { taps, landed });
    expect(taps.length, "taps from Home to a list").toBeLessThanOrEqual(3);
    expect(landed, "the third tap lands on a list").toMatch(/^\/s\/[^/]+\/l\/[^/]+/);
});


/* ── A3 · content clipped away with no way to scroll to it ─────────────────── */
test("A3 — no content is clipped beyond reach on any core route", async ({ page }) => {
    if (NOT_YET.A3) test.fail();
    await login(page);
    const f = await discover(page);
    const routes: [string, string][] = [
        ["home", "/"],
        ["inbox", "/inbox"],
        ["dept", "/dept"],
        ["settings-members", "/settings/members"],
        ["on-call", "/eng/on-call"],
        ["list", `/s/${f.spaceId}/l/${f.listId}`],
        ["space-browser", `/s/${f.spaceId}`],
    ];
    const found: Record<string, unknown> = {};
    let total = 0;
    for (const [name, url] of routes) {
        await page.goto(url);
        await page.waitForTimeout(2500);
        const clips = await unreachableClips(page);
        if (clips.length) found[name] = clips;
        total += clips.length;
    }
    record("A3", vp(page), { totalClippedContainers: total, byRoute: found });
    expect(total, "containers hiding content with overflow:hidden and no scroll").toBe(0);
});

/* ── A4 · touch targets ────────────────────────────────────────────────────── */
test("A4 — every control on the task screen meets the 44px touch minimum", async ({ page }) => {
    if (NOT_YET.A4) test.fail();
    await login(page);
    const f = await discover(page);
    await page.goto(`/s/${f.spaceId}/l/${f.listId}?task=${f.taskId}`);
    await page.waitForTimeout(4000);
    const bad = await tinyTargets(page, TAP_MIN);
    record("A4", vp(page), {
        under44: bad.length,
        smallest: bad.slice().sort((a, b) => a.w * a.h - b.w * b.h).slice(0, 5),
    });
    expect(bad.length, `controls under ${TAP_MIN}px on the task detail screen`).toBe(0);
});

/* ── A5 · iOS auto-zoom ────────────────────────────────────────────────────── */
test("A5 — no text field is under 16px (iOS zooms the page in below that)", async ({ page }) => {
    if (NOT_YET.A5) test.fail();
    await login(page);
    const f = await discover(page);
    const routes = ["/", "/search", "/settings/profile", `/s/${f.spaceId}/l/${f.listId}`];
    const all: Record<string, unknown> = {};
    let total = 0;
    for (const url of routes) {
        await page.goto(url);
        await page.waitForTimeout(2500);
        const bad = await smallInputs(page);
        if (bad.length) all[url] = bad;
        total += bad.length;
    }
    record("A5", vp(page), { under16: total, byRoute: all });
    expect(total, "text fields under 16px").toBe(0);
});

/* ── A6 · settings is not a sliver ─────────────────────────────────────────── */
test("A6 — the settings content column is full width, not a sliver", async ({ page }) => {
    if (NOT_YET.A6) test.fail();
    await login(page);
    await page.goto("/settings/profile");
    await page.waitForTimeout(3000);
    const m = await page.evaluate(() => {
        // Measure the content COLUMN, not the heading text inside it — a
        // heading is only as wide as its words, so it never fills its parent
        // and reports a false sliver. The settings layout renders its own
        // <main> inside the shell's, so the innermost one is the column.
        const mains = Array.from(document.querySelectorAll<HTMLElement>("main"));
        const col = mains[mains.length - 1];
        const r = col?.getBoundingClientRect();
        return {
            contentWidth: r ? Math.round(r.width) : null,
            contentLeft: r ? Math.round(r.left) : null,
            viewport: window.innerWidth,
        };
    });
    record("A6", vp(page), m);
    expect(m.contentWidth ?? 0, "settings content column width").toBeGreaterThan(m.viewport * 0.8);
});
/* ── A7 · the calendar route has to render something usable ────────────────
   Rewritten in P7. The first version looked for a seven-column grid at least
   200px wide — which describes the DESKTOP calendar. On a phone that grid
   measured zero, and it was never going to be the answer: 43px per day cannot
   hold a task. U1's conclusion was that grouping by due date *is* the calendar,
   so the phone's calendar route opens the agenda, and this now checks for the
   thing that should actually be there. */
test("A7 — the calendar route renders a usable agenda", async ({ page }) => {
    if (NOT_YET.A7) test.fail();
    await login(page);
    const f = await discover(page);
    await page.goto(`/s/${f.spaceId}/l/${f.listId}/calendar`);
    await page.waitForTimeout(4000);
    const m = await page.evaluate(() => {
        const BUCKETS = /^(overdue|today|tomorrow|next 7 days|later|no date)$/i;
        const headers = Array.from(document.querySelectorAll<HTMLElement>("div"))
            .filter((el) => el.childElementCount <= 1 && BUCKETS.test((el.textContent || "").trim().replace(/\s*\d+$/, "")))
            .map((el) => ({ label: (el.textContent || "").trim(), width: Math.round(el.getBoundingClientRect().width) }));
        const main = document.querySelector("main");
        return {
            agendaHeaders: headers.slice(0, 6),
            headerCount: headers.length,
            surfaceWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
            zeroWidthSurfaces: Array.from(document.querySelectorAll<HTMLElement>("main *"))
                .filter((el) => el.childElementCount > 2 && el.getBoundingClientRect().width < 1).length,
        };
    });
    record("A7", vp(page), m);
    expect(m.headerCount, "due-date group headers — the agenda").toBeGreaterThan(0);
    expect(m.surfaceWidth, "the calendar surface width").toBeGreaterThan(200);
    expect(m.zeroWidthSurfaces, "containers that render at zero width").toBe(0);
});

/* ── A8 · a date picker must not push the screen around ────────────────────
   Rewritten in P7. The first version opened the list's Filter popover — a
   control a phone has not had since P4 replaced that toolbar — so it had been
   failing on a missing button rather than on a picker, which is a check that
   proves nothing. The pickers a phone actually meets are in the task sheet and
   the create sheet; those are what this opens now. */
test("A8 — opening a date picker keeps the viewport and stays on screen", async ({ page }) => {
    if (NOT_YET.A8) test.fail();
    await login(page);
    const f = await discover(page);
    await page.goto(`/s/${f.spaceId}/l/${f.listId}?task=${f.taskId}`);
    await page.waitForTimeout(4000);
    const before = await page.evaluate(() => window.innerWidth);
    // The drawer shows dates as badges and swaps in a DatePicker when you tap
    // one — so there is no .ant-picker to click until after the tap. "Add date"
    // is the stable one: it is there whatever the task's dates are.
    await page.locator(".ant-drawer").getByText("Add date").first().click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
        const p = document.querySelector<HTMLElement>(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)");
        const r = p?.getBoundingClientRect();
        return {
            viewportAfter: window.innerWidth,
            popup: r
                ? {
                      w: Math.round(r.width),
                      panels: p!.querySelectorAll(".ant-picker-panel").length,
                      offLeft: Math.round(Math.max(0, -r.left)),
                      offRight: Math.round(Math.max(0, r.right - window.innerWidth)),
                  }
                : null,
        };
    });
    record("A8", vp(page), { viewportBefore: before, ...m });
    expect(m.viewportAfter, "viewport width after opening a date picker").toBe(before);
    expect(m.popup, "a date picker panel actually opened").not.toBeNull();
    expect(m.popup!.offLeft + m.popup!.offRight, "picker pixels outside the screen").toBe(0);
});


/* ── A9 · Home shows work, not a tower of single numbers ───────────────────── */
test("A9 — Home shows work in the first screenful, not a tower of numbers", async ({ page }) => {
    if (NOT_YET.A9) test.fail();
    await login(page);
    await page.goto("/");
    await page.waitForTimeout(3000);
    const m = await page.evaluate(() => {
        // The criterion is "the first screen shows real work", not "the page is
        // short". Total height was the wrong proxy — a long Home is fine if the
        // work is at the top, and a short one is useless if it is not. So:
        // where does the My Work section start, relative to the first screenful?
        const main = document.querySelector("main");
        const scroller =
            main && main.scrollHeight > main.clientHeight + 4
                ? main
                : document.scrollingElement!;
        const heading = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4"))
            .find((el) => /my work/i.test(el.textContent || ""));
        const r = heading?.getBoundingClientRect();
        return {
            contentHeight: scroller.scrollHeight,
            viewport: scroller.clientHeight,
            screens: +(scroller.scrollHeight / scroller.clientHeight).toFixed(2),
            myWorkTop: r ? Math.round(r.top) : null,
            myWorkInFirstScreen: !!r && r.top < window.innerHeight,
        };
    });
    record("A9", vp(page), m);
    expect(m.myWorkTop, "a My Work section exists on Home").not.toBeNull();
    expect(m.myWorkInFirstScreen, "My Work is visible without scrolling").toBe(true);
});
/* ── A12 · the keyboard must not cover the thing you are typing into ───────
   Rewritten in P3. The first version measured whether the composer was in the
   viewport on arrival — which it never is, mobile shell or not, because it sits
   at the bottom of a long drawer. That measured "is the drawer short", not "can
   you comment".

   What actually matters, and what this now does: scroll to the composer the way
   a user would, shrink the viewport the way a keyboard does, and check the
   composer and its button are both visible AND not hidden behind the fixed
   bottom bar. */
test("A12 — with the keyboard open (proxy), the comment box and its button clear the bottom bar", async ({ page }) => {
    if (NOT_YET.A12) test.fail();
    await login(page);
    const f = await discover(page);
    await page.goto(`/s/${f.spaceId}/l/${f.listId}?task=${f.taskId}`);
    await page.waitForTimeout(4000);

    // Reach the composer the way a thumb would.
    const composer = page.locator(".ant-drawer textarea").first();
    await composer.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await page.waitForTimeout(600);

    // Playwright cannot raise a real software keyboard, so shrink the viewport
    // by roughly what one eats. The layout question is identical.
    const full = page.viewportSize()!;
    await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.45) });
    await page.waitForTimeout(400);
    await composer.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
        const ta = document.querySelector<HTMLElement>(".ant-drawer textarea");
        const btn = Array.from(document.querySelectorAll<HTMLElement>(".ant-drawer button")).find((b) =>
            /comment|send|post/i.test(b.innerText || ""),
        );
        // "Is it above the bar" was the wrong question — an open drawer paints
        // over the bar, so a control can be below the bar's line and still
        // perfectly tappable. Ask what a thumb would actually hit.
        const hits = (el: HTMLElement | null | undefined) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(
                Math.round(r.left + r.width / 2),
                Math.round(r.top + r.height / 2),
            );
            return !!top && (el === top || el.contains(top) || top.contains(el));
        };
        const box = (el: HTMLElement | null | undefined) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
                top: Math.round(r.top),
                bottom: Math.round(r.bottom),
                inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
                tappable: hits(el),
            };
        };
        return {
            composer: box(ta),
            sendButton: box(btn),
            viewportHeight: window.innerHeight,
        };
    });
    await page.setViewportSize(full);
    record("A12", vp(page), m);
    expect(m.composer, "a comment composer exists in the task drawer").not.toBeNull();
    expect(m.composer!.inViewport, "composer visible with the keyboard open").toBe(true);
    expect(m.composer!.tappable, "composer is what a tap at its centre would hit").toBe(true);
    expect(m.sendButton?.inViewport ?? false, "send button visible with the keyboard open").toBe(true);
    expect(m.sendButton?.tappable ?? false, "send button is what a tap at its centre would hit").toBe(true);
});

/* ── A4a · P1's own gate: every antd control meets the touch minimum ───────
   A4 (every control on the task screen) belongs to P4, which rebuilds the
   drawer, and to P3, which deletes the sidebar rail — enlarging those in the
   CSS layer would be churn. What P1 owns is the shared antd control set, which
   every phase inherits. */
test("A4a — every antd control meets the 44px touch minimum", async ({ page }) => {
    if (NOT_YET.A4a) test.fail();
    await login(page);
    const f = await discover(page);
    const routes: [string, string][] = [
        ["task-drawer", `/s/${f.spaceId}/l/${f.listId}?task=${f.taskId}`],
        ["settings-profile", "/settings/profile"],
        ["inbox", "/inbox"],
    ];
    const bad: Record<string, unknown> = {};
    let total = 0;
    for (const [name, url] of routes) {
        await page.goto(url);
        await page.waitForTimeout(3000);
        const found = await page.evaluate((MIN) => {
            const sel = ".ant-btn, .ant-input, .ant-input-affix-wrapper, .ant-select-selector, .ant-picker, .ant-dropdown-menu-item, .ant-menu-item";
            const out: { cls: string; label: string; w: number; h: number }[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                if (getComputedStyle(el).visibility === "hidden") continue;
                if (r.height >= MIN) continue;
                out.push({
                    cls: (typeof el.className === "string" ? el.className : "").slice(0, 40),
                    label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 22),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                });
            }
            return out;
        }, TAP_MIN);
        if (found.length) bad[name] = found;
        total += found.length;
    }
    record("A4a", vp(page), { antdControlsUnder44: total, byRoute: bad });
    expect(total, "antd controls shorter than 44px").toBe(0);
});

/* ── A13 · the list has to survive real BeautyBooth volume ─────────────────── */
test("A13 — a 500-task list renders and scrolls on a phone", async ({ page }) => {
    if (NOT_YET.A13) test.fail();
    await login(page);
    const f = await discover(page);
    // Clone one real task 500x and intercept the endpoint: the client sees a big
    // list, the database sees nothing. Zero writes.
    const auth = await (
        await page.request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } })
    ).json();
    const seed = await (
        await page.request.get(`${API}/lists/${f.listId}/tasks?limit=5`, {
            headers: { Authorization: `Bearer ${auth.access_token}` },
        })
    ).json();
    const template = (Array.isArray(seed) ? seed : (seed.data ?? []))[0];
    expect(template, "a seed task to clone").toBeTruthy();

    const N = 500;
    // The FIRST card, not the last: a virtualised list deliberately keeps the
    // last row out of the DOM until you scroll to it, so waiting for it would
    // measure the timeout rather than the render.
    const firstName = "Complaint: cracked serum bottle 1000";
    await page.route(`**/lists/${f.listId}/tasks*`, async (route) => {
        const data = Array.from({ length: N }, (_, i) => ({
            ...template,
            id: `t-scale-${String(i).padStart(5, "0")}`,
            task_number: 10000 + i,
            custom_id: null,
            name: `Complaint: cracked serum bottle ${1000 + i}`,
        }));
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data, pagination: { nextCursor: null, hasMore: false } }),
        });
    });

    const t0 = Date.now();
    await page.goto(`/s/${f.spaceId}/l/${f.listId}`);
    await page
        .locator(`text=${firstName}`)
        .first()
        .waitFor({ state: "visible", timeout: 40_000 })
        .catch(() => {
            /* a miss shows up in the numbers below */
        });
    const renderMs = Date.now() - t0;
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => ({
        domNodes: document.getElementsByTagName("*").length,
        pageHeight: document.body.scrollHeight,
    }));
    const scrollMs = await page.evaluate(async () => {
        const s = performance.now();
        for (let i = 0; i < 20; i++) {
            window.scrollBy(0, 400);
            await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        return Math.round(performance.now() - s);
    });
    record("A13", vp(page), { tasks: N, renderMs, ...m, scroll20FramesMs: scrollMs });
    expect(renderMs, "ms until the first card is on screen").toBeLessThan(6000);
    // A virtualised list keeps the DOM roughly constant however many rows exist.
    expect(m.domNodes, "DOM nodes for 500 rows — a virtualised list stays near 2k").toBeLessThan(6000);
    expect(scrollMs, "ms for 20 scroll frames (320ms would be 60fps)").toBeLessThan(1200);
});

/* ── A14 · a phone must not be told to do something a phone cannot do ──────
   Added in P7, from that phase's gate. The app used to instruct a thumb to
   "drag to schedule" on the calendar, "Drag files here" in the task sheet, and
   to press ⌘K on a device with no keyboard. Each of those is the same defect in
   different words: copy describing an input the hardware does not have.

   Cheap to check, and it catches the class rather than the three instances —
   any future "right-click", "hover" or "drag" that lands on a phone screen
   fails here. */
const IMPOSSIBLE = /\bdrag\b|drag[- ]and[- ]drop|right[- ]click|\bhover\b|⌘K|Ctrl\+K|Shift\+Enter/i;

test("A14 — no mobile copy asks for a gesture a phone does not have", async ({ page }) => {
    if (NOT_YET.A14) test.fail();
    await login(page);
    const f = await discover(page);
    const routes: [string, string][] = [
        ["home", "/"],
        ["list", `/s/${f.spaceId}/l/${f.listId}`],
        ["board", `/s/${f.spaceId}/l/${f.listId}/board`],
        ["calendar", `/s/${f.spaceId}/l/${f.listId}/calendar`],
        ["task", `/s/${f.spaceId}/l/${f.listId}?task=${f.taskId}`],
        ["search", "/search"],
        ["inbox", "/inbox"],
        ["spaces", "/spaces"],
    ];
    const found: Record<string, string[]> = {};
    let total = 0;
    for (const [name, url] of routes) {
        await page.goto(url);
        await page.waitForTimeout(2500);
        const hits = await page.evaluate((src) => {
            const re = new RegExp(src, "i");
            const out: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
                if (el.childElementCount) continue;
                const t = (el.textContent || "").trim();
                if (t && t.length < 160 && re.test(t)) out.push(t.slice(0, 70));
            }
            for (const el of Array.from(document.querySelectorAll("[aria-label],[title],[placeholder]"))) {
                const t = [
                    el.getAttribute("aria-label"),
                    el.getAttribute("title"),
                    el.getAttribute("placeholder"),
                ]
                    .filter(Boolean)
                    .join(" ");
                if (re.test(t)) out.push(`attr: ${t.slice(0, 70)}`);
            }
            return [...new Set(out)];
        }, IMPOSSIBLE.source);
        if (hits.length) found[name] = hits;
        total += hits.length;
    }
    record("A14", vp(page), { impossibleCopy: total, byRoute: found });
    expect(total, "phrases telling a thumb to drag, hover, right-click or press a key").toBe(0);
});
