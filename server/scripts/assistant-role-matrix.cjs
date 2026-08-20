#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * THE PER-ROLE SHIP MATRIX (AI_ASSISTANT_DEEP_PLAN.md P9).
 *
 * `assistant-eval.cjs` grades how WELL the bot answers. This grades whether it
 * answers the same question DIFFERENTLY for different people — which is the
 * whole point of the deep plan, and the one thing a single-account eval can
 * never see. It asks the §4 acceptance questions as every role shape in the
 * workspace and prints an ASCII verdict per cell (this terminal cannot render
 * Bangla), checking each one against the API's own truth rather than against a
 * hardcoded expectation.
 *
 *   node scripts/assistant-role-matrix.cjs      # exits 1 if any cell fails
 *
 * Needs the dev/demo accounts below. Override with MATRIX_USERS as
 * "label=email,label=email,…" when running against another workspace.
 */
const API =
    process.argv.find((a) => a.startsWith("--api="))?.slice(6) ??
    "http://localhost:5501/api/v1";
const PASSWORD = process.env.MATRIX_PASSWORD ?? "Owner@12345";

const USERS = process.env.MATRIX_USERS
    ? process.env.MATRIX_USERS.split(",").map((pair) => pair.split("="))
    : [
          ["owner", "owner@company.local"],
          ["admin", "farhana@beautybooth.com.bd"],
          ["head", "nusrat@beautybooth.com.bd"],
          ["member(2 teams)", "sumaiya@beautybooth.com.bd"],
          ["member(1 team)", "arif@beautybooth.com.bd"],
      ];

const REFUSED = /অনুমতি নেই|দেখতে পারবেন না|দেখতে পারছি না|পারবেন না|খুঁজে পাইনি|দুঃখিত/;

const login = async (email) => {
    const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
    });
    const j = await r.json();
    if (!j.access_token) throw new Error(`login failed for ${email}`);
    return j.access_token;
};

const get = (token, path) =>
    fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(
        (r) => r.json(),
    );

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
    if (!res.ok) return `HTTP_${res.status}`;
    const raw = await res.text();
    let text = "";
    for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const p = line.slice(6).trim();
        if (p === "[DONE]") break;
        try {
            text += JSON.parse(p).delta ?? "";
        } catch {
            /* partial frame */
        }
    }
    return text;
};

const pad = (s, n) => String(s).padEnd(n);
const mark = (ok) => (ok ? "OK  " : "FAIL");

// ── INSIGHTS_PLAN P6 — truths for the person/team cells ─────────────────────
// Swept from the ASKER'S OWN API view (scoped /spaces → /lists → /tasks), so
// every reach shape produces its own truth automatically. Known delta: the
// tool's own-escape can include a co-assigned task in a space the sweep can't
// list; the demo data has none, and a FAIL here is the cue to look.
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const toAscii = (s) => s.replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)));
const standaloneNumbers = (s) =>
    [...toAscii(s).matchAll(/(?<![\d\w])(\d{1,4})(?![\d\w.)])/g)].map((m) => m[1]);
// `হয়নি` — the natural zero for "koyta create hoyeche" (mirrors the eval's
// SAYS_NONE, verified against a live correct answer).
const SAYS_NONE = /নেই|নাই|শূন্য|হয়নি|no tasks|none/i;

/** The asker's visible open tasks assigned to `userId`, and the 7-day created
 *  count for `teamName` (null when the team is not visible to them). */
const sweep = async (token, userId, teamName) => {
    const spaces = (await get(token, "/spaces")).data ?? [];
    const team = spaces.find((s) => s.name === teamName) ?? null;
    let personOpen = 0;
    let teamCreated = team ? 0 : null;
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const sp of spaces) {
        const lists = (await get(token, `/spaces/${sp.id}/lists`)).data ?? [];
        for (const l of lists) {
            const statuses = await get(token, `/lists/${l.id}/statuses`);
            const closed = new Set(
                (Array.isArray(statuses) ? statuses : statuses.data ?? [])
                    .filter((st) => ["done", "closed"].includes(st.status_group))
                    .map((st) => st.id),
            );
            const tasks = (await get(token, `/lists/${l.id}/tasks`)).data ?? [];
            for (const tk of tasks) {
                const open = !closed.has(tk.status_id);
                if (open && (tk.assignees ?? []).includes(userId)) personOpen++;
                if (
                    team &&
                    sp.id === team.id &&
                    new Date(tk.created_at).getTime() >= since
                ) {
                    teamCreated++;
                }
            }
        }
    }
    return { personOpen, teamCreated };
};

(async () => {
    const ownerToken = await login("owner@company.local");
    const directory = (await get(ownerToken, "/teams")).data ?? [];

    // INSIGHTS_PLAN P6 — the person cell's fixed target: a member every seed
    // ships (falls back to the first member found so a reorg cannot break the
    // matrix harness itself).
    const allMembers = directory.flatMap((d) => d.members.map((m) => m.user));
    const target =
        allMembers.find((u) => u.email === "arif@beautybooth.com.bd") ??
        allMembers[0];
    const targetName = `${target.first_name} ${target.last_name}`.trim();
    const STATS_TEAM = "Marketing";

    console.log("P9 SHIP MATRIX -> " + API + "\n");
    console.log(
        pad("role", 16) +
            pad("myTasks", 9) +
            pad("role?", 7) +
            pad("teams?", 8) +
            pad("approv", 8) +
            pad("report", 8) +
            pad("sla", 6) +
            pad("noLeak", 8) +
            pad("howto", 7) +
            pad("person", 9) +
            pad("teamStat", 9) +
            "absLink",
    );
    console.log("-".repeat(108));

    let failures = 0;
    for (const [label, email] of USERS) {
        const t = await login(email);
        const kpi = await get(t, "/home/kpis");
        const spaces = (await get(t, "/spaces")).data ?? [];
        const mine = new Set(spaces.map((s) => s.name));
        const myPeople = new Set(
            directory
                .filter((d) => mine.has(d.space.name))
                .flatMap((d) => d.members.map((m) => m.user.id)),
        );
        const foreign = directory
            .filter((d) => !mine.has(d.space.name))
            .map((d) => ({
                name: d.space.name,
                exclusive: d.members
                    .filter((m) => !myPeople.has(m.user.id))
                    .map((m) => `${m.user.first_name} ${m.user.last_name}`.trim()),
            }))
            .find((d) => d.exclusive.length > 0);
        const headsSomething = directory.some(
            (d) => d.head && d.head.email === email,
        );
        const isAdminish = label === "owner" || label === "admin";

        const answers = {};
        let absLinks = 0;
        const A = async (key, q) => {
            answers[key] = await ask(t, q);
            absLinks += [...answers[key].matchAll(/\]\(http/g)].length;
        };
        await A("tasks", "ami ki ki task e assign asi? list dao");
        await A("role", "amar role ki? ami ki ki korte pari?");
        await A("teams", "ami kon kon team e achi?");
        await A("approv", "amar kache ki kono approval request pending ache?");
        await A("report", "ei shoptaher department report ki ready hoyeche?");
        await A("sla", "kono task ki SLA miss korse?");
        await A("howto", "notun ekta task kivabe banabo?");
        if (foreign) {
            await A("leak", `${foreign.name} team e ke ke ase? list dao`);
        }
        // INSIGHTS_PLAN P6 — the two new families, truth swept per asker.
        const truths = await sweep(t, target.id, STATS_TEAM);
        await A(
            "person",
            `${targetName} er hate ekhon ki kaj ache? list dao`,
        );
        await A(
            "teamStat",
            `${STATS_TEAM} team e last 7 dine koyta task create hoyeche?`,
        );

        // ── verdicts, each against live truth ───────────────────────────────
        const want = Number(kpi?.myTasks?.value ?? 0);
        const listed = [...answers.tasks.matchAll(/\]\(\/t\/[^)]+\)/g)].length;
        const tasksOk = want === 0 ? listed === 0 : listed === Math.min(want, 20);

        // The bot may name the role with its English UI label OR the ordinary
        // Bangla word — "আপনি … একজন সদস্য" is a correct answer, not a miss.
        // (First version of this check demanded the English string and marked
        // two perfectly good answers FAIL. The measuring stick, again.)
        const roleAlts = {
            owner: [/Owner/, /মালিক/],
            admin: [/Admin/, /অ্যাডমিন|এডমিন/],
        }[label] ?? [/Member/, /সদস্য/];
        const roleOk = roleAlts.some((re) => re.test(answers.role));

        const teamsOk =
            spaces.length === 0 ||
            [...mine].some((nm) => answers.teams.includes(nm));

        const approvOk = !answers.approv.startsWith("HTTP_");
        // Owners, admins and heads must NOT be refused; a plain member must be.
        const canReport = isAdminish || headsSomething;
        const reportOk = canReport
            ? !REFUSED.test(answers.report)
            : REFUSED.test(answers.report);
        const slaOk = !answers.sla.startsWith("HTTP_");
        const leakOk = foreign
            ? !foreign.exclusive.some((nm) => answers.leak.includes(nm))
            : true;
        const howtoOk = /\]\(\//.test(answers.howto);

        // INSIGHTS_PLAN P6 — person cell: the listed links must equal the
        // asker's own swept truth (capped at the tool's 15); a truth of 0 must
        // produce ZERO task links — the honest can't-see answer, never rows.
        const personWant = truths.personOpen;
        const personLinks = [
            ...answers.person.matchAll(/\]\(\/t\/[^)]+\)/g),
        ].length;
        const personOk =
            personWant > 0
                ? personLinks === Math.min(personWant, 15)
                : personLinks === 0;

        // teamStat cell: a visible team's answer must carry the swept created
        // count; an invisible team must be refused/not-found with ZERO names
        // of its exclusive members leaked.
        const statsExclusive = directory
            .filter((d) => d.space.name === STATS_TEAM)
            .flatMap((d) => d.members)
            .filter((m) => !myPeople.has(m.user.id))
            .map((m) => `${m.user.first_name} ${m.user.last_name}`.trim());
        let teamStatOk;
        if (truths.teamCreated === null) {
            teamStatOk =
                REFUSED.test(answers.teamStat) &&
                !statsExclusive.some((nm) => answers.teamStat.includes(nm));
        } else {
            const nums = standaloneNumbers(answers.teamStat);
            teamStatOk =
                nums.includes(String(truths.teamCreated)) ||
                (truths.teamCreated === 0 && SAYS_NONE.test(answers.teamStat));
        }

        for (const ok of [tasksOk, roleOk, teamsOk, approvOk, reportOk, slaOk, leakOk, howtoOk, personOk, teamStatOk])
            if (!ok) failures++;
        if (absLinks > 0) failures++;

        console.log(
            pad(label, 16) +
                pad(`${listed}/${want} ${tasksOk ? "" : "!"}`, 9) +
                pad(mark(roleOk), 7) +
                pad(mark(teamsOk), 8) +
                pad(mark(approvOk), 8) +
                pad(mark(reportOk), 8) +
                pad(mark(slaOk), 6) +
                pad(foreign ? mark(leakOk) : "n/a ", 8) +
                pad(mark(howtoOk), 7) +
                pad(`${personLinks}/${personWant} ${personOk ? "" : "!"}`, 9) +
                pad(
                    (truths.teamCreated === null ? "hidden " : `${truths.teamCreated} `) +
                        mark(teamStatOk).trim(),
                    9,
                ) +
                absLinks,
        );
    }

    console.log(
        `\nVERDICT: ${failures === 0 ? "ALL CELLS PASS" : failures + " cell(s) FAILED"}`,
    );
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
    console.error("MATRIX FAILED:", String(e).slice(0, 300));
    process.exit(2);
});
