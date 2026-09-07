#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * KI-28 — the one `/auth/refresh` 500 that nobody could reproduce.
 *
 *   node scripts/refresh-race.cjs --base=http://localhost:5599
 *   node scripts/refresh-race.cjs --assert        # exit 1 on any 5xx
 *
 * P2 saw a single 500 under full-module load and could not reproduce it in 346
 * concurrent requests, 5 isolated runs or 3 further full runs. Those runs fired
 * concurrent requests with DIFFERENT sessions, which is the wrong shape: the
 * interesting race is N requests presenting the SAME refresh cookie at once.
 * Refresh rotates the token, so exactly one caller may win and the losers must
 * be refused — the question is whether they are refused CLEANLY (401) or
 * whether two writers collide and the collision surfaces as a 500.
 *
 * Three shapes are tried, and the whole point is that the second one is the
 * one P2 never ran:
 *
 *   1. sequential rotation      — the happy path still works N times over
 *   2. SAME cookie, N at once   — the rotation race
 *   3. a replayed OLD cookie    — reuse after a successful rotation
 *
 * Any 5xx is a finding. A 401 is not: refusing a spent token is the product
 * working.
 */

const argOf = (n, d) => {
    const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : d;
};
const BASE = argOf("base", "http://localhost:5599");
const EMAIL = argOf("email", "owner@company.local");
const PASSWORD = argOf("password", "Owner@12345");
const FANOUT = Number(argOf("fanout", "25"));
const ROUNDS = Number(argOf("rounds", "8"));
const ASSERT = process.argv.includes("--assert");

const COOKIE = "bb_refresh";

/** Pull the refresh cookie out of a response's Set-Cookie headers. */
const cookieFrom = (res) => {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const c of raw) {
        const m = c.match(new RegExp(`^${COOKIE}=([^;]+)`));
        if (m) return m[1];
    }
    return null;
};

const login = async () => {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login ${res.status}`);
    const c = cookieFrom(res);
    if (!c) throw new Error("login returned no refresh cookie");
    return c;
};

const refresh = async (cookie) => {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { cookie: `${COOKIE}=${cookie}` },
    });
    let code = "";
    try {
        code = (await res.clone().json())?.error?.code ?? "";
    } catch {
        code = "";
    }
    return { status: res.status, next: cookieFrom(res), code };
};

const tally = (arr) => {
    const out = {};
    for (const s of arr) out[s] = (out[s] ?? 0) + 1;
    return out;
};

(async () => {
    const fiveXX = [];
    console.log(`\nKI-28 — /auth/refresh under contention (fanout ${FANOUT} × ${ROUNDS} rounds)\n`);

    // ── 1. sequential rotation ──────────────────────────────────────────────
    let cookie = await login();
    const seq = [];
    for (let i = 0; i < 10; i++) {
        const r = await refresh(cookie);
        seq.push(r.status);
        if (r.status >= 500) fiveXX.push(`sequential#${i} → ${r.status}`);
        if (r.next) cookie = r.next;
    }
    console.log(`  1. sequential rotation ×10      ${JSON.stringify(tally(seq))}`);

    // ── 2. the race P2 never ran: ONE cookie, N callers at once ─────────────
    const raceStatuses = [];
    let wonExactlyOnce = 0;
    for (let round = 0; round < ROUNDS; round++) {
        const start = await login();
        const results = await Promise.all(
            Array.from({ length: FANOUT }, () => refresh(start)),
        );
        for (const r of results) {
            raceStatuses.push(r.status);
            if (r.status >= 500) {
                fiveXX.push(`race round ${round} → ${r.status} ${r.code}`);
            }
        }
        const winners = results.filter((r) => r.status === 200).length;
        if (winners >= 1) wonExactlyOnce += 1;
    }
    console.log(
        `  2. same cookie, ${String(FANOUT).padStart(2)} at once ×${ROUNDS}   ` +
            `${JSON.stringify(tally(raceStatuses))}`,
    );
    console.log(
        `     rounds where at least one caller succeeded: ${wonExactlyOnce}/${ROUNDS}`,
    );

    // ── 3. replay of a spent cookie ─────────────────────────────────────────
    const spent = await login();
    const first = await refresh(spent);
    const replay = await Promise.all(
        Array.from({ length: FANOUT }, () => refresh(spent)),
    );
    for (const r of replay) {
        if (r.status >= 500) fiveXX.push(`replay → ${r.status} ${r.code}`);
    }
    console.log(
        `  3. replay a spent cookie ×${FANOUT}     ` +
            `first=${first.status} replays=${JSON.stringify(tally(replay.map((r) => r.status)))}`,
    );

    const total = seq.length + raceStatuses.length + replay.length + 1;
    console.log(
        `\n  ${total} refresh attempts · ${fiveXX.length} server error(s)\n`,
    );
    if (fiveXX.length) {
        for (const f of fiveXX.slice(0, 10)) console.log(`    ${f}`);
        console.log();
    }
    if (ASSERT && fiveXX.length > 0) process.exit(1);
})().catch((e) => {
    console.error(String(e));
    process.exit(1);
});
