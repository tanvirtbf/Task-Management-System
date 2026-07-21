import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

/**
 * Phase 43 — Browser auth flows: login/logout, forgot→(seeded token)→reset,
 * invite→accept→auto-login, session-survives-reload (KI-15), wrong-pw error,
 * guest-route redirect. Uses a throwaway user (p43user) so owner/member creds
 * are never mutated. Tokens are sha256(raw) in the DB, so we seed a known raw.
 */

const MYSQL = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
const sql = (q: string) => execFileSync(MYSQL, ["-uroot", "-proot", "taskmanagement_qa", "-N", "-e", q], { encoding: "utf8" }).trim();
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const API = "http://localhost:5501/api/v1";

const OWNER = "owner@company.local", OPASS = "Owner@12345";
const P43 = "p43user@qa.local";
const INVITE_TOKEN = "P43-invite-token-abcdefghij";
const RESET_TOKEN = "P43-reset-token-klmnopqrst";
const NEWPASS = "P43new-Pass!456";

let ip = 1;
const apiLogin = (email: string, password: string) =>
    fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `91.0.0.${ip++}` }, body: JSON.stringify({ email, password }) });

async function loginUI(page: Page, email: string, pass: string) {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.local").fill(email);
    await page.getByPlaceholder("Enter your password").fill(pass);
    await page.getByRole("button", { name: "Sign in" }).click();
}

const purgeUser = () => {
    const uid = sql(`SELECT id FROM users WHERE email='${P43}'`);
    if (uid) { sql(`DELETE FROM password_reset_tokens WHERE user_id='${uid}'`); sql(`DELETE FROM invitations WHERE email='${P43}'`); sql(`DELETE FROM users WHERE id='${uid}'`); }
};

test.beforeAll(async () => {
    purgeUser();
    const tok = (await (await apiLogin(OWNER, OPASS)).json()).access_token;
    const invR = await fetch(`${API}/users/invite`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}`, "x-forwarded-for": "91.9.0.1" }, body: JSON.stringify({ email: P43, role: "member", first_name: "P43", last_name: "User" }) });
    if (invR.status >= 400) throw new Error(`invite setup failed: ${invR.status} ${JSON.stringify(await invR.json())}`);
    // seed a known invite token
    sql(`UPDATE invitations SET token_hash='${sha256(INVITE_TOKEN)}', expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY), accepted_at=NULL WHERE email='${P43}'`);
});
test.afterAll(() => purgeUser());

// Serial: accept (activates the user) must precede forgot/reset.
test.describe.configure({ mode: "serial" });

test("invite → accept → auto-login", async ({ page }) => {
    await page.goto(`/invitation/${INVITE_TOKEN}`);
    const pw = page.locator('input[type="password"]');
    await expect(pw.first()).toBeVisible({ timeout: 15_000 }); // invite summary loaded → form shown
    const n = await pw.count();
    for (let i = 0; i < n; i++) await pw.nth(i).fill("P43-accept!1");
    await page.getByRole("button", { name: "Create account & sign in" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/invitation") && !u.pathname.includes("/login"), { timeout: 20_000 });
    expect(page.url()).not.toContain("/invitation");
    expect(page.url()).not.toContain("/login");
});

test("forgot-password UI + reset with seeded token → new password works", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByPlaceholder("you@company.local").fill(P43);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.waitForTimeout(1500); // success view (enumeration-safe 202)
    // seed a known reset token for the user
    const uid = sql(`SELECT id FROM users WHERE email='${P43}'`);
    sql(`INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at) VALUES ('prt-p43-fixture','${uid}','${sha256(RESET_TOKEN)}',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),UTC_TIMESTAMP())`);
    await page.goto(`/reset-password/${RESET_TOKEN}`);
    await page.getByPlaceholder("Enter new password").fill(NEWPASS);
    await page.getByPlaceholder("Re-type new password").fill(NEWPASS);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2000);
    // new password authenticates
    const r = await apiLogin(P43, NEWPASS);
    expect(r.status).toBe(200);
});

test("login + session survives hard reload (KI-15 transient 401 benign)", async ({ page }) => {
    await loginUI(page, OWNER, OPASS);
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2500); // bootstrap 401 → refresh → retry recovers the session
    expect(new URL(page.url()).pathname).not.toContain("/login");
});

test("wrong password → error surfaced, stays on /login", async ({ page }) => {
    await loginUI(page, OWNER, "definitely-wrong-pass");
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toContain("/login");
    const errCount = await page.locator('.ant-alert-error, .ant-message-error, [role="alert"], .ant-form-item-explain-error').count();
    expect(errCount).toBeGreaterThan(0);
});

test("logout returns to /login", async ({ page }) => {
    await loginUI(page, OWNER, OPASS);
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
    await page.locator(".ant-dropdown-trigger").last().click();
    await page.getByText("Sign out").click();
    await page.waitForURL((u) => u.pathname.includes("/login"), { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toContain("/login");
});

test("unauthenticated authed-route → redirect to /login (guest guard)", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/settings/profile");
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toContain("/login");
});
