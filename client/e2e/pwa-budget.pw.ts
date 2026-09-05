import { test, expect, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";

/**
 * P11 §5 — the PWA, and the first-load budget as a TEST rather than a memory.
 *
 * The mobile rebuild landed Home at 470 KB gz and 1.68 s to usable on 4G, and
 * the plan says to re-measure and fail past 500 KB gz. A number in a document
 * is not a budget — it is a number somebody wrote down once. This measures what
 * the browser actually pulled before the app was usable, so the next person who
 * adds an eager import finds out from a red test instead of from a phone.
 *
 * ── how the size is obtained ────────────────────────────────────────────────
 * From the assets the page really requested, not from the build log: the build
 * log lists every chunk including the lazy ones nobody downloads on first
 * paint, which flatters or damns the number depending on how you squint.
 *
 * And gzipped HERE rather than trusted from the wire. `response.body()` hands
 * back DECOMPRESSED bytes, so summing it reports ~1,527 KB for a shell that is
 * 470 KB gz — a number three times the budget that means nothing. Whether the
 * test server happens to compress is also not the product's business. Gzipping
 * the bodies makes the measurement match the metric the plan actually set, and
 * makes it independent of how this particular static server is configured.
 *
 * Runs against whatever `E2E_BASE_URL` points at. Only meaningful against a
 * SERVED PRODUCTION BUILD — the dev server ships unminified modules and would
 * report a number ten times larger — so it skips itself on the Vite origin
 * rather than reporting a false failure.
 */

const PASSWORD = "Owner@12345";
const EMAIL = "owner@company.local";

/** The plan's ceiling. Past this, a phone on 4G starts to feel it. */
const BUDGET_KB = 500;

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 30_000,
    });
}

test.describe("PWA", () => {
    test("first load stays inside the budget", async ({ page }) => {
        const origin = process.env.E2E_BASE_URL ?? "";
        test.skip(
            origin.includes(":5173") || origin === "",
            "only meaningful against a served production build",
        );

        // Gzipped size per asset the shell actually pulled — see the note above.
        const bytes = new Map<string, number>();
        const pending: Promise<void>[] = [];
        page.on("response", (res) => {
            const url = new URL(res.url());
            if (!/\.(js|css)$/.test(url.pathname)) return;
            pending.push(
                res
                    .body()
                    .then((body) => {
                        bytes.set(url.pathname, gzipSync(body).length);
                    })
                    .catch(() => {
                        /* no retrievable body — not part of the shell */
                    }),
            );
        });

        await login(page);
        await page.waitForTimeout(3000);
        await Promise.all(pending);

        const total = [...bytes.values()].reduce((a, b) => a + b, 0);
        const kb = total / 1024;
        const listing = [...bytes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([p, n]) => `    ${(n / 1024).toFixed(1)} KB gz  ${p}`)
            .join("\n");
        console.log(
            `  [measure] first load = ${kb.toFixed(1)} KB gz (budget ${BUDGET_KB})\n${listing}`,
        );

        // Guard against a vacuous pass: no captured responses would report
        // 0 KB and sail through the ceiling.
        expect(bytes.size, "no JS/CSS responses captured").toBeGreaterThan(0);
        expect(kb, `first load ${kb.toFixed(1)} KB gz`).toBeLessThan(BUDGET_KB);
    });

    test("the manifest is installable — name, icons, start_url, display", async ({
        page,
    }) => {
        await page.goto("/");
        const href = await page
            .locator('link[rel="manifest"]')
            .getAttribute("href");
        expect(href, "no <link rel=manifest>").toBeTruthy();

        const res = await page.request.get(new URL(href!, page.url()).toString());
        expect(res.status()).toBe(200);
        const m = (await res.json()) as {
            name?: string;
            short_name?: string;
            start_url?: string;
            display?: string;
            icons?: Array<{ sizes?: string; purpose?: string; src?: string }>;
        };

        // The four Chrome actually requires before it offers "Install".
        expect(m.name || m.short_name, "manifest has no name").toBeTruthy();
        expect(m.start_url, "manifest has no start_url").toBeTruthy();
        expect(
            ["standalone", "fullscreen", "minimal-ui"],
            "display must be app-like or Chrome will not offer Install",
        ).toContain(m.display);

        const sizes = (m.icons ?? []).map((i) => i.sizes ?? "");
        expect(sizes, "needs a 192px icon").toContain("192x192");
        expect(sizes, "needs a 512px icon").toContain("512x512");
        // A maskable icon is what stops Android cropping the logo into a circle.
        expect(
            (m.icons ?? []).some((i) => (i.purpose ?? "").includes("maskable")),
            "needs a maskable icon",
        ).toBe(true);
    });

    test("every icon the manifest promises actually exists", async ({
        page,
    }) => {
        // A manifest that names a missing file is worse than no manifest: Chrome
        // silently declines to offer installation and says nothing about why.
        await page.goto("/");
        const href = await page
            .locator('link[rel="manifest"]')
            .getAttribute("href");
        const m = (await (
            await page.request.get(new URL(href!, page.url()).toString())
        ).json()) as { icons?: Array<{ src?: string }> };

        const missing: string[] = [];
        for (const icon of m.icons ?? []) {
            if (!icon.src) continue;
            const r = await page.request.get(
                new URL(icon.src, page.url()).toString(),
            );
            if (r.status() !== 200) missing.push(`${icon.src} → ${r.status()}`);
        }
        expect(missing, "manifest icons that 404").toEqual([]);
    });

    test("the service worker registers and claims the page", async ({
        page,
    }) => {
        const origin = process.env.E2E_BASE_URL ?? "";
        test.skip(
            origin.includes(":5173") || origin === "",
            "the SW is served from public/ and is only meaningful on a built origin",
        );

        await page.goto("/");
        const state = await page.evaluate(async () => {
            if (!("serviceWorker" in navigator)) return "unsupported";
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return "not-registered";
            // `ready` resolves once a worker is active and controlling.
            await navigator.serviceWorker.ready;
            return reg.active ? "active" : "registered-not-active";
        });
        expect(state).toBe("active");
    });
});

/**
 * P11 §5 — the offline message, which the mobile rebuild caught LYING once.
 *
 * The service worker caches the app SHELL, not the data. An offline banner that
 * says "you're offline" and nothing else invites the reader to assume their
 * work is being saved for later — it is not. The copy has to be honest about
 * which half still works, and the banner has to actually appear, which means
 * being mounted in the shell rather than on one page.
 */
test.describe("offline", () => {
    test("the banner appears, and its copy does not overpromise", async ({
        page,
        context,
    }) => {
        await login(page);
        await page.waitForTimeout(1200);

        await context.setOffline(true);
        // The indicator listens for the window `offline` event.
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));

        const banner = page.getByRole("status").filter({ hasText: /offline/i });
        await expect(banner).toBeVisible({ timeout: 10_000 });

        const text = (await banner.innerText()).toLowerCase();
        // It must say what does NOT work. "You're offline" alone is the lie.
        expect(
            /won.?t save|not be saved|cannot save|changes/.test(text),
            `offline copy must say changes will not save — got: "${text}"`,
        ).toBe(true);

        // …and it must come back when the network does, or it becomes furniture
        // people learn to ignore.
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await expect(banner).toBeHidden({ timeout: 10_000 });
    });
});
