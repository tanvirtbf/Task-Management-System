import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * MOBILE REBUILD PLAN — A11: the desktop app must not change.
 *
 * 30% of BeautyBooth still uses this on a desktop and it works today. Every
 * mobile-only phase (P1, P3–P8) must leave it byte-for-byte alone; only P2, the
 * clipping bug-fix phase, is allowed to move desktop pixels — and then only
 * after the diff has been read line by line.
 *
 * Why metrics and not screenshots: this app renders today's date, "8d ago"
 * timestamps and a live activity feed, so pixel baselines would go red every
 * morning for reasons nobody cares about. Instead we snapshot exactly the
 * properties a mobile CSS layer could disturb — font sizes, control heights,
 * shell geometry, and which containers clip their content.
 *
 * Usage:
 *   npx playwright test --project=desktop-guard          → compare to baseline
 *   UPDATE_GUARD=1 npx playwright test --project=desktop-guard → re-baseline
 *                                                          (only after review)
 */

const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";
const API = "http://localhost:5501/api/v1";
const BASELINE = fileURLToPath(new URL("../desktop-guard.baseline.json", import.meta.url));
const UPDATE = process.env.UPDATE_GUARD === "1";

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
    await page.waitForTimeout(1500);
}

/** The properties a mobile-only stylesheet could plausibly leak into. */
async function probe(page: Page) {
    return page.evaluate(() => {
        const px = (v: string) => Math.round(parseFloat(v) || 0);
        const first = (sel: string) => document.querySelector<HTMLElement>(sel);
        const box = (el: HTMLElement | null) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return { h: Math.round(r.height), fontSize: px(st.fontSize), padTop: px(st.paddingTop), padLeft: px(st.paddingLeft) };
        };
        let clipping = 0;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
            if (el.scrollWidth - el.clientWidth <= 16) continue;
            if (!/hidden|clip/.test(getComputedStyle(el).overflowX)) continue;
            if (el.childElementCount === 0) continue;
            clipping++;
        }
        const aside = first("aside");
        const main = first("main");
        const header = first("header");
        return {
            rootFontSize: px(getComputedStyle(document.documentElement).fontSize),
            bodyFontSize: px(getComputedStyle(document.body).fontSize),
            sidebarWidth: aside ? Math.round(aside.getBoundingClientRect().width) : null,
            mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
            topbarHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
            button: box(first(".ant-btn")),
            input: box(first(".ant-input")),
            select: box(first(".ant-select-selector")),
            clippingContainers: clipping,
        };
    });
}

test("A11 — the desktop app is unchanged", async ({ page }) => {
    await login(page);
    const auth = await (
        await page.request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } })
    ).json();
    const h = { Authorization: `Bearer ${auth.access_token}` };
    const spaces = await (await page.request.get(`${API}/spaces`, { headers: h })).json();
    const space = (Array.isArray(spaces) ? spaces : (spaces.data ?? []))[0];
    const lists = await (await page.request.get(`${API}/spaces/${space.id}/lists`, { headers: h })).json();
    const list = (Array.isArray(lists) ? lists : (lists.data ?? []))[0];

    const routes: [string, string][] = [
        ["home", "/"],
        ["inbox", "/inbox"],
        ["search", "/search"],
        ["dept", "/dept"],
        ["settings-profile", "/settings/profile"],
        ["settings-members", "/settings/members"],
        ["eng", "/eng"],
        ["list", `/s/${space.id}/l/${list.id}`],
    ];

    const now: Record<string, unknown> = {};
    for (const [name, url] of routes) {
        await page.goto(url);
        await page.waitForTimeout(2200);
        now[name] = await probe(page);
    }

    if (UPDATE || !fs.existsSync(BASELINE)) {
        fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2));
        console.log(`  [desktop-guard] baseline written (${routes.length} routes) → ${BASELINE}`);
        return;
    }

    const before = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

    /**
     * Compared key by key rather than as one JSON blob, and three keys are
     * compared only when BOTH runs found the control.
     *
     * `button`/`input`/`select` read the FIRST control of that kind on the
     * page, so whether a page has one at all depends on the data behind it.
     * /dept renders its queue from the database: empty the queue and every
     * `.ant-btn` on that route disappears, which turned the blob compare red
     * for a reason that has nothing to do with CSS. (It did exactly that on
     * 2026-08-29, and the same red appeared with the day's code change
     * stashed — a guard that cries wolf is one people learn to ignore.)
     *
     * A control that VANISHES is never evidence of the thing this guard
     * exists to catch — a mobile stylesheet leaking into desktop. A control
     * whose height, font size or padding MOVED is exactly that, and still
     * fails. Everything else — shell geometry, font sizes, the clipping
     * count — is present on every route regardless of data and is compared
     * strictly, as before.
     */
    const DATA_DEPENDENT = ["button", "input", "select"];
    const drift: string[] = [];
    for (const [name] of routes) {
        const a = (before[name] ?? {}) as Record<string, unknown>;
        const b = (now[name] ?? {}) as Record<string, unknown>;
        const keys = Object.keys(a).concat(
            Object.keys(b).filter((k) => !(k in a)),
        );
        const diffs: string[] = [];
        for (const key of keys) {
            if (
                DATA_DEPENDENT.includes(key) &&
                (a[key] == null || b[key] == null)
            ) {
                continue;
            }
            const av = JSON.stringify(a[key]);
            const bv = JSON.stringify(b[key]);
            if (av !== bv) diffs.push(`      ${key}: ${av} → ${bv}`);
        }
        if (diffs.length > 0) drift.push(`  ${name}\n${diffs.join("\n")}`);
    }
    expect(
        drift.join("\n"),
        "desktop layout drifted — if this change is intentional (P2 only), review it then re-run with UPDATE_GUARD=1",
    ).toBe("");
});
