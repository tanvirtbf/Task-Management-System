#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ASSISTANT EVALUATION GATE — AI_ASSISTANT_PERFECT_PLAN.md (P0 records, P10 asserts).
 *
 * Grades the LIVE bot on the only question that matters for its purpose:
 *   "can a confused, non-technical person be taught to use this system by the bot alone?"
 *
 * ── WHY A SCRIPT AND NOT A JEST TEST ─────────────────────────────────────────
 * It calls the real model, so it costs money and is non-deterministic. It is a
 * GATE you run deliberately (plan D-6), the same way `assistant.pw.ts` runs
 * against the live model — not something CI executes on every push.
 *
 * ── WHY IT NEVER PRINTS AN ANSWER ────────────────────────────────────────────
 * Replies are Bangla. This project's terminal cannot render Bengali script, so
 * every line below is an ASCII verdict derived from the reply, never the reply.
 *
 *   node scripts/assistant-eval.cjs                 # grade, print, exit 0
 *   node scripts/assistant-eval.cjs --assert        # also fail (exit 1) below target
 *   node scripts/assistant-eval.cjs --api=http://host:5501/api/v1
 */

const API =
    process.argv.find((a) => a.startsWith("--api="))?.slice(6) ??
    "http://localhost:5501/api/v1";
const ASSERT = process.argv.includes("--assert");
const EMAIL = process.env.EVAL_EMAIL ?? "owner@company.local";
const PASSWORD = process.env.EVAL_PASSWORD ?? "Owner@12345";

/** PART 2 of the plan — the pass/fail contract. */
const TARGET = {
    links: 14, // of 15 — one question legitimately has no page to point at
    // steps has no fixed number: it is "all of the questions that need them".
    bangla: 15, // of 15
    dataAnswers: 9, // of 10 — questions only a live tool can answer
    fabricatedRoutes: 0,
};

/**
 * The questions a brand-new, non-technical person actually asks. Deliberately
 * Banglish (Roman-script Bangla) because that is how this team types.
 */
/**
 * Third field = does a beginner have to DO something to satisfy this question?
 *
 * "What is this system?" and "who reviews my work?" read best as prose —
 * forcing a numbered list on them makes the answer worse, not better. So steps
 * are required only where there is an action to follow, and required of ALL of
 * those (100%), which is stricter per question than the old "14 of 15
 * including the ones that should not have steps".
 */
const FIRST_TIMER = [
    ["orientation", "ami notun. ei system ta ki jinis? ki kaj e lage?", false],
    ["orientation", "ami kichui bujhtesi na, kothay theke shuru korbo?", true],
    ["concept", "Space, List, Task — eigula ki? parthokko ki?", false],
    ["how-to", "kivabe ekta notun task banabo?", true],
    ["how-to", "task ta kauke kivabe dibo?", true],
    ["how-to", "amar kaj kothay dekhbo? amake ki ki deya hoyeche?", true],
    ["how-to", "task er status kivabe change korbo?", true],
    ["concept", "Board view ta ki? kivabe dekhbo?", true],
    ["how-to", "comment kivabe korbo, ar keu comment korle janbo kivabe?", true],
    ["how-to", "file kivabe attach korbo?", true],
    ["account", "amar password bhule gechi, ki korbo?", true],
    ["admin", "notun ekjon ke team e kivabe add korbo?", true],
    ["feature", "amar completed kaj ke check kore? kothay dekhbo?", false],
    ["rbac", "ekjon ke shudhu Marketing space er access dite chai, kivabe?", true],
    ["rbac", "notun ekta custom role kivabe banabo?", true],
];

/**
 * Questions ONLY a live tool can answer, each paired with the KPI it asks about
 * so the reply is checked against THAT value rather than "any digit anywhere".
 *
 * ⚠️ TWO WAYS THIS METRIC LIES, both learned the hard way:
 *  1. The bot answers in Bangla and often writes numbers in BENGALI numerals
 *     (২, ৩৬). An ASCII-digit check scores a perfectly correct answer as wrong.
 *  2. A true value of ZERO is usually said in words ("kono task nei"), not as a
 *     digit — so a correct answer contains no number at all.
 * Both are handled below. A metric that flatters OR maligns the thing it
 * measures is worse than no metric.
 */
const DATA_QUESTIONS = [
    ["amar koyta open task ache? sonkha bolo.", "myTasks"],
    ["how many open tasks do I have right now? give the number.", "myTasks"],
    ["team er koto gulo open task ache?", "openTeamTasks"],
    ["amar koyta task overdue ache?", "overdue"],
    ["aj koyta task due ache amar?", "dueToday"],
    ["amar review er opekkhay koyta task ache?", "awaitingReview"],
    ["how many overdue tasks are there for me?", "overdue"],
    ["workspace e mot koyta open task ache?", "openTeamTasks"],
    ["SLA breach koyta ache?", "slaBreaches"],
    ["amar assign kora task koyta?", "myTasks"],
];

/** Bengali digits → ASCII, so "৩৬" and "36" compare equal. */
const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";
const toAsciiDigits = (s) =>
    s.replace(/[০-৯]/g, (c) => String(BENGALI_DIGITS.indexOf(c)));

/** Ways a Bangla answer says "none" without writing a zero. */
const SAYS_NONE = /নেই|নাই|শূন্য|কোনো\s*(task|কাজ)?\s*নেই|no tasks|none/i;

/** Statements the KB must never make again (plan D3). ASCII probes only. */
const FORBIDDEN_CLAIMS = [
    /delete the workspace/i,
    /workspace.{0,12}delete kor/i,
    /guest.{0,40}read.?only/i,
];

// ─── transport ───────────────────────────────────────────────────────────────

const login = async () => {
    const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const j = await r.json();
    if (!j.access_token) {
        throw new Error(`login failed (${r.status}): ${JSON.stringify(j).slice(0, 160)}`);
    }
    return j.access_token;
};

const ask = async (token, message) => {
    const res = await fetch(`${API}/assistant/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message }),
    });
    if (!res.ok) return { ok: false, status: res.status, text: "" };
    const raw = await res.text();
    let text = "";
    for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break;
        try {
            text += JSON.parse(payload).delta ?? "";
        } catch {
            /* a partial frame — ignore */
        }
    }
    return { ok: true, status: 200, text };
};

// ─── grading ─────────────────────────────────────────────────────────────────

/**
 * Every STATIC route the app really has — taken from `client/src/router.tsx`,
 * not from memory. Anything else inside a link is fabricated.
 *
 * Dynamic routes (`/s/:spaceId`, `/t/:taskKey`, `/reports/:reportId`, …) are
 * deliberately absent: the bot cannot know an id, so it must never link to one.
 * A link to any of those would show up here as fabricated, which is correct.
 *
 * `/settings` is the index (it redirects to `/settings/profile`) — a real
 * destination, and leaving it out made a correct answer score as a fabrication.
 */
const REAL_ROUTES = [
    "/", "/login", "/forgot-password",
    "/inbox", "/search", "/dept", "/reports", "/forms",
    "/eng", "/eng/sprint", "/eng/on-call",
    "/settings",
    "/settings/profile", "/settings/workspace", "/settings/members",
    "/settings/roles", "/settings/task-types", "/settings/tags",
    "/settings/statuses", "/settings/custom-fields", "/settings/templates",
    "/settings/import-export",
];

/**
 * Is this answer written in Bangla?
 *
 * NOT a raw ASCII ratio. The bot is *supposed* to keep on-screen labels in
 * English ("Settings", "Board view") and to emit link targets like
 * `](/settings/roles)` — both are pure ASCII, so a link-rich, correctly-Bangla
 * answer can read as 50% ASCII and a short one even higher. Measured across
 * real answers the ASCII ratio swings 0.25–0.50 while the share of Bengali
 * LETTERS holds at 0.71–0.92, so that is the honest signal: strip the link
 * targets, then ask what fraction of the letters are Bengali.
 *
 * An English answer scores ~0 and still fails, which is the case that matters.
 */
const isBangla = (text) => {
    const prose = text.replace(/\]\([^)]*\)/g, "");
    const bengali = (prose.match(/[ঀ-৿]/g) || []).length;
    const latin = (prose.match(/[A-Za-z]/g) || []).length;
    if (bengali + latin === 0) return false;
    return bengali / (bengali + latin) >= 0.5;
};

const grade = (text) => {
    const links = [...text.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
    const fabricated = links.filter((l) => !REAL_ROUTES.includes(l));
    const numbered = /(^|\n)\s*(\d+[.)]|[০-৯][.)])/.test(text);
    const bulleted = /(^|\n)\s*[-*•]\s/.test(text);
    return {
        len: text.length,
        links,
        fabricated,
        steps: numbered || bulleted,
        bangla: isBangla(text),
        forbidden: FORBIDDEN_CLAIMS.filter((re) => re.test(text)),
    };
};

// Self-check: the metric must still reject an English answer. A grader that
// cannot fail is not a grader — and this file has already had four bugs.
if (
    isBangla("Open Settings then Profile and click Change password.") ||
    !isBangla("[Settings → Profile](/settings/profile) খুলুন, তারপর পাসওয়ার্ড বদলান।")
) {
    throw new Error("isBangla() is broken — it must reject English and accept Bangla");
}

const pad = (s, n) => String(s).padEnd(n);

// ─── run ─────────────────────────────────────────────────────────────────────

(async () => {
    const token = await login();
    console.log(`assistant eval -> ${API}\n`);

    console.log("A. FIRST-TIMER (can a beginner follow the answer?)");
    console.log("   cat          LINK  STEPS      BN   len   route(s)");
    console.log("   " + "-".repeat(70));
    let links = 0, steps = 0, bangla = 0, fabricated = 0, forbidden = 0;
    let stepsNeeded = 0;
    for (const [cat, q, needsSteps] of FIRST_TIMER) {
        const { ok, status, text } = await ask(token, q);
        if (!ok) {
            console.log(`   ${pad(cat, 13)}HTTP ${status}`);
            continue;
        }
        const g = grade(text);
        if (g.links.length) links++;
        if (needsSteps) {
            stepsNeeded++;
            if (g.steps) steps++;
        }
        if (g.bangla) bangla++;
        fabricated += g.fabricated.length;
        forbidden += g.forbidden.length;
        console.log(
            `   ${pad(cat, 13)}${pad(g.links.length ? "yes" : "--", 6)}${pad(
                g.steps ? "yes" : needsSteps ? "MISSING" : "n/a",
                9,
            )}${pad(g.bangla ? "yes" : "NO", 5)}${pad(g.len, 6)}${
                g.links.join(" ") || "-"
            }`,
        );
    }

    // Ground truth straight from the API the tools read, so "answered" means
    // "returned the RIGHT number" — not merely "contains a digit". A numbered
    // list ("1. …") would satisfy a naive digit check and make a broken tool
    // round-trip look healthy, which is exactly how this metric can lie.
    const kpi = await (
        await fetch(`${API}/home/kpis`, {
            headers: { Authorization: `Bearer ${token}` },
        })
    ).json();
    const truthOf = (key) => String(kpi[key]?.value ?? "");
    console.log(
        `\nB. LIVE DATA (truth: my=${truthOf("myTasks")} due=${truthOf("dueToday")} overdue=${truthOf("overdue")} review=${truthOf("awaitingReview")} team=${truthOf("openTeamTasks")} sla=${truthOf("slaBreaches")})`,
    );
    let answered = 0;
    for (const [q, key] of DATA_QUESTIONS) {
        const { text } = await ask(token, q);
        const want = truthOf(key);
        const ascii = toAsciiDigits(text);
        // Standalone numbers only — "2" inside "2026" or a list's "1." must not count.
        const found = [...ascii.matchAll(/(?<![\d\w])(\d{1,4})(?![\d\w.)])/g)].map(
            (m) => m[1],
        );
        const correct =
            found.includes(want) || (want === "0" && SAYS_NONE.test(text));
        if (correct) answered++;
        process.stdout.write(correct ? "." : "x");
    }
    console.log("");

    const n = FIRST_TIMER.length;
    const rows = [
        ["answers with a clickable route", links, n, TARGET.links],
        ["actionable answers with steps", steps, stepsNeeded, stepsNeeded],
        ["answers in Bangla", bangla, n, TARGET.bangla],
        ["data questions answered", answered, DATA_QUESTIONS.length, TARGET.dataAnswers],
    ];
    console.log("\nSCORE");
    let failed = 0;
    for (const [label, got, total, target] of rows) {
        const pass = got >= target;
        if (!pass) failed++;
        console.log(
            `  ${pad(label, 32)} ${pad(`${got}/${total}`, 8)} target >= ${pad(target, 4)} ${pass ? "PASS" : "FAIL"}`,
        );
    }
    const zeroRows = [
        ["fabricated routes emitted", fabricated],
        ["forbidden claims repeated", forbidden],
    ];
    for (const [label, got] of zeroRows) {
        const pass = got === 0;
        if (!pass) failed++;
        console.log(
            `  ${pad(label, 32)} ${pad(got, 8)} target == 0    ${pass ? "PASS" : "FAIL"}`,
        );
    }

    console.log(`\nVERDICT: ${failed === 0 ? "PERFECT (all targets met)" : `${failed} target(s) below plan`}`);
    if (ASSERT && failed > 0) process.exit(1);
})().catch((e) => {
    console.error("EVAL FAILED:", String(e).slice(0, 300));
    process.exit(2);
});
