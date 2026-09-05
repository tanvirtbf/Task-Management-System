import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

/**
 * EVERY ROUTE, EVERY PERSONA — P10's headline ask.
 *
 * `smoke.pw.ts` already walks the authenticated routes as the OWNER, which is
 * the one persona for whom nothing is ever refused. That is precisely the half
 * of the product that cannot break in the interesting way: a page that renders
 * for somebody holding all 56 permissions tells you nothing about the page a
 * Guest opens, or the one a member scoped to a single department opens.
 *
 * The failure this is looking for is not a 403 — the API is well covered there
 * by nine phases of server tests. It is what the CLIENT does with a 403: a
 * white screen, an unhandled rejection, a spinner that never resolves, or a
 * raw axios string where a sentence should be. A refusal the person cannot
 * read is a bug even when the permission check is perfect.
 *
 * ── what counts as a failure ────────────────────────────────────────────────
 *   · the app-level ErrorBoundary rendering (main.tsx wraps the WHOLE router in
 *     it, so any render throw anywhere takes every route down — this is exactly
 *     the KI-23 shape, and the reason that check leads);
 *   · a page with no discernible content;
 *   · a console error or an unhandled rejection that is not on the benign list;
 *   · a raw axios/network string rendered where a person can see it.
 *
 * An EMPTY page is not a failure — for several of these personas an empty
 * Reports or Engineering page is the correct answer. What is asserted is that
 * the shell rendered and the app is still alive.
 */

const PASSWORD = "Owner@12345";

/** The six shapes a real person in this workspace can have. */
const PERSONAS = [
    { name: "owner", email: "owner@company.local" },
    { name: "admin", email: "farhana@beautybooth.com.bd" },
    { name: "head", email: "nusrat@beautybooth.com.bd" },
    { name: "member", email: "arif@beautybooth.com.bd" },
    { name: "guest", email: "guest@beautybooth.com.bd" },
    { name: "space-scoped", email: "marketing.only@beautybooth.com.bd" },
] as const;

/**
 * Every route in `router.tsx` that an authenticated person can open without an
 * id in the URL. The `:id` routes are covered by the specs that create their
 * own fixtures (`tasks-views`, `dept-review`, `forms`), because a deep link is
 * only meaningful against a row that exists.
 */
const ROUTES = [
    "/",
    "/spaces",
    "/inbox",
    "/search",
    "/dept",
    "/reports",
    "/sla",
    "/eng",
    "/eng/sprint",
    "/eng/on-call",
    "/forms",
    "/settings",
    "/settings/profile",
    "/settings/workspace",
    "/settings/members",
    "/settings/teams",
    "/settings/roles",
    "/settings/task-types",
    "/settings/tags",
    "/settings/statuses",
    "/settings/custom-fields",
    "/settings/templates",
    "/settings/import-export",
] as const;

/**
 * Console noise that is not a defect. Kept deliberately short: every entry here
 * is a thing this suite can no longer see, so the list is a cost.
 */
const BENIGN = [
    /favicon/i,
    /Download the React DevTools/i,
    /\[antd:/i,
    /antd v5 support React is 16/i,
    // The in-memory access token does not survive a reload, so the first call
    // after `page.goto` 401s and the interceptor refreshes and retries. Visible
    // in the console, invisible to the person.
    /Failed to load resource.*401/i,
    /401 \(Unauthorized\)/i,
    // A 403 IS the expected answer on several of these route×persona pairs.
    // What must not happen is the app breaking on it, which is what the
    // assertions below actually check.
    /Failed to load resource.*403/i,
    /403 \(Forbidden\)/i,
    // Same for a 404 on an id-less collection route the persona cannot reach.
    /Failed to load resource.*404/i,
    /404 \(Not Found\)/i,
];
const isReal = (t: string) => !BENIGN.some((re) => re.test(t));

/** Text that means "a raw error object reached the screen". */
const RAW_ERROR_TEXT = [
    "Request failed with status code",
    "AxiosError",
    "Network Error",
    "[object Object]",
    "undefined is not",
    "Cannot read properties",
];

interface Watch {
    errors: string[];
    rejections: string[];
}

const watch = (page: Page): Watch => {
    const w: Watch = { errors: [], rejections: [] };
    page.on("console", (m: ConsoleMessage) => {
        if (m.type() === "error" && isReal(m.text())) w.errors.push(m.text());
    });
    page.on("pageerror", (e) => w.rejections.push(String(e)));
    return w;
};

async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(email);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 30_000,
    });
}

for (const persona of PERSONAS) {
    test.describe(`routes as ${persona.name}`, () => {
        test(`${persona.name}: every route renders, and the app survives`, async ({
            page,
        }) => {
            test.setTimeout(180_000);
            const w = watch(page);
            await login(page, persona.email);

            const broken: string[] = [];

            // Guard against the vacuous pass this spec is most exposed to: if a
            // persona's sign-in quietly failed, every route below would render
            // the LOGIN page — which has plenty of text and no console errors,
            // so all 23 checks would go green having tested nothing.
            // `waitForURL` returns on the URL change, which is before the lazy
            // route chunk has painted — so the shell has to be given a moment
            // or this guard measures an empty body and fails on every persona.
            await page.waitForTimeout(2000);
            const shell = await page.locator("body").innerText();
            expect(
                page.url(),
                `${persona.name} did not get past /login`,
            ).not.toContain("/login");
            expect(
                shell.length,
                `${persona.name} signed in but the app shell is empty`,
            ).toBeGreaterThan(50);

            const bouncedToLogin: string[] = [];

            for (const route of ROUTES) {
                await page.goto(route);
                // The app is a SPA with lazy routes; give the chunk and the
                // first query a moment, but never wait for networkidle — the
                // SSE inbox stream never goes idle (a trap this project has
                // already paid for).
                await page.waitForLoadState("domcontentloaded");
                await page.waitForTimeout(900);

                // 1. The app-level boundary. If this is showing, EVERY route is
                //    down, not just this one — see the note at the top.
                const boundary = await page
                    .getByText(/Something went wrong/i)
                    .count();
                if (boundary > 0) broken.push(`${route}: ErrorBoundary rendered`);

                // 2. Still signed in. A route that bounces the persona to
                //    /login is not "handled a 403 gracefully", it is a session
                //    the app threw away — and it would make every later check
                //    on this run meaningless.
                if (page.url().includes("/login")) {
                    bouncedToLogin.push(route);
                }

                // 3. Something is on the screen.
                const text = (await page.locator("body").innerText()).trim();
                if (text.length < 20) {
                    broken.push(`${route}: blank page (${text.length} chars)`);
                }

                // 4. No raw error object leaked into the UI.
                for (const raw of RAW_ERROR_TEXT) {
                    if (text.includes(raw)) {
                        broken.push(`${route}: raw error text "${raw}"`);
                    }
                }
            }

            expect(
                bouncedToLogin,
                `${persona.name} — routes that threw the session away:`,
            ).toEqual([]);
            expect(
                broken,
                `${persona.name} — routes that failed:\n${broken.join("\n")}`,
            ).toEqual([]);
            expect(
                w.rejections,
                `${persona.name} — unhandled page errors:\n${w.rejections.join("\n")}`,
            ).toEqual([]);
            expect(
                w.errors,
                `${persona.name} — console errors:\n${w.errors.join("\n")}`,
            ).toEqual([]);
        });
    });
}
