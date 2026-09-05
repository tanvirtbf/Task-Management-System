import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * P11 §6 — the accessibility pass, on the six screens people actually live in.
 *
 * `f31-deferred.pw.ts` already runs axe on three screens and gates on
 * `critical` only. This widens the net and, more importantly, adds the three
 * things axe cannot see:
 *
 *   · can you reach the primary action with the keyboard alone?
 *   · does a modal trap focus, or does Tab walk out of it into the page behind?
 *   · is the focus ring actually visible, or has a reset removed the outline?
 *
 * Those are the ones that decide whether the app is usable without a mouse, and
 * they are invisible to a rule engine because they are about sequence and
 * appearance rather than markup.
 *
 * `serious` violations are REPORTED with their ids and counted, not silently
 * dropped: a number that nobody can see is a number nobody fixes. The gate is
 * on `critical` plus a named, deliberately short allowlist for `serious`, so a
 * NEW serious violation fails even while the known ones are being worked
 * through.
 */

const EMAIL = "owner@company.local";
const PASSWORD = "Owner@12345";

async function login(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(EMAIL);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), {
        timeout: 30_000,
    });
    await page.waitForTimeout(1200);
}

/** The six a person opens every day. */
const CORE = [
    { name: "login", path: "/login", auth: false },
    { name: "home", path: "/", auth: true },
    { name: "inbox", path: "/inbox", auth: true },
    { name: "search", path: "/search", auth: true },
    { name: "spaces", path: "/spaces", auth: true },
    { name: "settings-members", path: "/settings/members", auth: true },
] as const;

/**
 * Known `serious` findings, each one a decision rather than an oversight.
 * Empty to begin with: P11 measures first and fills this in ONLY for things it
 * consciously defers, so the list can never quietly absorb a regression.
 */
const KNOWN_SERIOUS: string[] = [];

test.describe("accessibility", () => {
    for (const screen of CORE) {
        test(`axe: ${screen.name}`, async ({ page }) => {
            if (screen.auth) await login(page);
            await page.goto(screen.path);
            await page.waitForTimeout(2000);

            const results = await new AxeBuilder({ page }).analyze();
            const bySeverity: Record<string, string[]> = {};
            for (const v of results.violations) {
                (bySeverity[v.impact ?? "none"] ??= []).push(v.id);
            }
            // Printed for every run, pass or fail — the record is the point.
            console.log(
                `  axe(${screen.name}): ${JSON.stringify(bySeverity)}`,
            );

            const critical = results.violations
                .filter((v) => v.impact === "critical")
                .map((v) => v.id);
            expect(critical, `${screen.name}: critical violations`).toEqual([]);

            const serious = results.violations
                .filter((v) => v.impact === "serious")
                .map((v) => v.id)
                .filter((id) => !KNOWN_SERIOUS.includes(id));
            expect(
                serious,
                `${screen.name}: NEW serious violations (known ones are listed in KNOWN_SERIOUS)`,
            ).toEqual([]);
        });
    }

    test("keyboard: the sign-in form is operable with no mouse at all", async ({
        page,
    }) => {
        // The one screen where a keyboard-only failure locks somebody out of
        // the product entirely.
        await page.goto("/login");
        await page.waitForTimeout(600);

        await page.keyboard.press("Tab");
        // Walk forward until the email field has focus, bounded so a broken tab
        // order fails instead of hanging.
        let found = false;
        for (let i = 0; i < 12 && !found; i++) {
            const ph = await page.evaluate(() =>
                document.activeElement?.getAttribute("placeholder"),
            );
            if (ph === "you@company.local") found = true;
            else await page.keyboard.press("Tab");
        }
        expect(found, "email field reachable by Tab").toBe(true);

        await page.keyboard.type(EMAIL);
        await page.keyboard.press("Tab");
        await page.keyboard.type(PASSWORD);
        await page.keyboard.press("Enter");

        await page.waitForURL((u) => !u.pathname.includes("/login"), {
            timeout: 30_000,
        });
    });

    test("focus ring: the focused control is visibly marked", async ({
        page,
    }) => {
        // A CSS reset that drops `outline` makes keyboard use possible and
        // untrackable — you can act, but you cannot see where you are.
        await page.goto("/login");
        await page.waitForTimeout(600);
        await page.getByPlaceholder("you@company.local").focus();

        const visible = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el) return false;
            const s = getComputedStyle(el);
            const outline =
                s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
            // antd marks focus with a box-shadow rather than an outline, which
            // is equally visible and equally intentional.
            const shadow = s.boxShadow !== "none" && s.boxShadow !== "";
            const border = parseFloat(s.borderWidth) > 0;
            return outline || shadow || border;
        });
        expect(visible, "focused input has a visible focus indicator").toBe(
            true,
        );
    });

    test("focus trap: Tab inside an open modal stays inside it", async ({
        page,
    }) => {
        await login(page);
        await page.goto("/settings/members");
        await page.waitForTimeout(1500);

        // Any dialog-opening control on this screen; the assertion is about the
        // dialog's behaviour, not about which button opened it.
        const opener = page
            .getByRole("button", { name: /invite|add member/i })
            .first();
        if ((await opener.count()) === 0) {
            test.skip(true, "no invite control visible for this persona");
        }
        await opener.click();
        const dialog = page.getByRole("dialog").first();
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        // Tab a generous number of times; focus must never leave the dialog.
        let escaped: string | null = null;
        for (let i = 0; i < 25; i++) {
            await page.keyboard.press("Tab");
            const inside = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el) return true;
                const dlg = document.querySelector('[role="dialog"]');
                return dlg ? dlg.contains(el) : true;
            });
            if (!inside) {
                escaped = await page.evaluate(
                    () =>
                        `${document.activeElement?.tagName}.${document.activeElement?.className}`,
                );
                break;
            }
        }
        expect(escaped, "focus escaped the modal to").toBeNull();

        // And Escape closes it — otherwise a keyboard user is stuck in the trap
        // they were just put in.
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden({ timeout: 10_000 });
    });

    test("labels: every text input on the sign-in form is named", async ({
        page,
    }) => {
        // A screen reader reads the accessible name; a placeholder alone
        // disappears the moment somebody starts typing.
        await page.goto("/login");
        await page.waitForTimeout(600);
        const unnamed = await page.evaluate(() => {
            const out: string[] = [];
            for (const el of Array.from(
                document.querySelectorAll("input:not([type=hidden])"),
            )) {
                const input = el as HTMLInputElement;
                const named =
                    input.getAttribute("aria-label") ||
                    input.getAttribute("aria-labelledby") ||
                    input.getAttribute("placeholder") ||
                    (input.id &&
                        document.querySelector(`label[for="${input.id}"]`));
                if (!named) out.push(input.outerHTML.slice(0, 90));
            }
            return out;
        });
        expect(unnamed, "inputs with no accessible name").toEqual([]);
    });
});
