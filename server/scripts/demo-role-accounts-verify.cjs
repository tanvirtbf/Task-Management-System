#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Proves each demo account really resolves to the access it is advertised to
 * have — by logging in as it and reading `GET /me/permissions` and
 * `GET /spaces` through the live API, not by re-reading the seed script.
 *
 *   node scripts/demo-role-accounts-verify.cjs
 *
 * ASCII output only (this project's terminal cannot render Bengali script), and
 * it paces itself around the 5/min/IP login limiter rather than asking anyone
 * to disable it.
 */
const API =
    process.argv.find((a) => a.startsWith("--api="))?.slice(6) ??
    "http://localhost:5501/api/v1";
const PASSWORD = "Owner@12345";

const ACCOUNTS = [
    ["owner@company.local", "Owner"],
    ["farhana@beautybooth.com.bd", "Admin"],
    ["nusrat@beautybooth.com.bd", "Member + Marketing head"],
    ["arif@beautybooth.com.bd", "Member (plain)"],
    ["guest@beautybooth.com.bd", "Guest"],
    ["marketing.only@beautybooth.com.bd", "Department Only -> Marketing"],
    ["cs.only@beautybooth.com.bd", "Department Only -> Customer Service"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (email) => {
    const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) {
        throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(j)}`);
    }
    return j.access_token;
};

const get = async (token, path) => {
    const r = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
};

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

(async () => {
    const rows = [];
    for (let i = 0; i < ACCOUNTS.length; i++) {
        // The limiter is 5 logins per minute per IP; wait it out rather than
        // reporting a 429 as if it were a broken account.
        if (i > 0 && i % 4 === 0) {
            console.log("   ...pausing 62s for the login rate limiter...");
            await sleep(62_000);
        }
        const [email, label] = ACCOUNTS[i];
        try {
            const token = await login(email);
            const perms = await get(token, "/me/permissions");
            const spaces = await get(token, "/spaces");
            const p = perms.body ?? {};
            const list = Array.isArray(spaces.body)
                ? spaces.body
                : (spaces.body?.data ?? []);
            rows.push({
                email,
                label,
                role: p.role ?? "?",
                owner: p.is_owner ? "yes" : "no",
                count: Object.keys(p.permissions ?? {}).length,
                visible:
                    p.visible_space_ids === null
                        ? "ALL"
                        : String(p.visible_space_ids?.length ?? 0),
                spaces: list.map((s) => s.name).sort().join(", ") || "(none)",
                canRoles: p.permissions?.["role.manage"] ? "yes" : "no",
                canAssistant: p.permissions?.["assistant.use"] ? "yes" : "no",
            });
        } catch (e) {
            rows.push({ email, label, role: "FAIL: " + e.message });
        }
    }

    console.log("");
    console.log(
        pad("EMAIL", 36) +
            pad("ROLE", 8) +
            pad("PERMS", 7) +
            pad("SEES", 6) +
            pad("ROLE.MANAGE", 13) +
            "SPACES VISIBLE",
    );
    console.log("-".repeat(120));
    for (const r of rows) {
        if (String(r.role).startsWith("FAIL")) {
            console.log(pad(r.email, 36) + r.role);
            continue;
        }
        console.log(
            pad(r.email, 36) +
                pad(r.role, 8) +
                pad(r.count, 7) +
                pad(r.visible, 6) +
                pad(r.canRoles, 13) +
                r.spaces,
        );
    }
    console.log("");

    // The single claim this script exists to check.
    const scoped = rows.filter((r) => r.email.includes(".only@"));
    const ok =
        scoped.length === 2 &&
        scoped.every((r) => r.visible === "1" && r.spaces.split(",").length === 1);
    console.log(ok ? "VERDICT: space-scoping ENFORCED" : "VERDICT: NOT SCOPED");
    process.exit(ok ? 0 : 1);
})();
