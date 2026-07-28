#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The check a suspicious person actually performs: hiding a department from the
 * sidebar means nothing if its tasks are still readable by id. This takes a
 * task id out of a space the scoped account cannot see, and asks for it
 * directly.
 *
 *   node scripts/demo-role-idor-check.cjs
 */
const API = "http://localhost:5501/api/v1";
const PASSWORD = "Owner@12345";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (email) => {
    const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error(`login ${email} -> ${r.status}`);
    return j.access_token;
};
const get = async (token, path) => {
    const r = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
};
const rows = (b) => (Array.isArray(b) ? b : (b?.data ?? []));

(async () => {
    // Give the previous script's logins time to fall out of the 5/min window.
    console.log("waiting out the login limiter (62s)...");
    await sleep(62_000);

    const owner = await login("owner@company.local");
    const spaces = rows((await get(owner, "/spaces")).body);
    const eng = spaces.find((s) => s.name === "Engineering");
    const lists = rows((await get(owner, `/lists?space_id=${eng.id}`)).body);
    let target = null;
    for (const l of lists) {
        const tasks = rows((await get(owner, `/lists/${l.id}/tasks`)).body);
        if (tasks[0]) {
            target = tasks[0];
            break;
        }
    }
    if (!target) throw new Error("no Engineering task to probe with");
    console.log(`probe target: an Engineering task (id ${target.id})`);

    const scoped = await login("marketing.only@beautybooth.com.bd");

    const direct = await get(scoped, `/tasks/${target.id}`);
    const inSearch = await get(scoped, "/search?query=a");
    const searchIds = JSON.stringify(inSearch.body ?? {});

    console.log("");
    console.log(`GET /tasks/<engineering id> as Marketing-only : ${direct.status}`);
    console.log(
        `the id appears in that account's search results  : ${searchIds.includes(target.id) ? "YES" : "no"}`,
    );
    console.log("");

    const ok = (direct.status === 403 || direct.status === 404) &&
        !searchIds.includes(target.id);
    console.log(ok ? "VERDICT: no cross-department read" : "VERDICT: LEAK");
    process.exit(ok ? 0 : 1);
})().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
});
