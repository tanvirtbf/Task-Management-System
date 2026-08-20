import { KNOWLEDGE_BASE } from "../../src/assistant/knowledgeBase";
import { SYSTEM_PROMPT } from "../../src/assistant/systemPrompt";
import { buildMessages } from "../../src/assistant/buildMessages";
import { ASSISTANT_TOOL_DEFS } from "../../src/assistant/tools";

/**
 * KB FRESHNESS GUARDRAIL (AI_ASSISTANT_UPGRADE_PLAN.md — created P1, grown in
 * P2/P3/P4). Pure deterministic content assertions on the knowledge base — no
 * OpenAI, no DB. Purpose: if a shipped feature is missing from the KB, or a
 * stale/false claim creeps back in, an assertion here fails — forcing the KB
 * to stay accurate (closes gap A5 in AI_ASSISTANT_GAP_ANALYSIS.md).
 *
 * P1 scope = the "de-stale / core refresh" facts. Later phases append their own
 * describe blocks (P2: full Department-Review section; P3: URL patterns).
 */
describe("KB coverage — P1 core refresh", () => {
    describe("removed / corrected stale claims", () => {
        it("does NOT claim a Ctrl+K / Cmd+K command palette (it does not exist — Search just routes to /search)", () => {
            expect(KNOWLEDGE_BASE).not.toMatch(/ctrl\s*\+\s*k/i);
            expect(KNOWLEDGE_BASE).not.toMatch(/cmd\s*\+\s*k/i);
            expect(KNOWLEDGE_BASE).not.toMatch(/command palette/i);
        });

        it("does NOT carry the stale 'invite not finished yet' claim (the accept flow works)", () => {
            expect(KNOWLEDGE_BASE).not.toMatch(/not finished yet/i);
        });
    });

    describe("added / refreshed facts", () => {
        it("lists Department and Reports as navigation destinations", () => {
            expect(KNOWLEDGE_BASE).toMatch(/\bDepartment\b/);
            expect(KNOWLEDGE_BASE).toMatch(/\bReports\b/);
        });

        it("mentions the department Head role", () => {
            expect(KNOWLEDGE_BASE).toMatch(/\bHead\b/);
        });

        it("notifications now include review + weekly-report events", () => {
            expect(KNOWLEDGE_BASE).toMatch(/review/i);
            expect(KNOWLEDGE_BASE).toMatch(/weekly department report/i);
        });

        it("describes the Home dashboard KPIs (e.g. due today / awaiting review)", () => {
            expect(KNOWLEDGE_BASE).toMatch(/due today/i);
            expect(KNOWLEDGE_BASE).toMatch(/awaiting (your )?review/i);
        });
    });

    describe("string safety (must survive the TS template literal)", () => {
        it("contains no backtick or dollar-brace sequence inside the content", () => {
            expect(KNOWLEDGE_BASE).not.toMatch(/`/);
            expect(KNOWLEDGE_BASE).not.toContain("${");
        });
    });
});

/**
 * DEEP PLAN P1 — the nirbhul audit (2026-08-13).
 *
 * Every assertion below is a claim that was WRONG in the knowledge base and is
 * now fixed. They are pinned because a stale fact is invisible: the bot keeps
 * answering confidently, and nobody finds out until someone in the office acts
 * on it. Each `not.toMatch` is the old, false sentence.
 */
describe("KB coverage — DEEP P1 nirbhul audit", () => {
    it("describes the CURRENT Guest, not the pre-F28 one that could delete tasks", () => {
        // GUEST_GRANTS (rbac/bootstrap.ts) = view spaces/tasks/members/activity,
        // comment, assistant.use, bug.report. Nothing else. The KB used to say a
        // Guest could "create, edit, archive and delete tasks".
        expect(KNOWLEDGE_BASE).not.toMatch(
            /Guest is NOT read-only|Guest can view the workspace and create, edit, archive and delete/i,
        );
        expect(KNOWLEDGE_BASE).toMatch(
            /Guest CANNOT create, edit, assign, archive or delete tasks/,
        );
        expect(KNOWLEDGE_BASE).toMatch(/cannot read form submissions/i);
    });

    it("does not promise status create/rename/delete — the page only reorders", () => {
        // StatusesSettings.tsx carries exactly one mutation: reorder.
        expect(KNOWLEDGE_BASE).not.toMatch(
            /manage the workflow statuses of a List and reorder/,
        );
        expect(KNOWLEDGE_BASE).toMatch(
            /Creating, renaming or deleting a status is NOT available/,
        );
    });

    it("says Import / Export does not work yet, instead of offering it", () => {
        // Every importer answers "coming soon"; the export button only shows a
        // success toast and produces no file.
        expect(KNOWLEDGE_BASE).toMatch(/Import \/ Export.*not working yet/s);
        expect(KNOWLEDGE_BASE).not.toMatch(
            /Import \/ Export\]\(\/settings\/import-export\) — bring data in/,
        );
    });

    it("teaches that checklists and their items can be RENAMED, and shows progress", () => {
        // Upgrade 022 + the checklist edit work: click-to-edit name and item
        // text, delete an item, done/total + % on the task and its card.
        expect(KNOWLEDGE_BASE).toMatch(/to rename it/);
        expect(KNOWLEDGE_BASE).toMatch(/done\/total with a percentage/);
    });

    it("presents team access as TWO modes and refuses to assert which one is live", () => {
        // 019/020 are a deliberate operator decision. Until they are applied the
        // scoped rules do not bite, so stating them as fact was wrong for every
        // reader in an open workspace.
        expect(KNOWLEDGE_BASE).not.toMatch(
            /Since the team-access update \(August 2026\) the workspace is TEAM-SCOPED/,
        );
        expect(KNOWLEDGE_BASE).toMatch(/setting an Admin turns on/);
        expect(KNOWLEDGE_BASE).toMatch(/never assert which mode someone is in/);
        // the reader must be given a way to work out the mode for themselves
        expect(KNOWLEDGE_BASE).toMatch(/How to tell:.*Sidebar Space tree/s);
    });

    it("no longer claims a per-space role cannot be given (the Teams page does exactly that)", () => {
        expect(KNOWLEDGE_BASE).not.toMatch(
            /giving someone a role inside only one Space, \*\*cannot be done from Settings yet\*\*/,
        );
        // ...while keeping the part that is still true: no UI assigns a CUSTOM
        // role to one person (rbacApi.assignRole has no caller in any page).
        expect(KNOWLEDGE_BASE).toMatch(
            /no screen yet for giving a custom role to a person/,
        );
    });

    it("does not promise the Apply-template button, which no page renders", () => {
        // `POST /templates/:id/apply` exists in http/api.ts with no caller
        // anywhere; the Templates settings page's own subtitle advertises the
        // button. The KB must not repeat the product's own wrong promise.
        expect(KNOWLEDGE_BASE).not.toMatch(
            /apply them to a List to create tasks quickly/,
        );
        expect(KNOWLEDGE_BASE).toMatch(/not in the app yet/);
    });

    it("teaches the permanent-delete APPROVAL, not the old admin-only instant delete", () => {
        // upgrades/023: anyone who may delete a task can now ASK; an
        // Owner/Admin approves. The bot must not tell a member the option does
        // not exist for them, nor imply their click destroys anything.
        // NB: which BUTTON a person sees is computed into the caller block
        // (see caller-context.test.ts) — telling the model to branch on the
        // permission here did not work. The knowledge base owns what the flow
        // MEANS, which is what these pin.
        expect(KNOWLEDGE_BASE).toMatch(/never refuse this question/);
        expect(KNOWLEDGE_BASE).toMatch(/Delete pending/);
        expect(KNOWLEDGE_BASE).toMatch(/the asker can withdraw/);
        // …and must keep the distinction from Archive, which IS reversible.
        expect(KNOWLEDGE_BASE).toMatch(/use \*\*Archive\*\* — that is reversible/);
    });

    it("drops the pre-SSE 'notifications refresh about once a minute' claim", () => {
        expect(KNOWLEDGE_BASE).not.toMatch(/refresh about once a minute/i);
        expect(KNOWLEDGE_BASE).toMatch(/updates live, no refresh needed/);
    });
});

/**
 * DEFECT-1 (deep P0): the bot answered in ROMAN letters when the question was
 * typed in Roman letters — measured at 2 failures in 3 runs on one question,
 * ratio 0.009 Bengali. This office types Banglish, so the rule has to be
 * explicit about SCRIPT, not just about language.
 */
describe("System prompt — Bangla SCRIPT, never romanized (DEFECT-1)", () => {
    it("names the Bengali script requirement explicitly", () => {
        expect(SYSTEM_PROMPT).toMatch(/BENGALI SCRIPT/);
        expect(SYSTEM_PROMPT).toMatch(/never in Roman letters/i);
    });

    it("shows the wrong-vs-right example, so the rule is demonstrated not just stated", () => {
        expect(SYSTEM_PROMPT).toMatch(/is WRONG, no matter how the question was typed/);
        expect(SYSTEM_PROMPT).toMatch(/[ঀ-৿]/); // real Bangla in the example
    });
});

describe("KB coverage — P2 Department Review + Reports", () => {
    it("references the /dept and /reports page paths", () => {
        expect(KNOWLEDGE_BASE).toMatch(/\/dept\b/);
        expect(KNOWLEDGE_BASE).toMatch(/\/reports\b/);
    });

    it("explains the Head (set on the Space page) and the review verdicts", () => {
        expect(KNOWLEDGE_BASE).toMatch(/Department head/i);
        expect(KNOWLEDGE_BASE).toMatch(/\bApprove\b/);
        expect(KNOWLEDGE_BASE).toMatch(/\bFlag\b/);
        expect(KNOWLEDGE_BASE).toMatch(/Needs review/i);
    });

    it("explains the weekly report + Mark seen + Regenerate + head note", () => {
        expect(KNOWLEDGE_BASE).toMatch(/weekly report/i);
        expect(KNOWLEDGE_BASE).toMatch(/mark seen/i);
        expect(KNOWLEDGE_BASE).toMatch(/regenerate/i);
        expect(KNOWLEDGE_BASE).toMatch(/head.?s note/i);
    });

    it("scopes Department/Reports away from Members and Guests", () => {
        expect(KNOWLEDGE_BASE).toMatch(/Members and Guests do not see/i);
    });
});

describe("KB coverage — P3 URL / link layer", () => {
    it("has a page-address reference for the main static routes", () => {
        for (const path of [
            "/inbox",
            "/search",
            "/dept",
            "/reports",
            "/forms",
            "/eng",
            "/eng/sprint",
            "/eng/on-call",
            "/settings/profile",
            "/settings/members",
            "/settings/workspace",
        ]) {
            expect(KNOWLEDGE_BASE).toContain(path);
        }
    });

    it("quick-answers use in-app markdown links to real routes", () => {
        expect(KNOWLEDGE_BASE).toMatch(/\[[^\]]+\]\(\/inbox\)/);
        expect(KNOWLEDGE_BASE).toMatch(/\[[^\]]+\]\(\/settings\/profile\)/);
        expect(KNOWLEDGE_BASE).toMatch(/\[[^\]]+\]\(\/search\)/);
        expect(KNOWLEDGE_BASE).toMatch(/\[[^\]]+\]\(\/dept\)/);
    });

    it("does NOT fabricate Space/List/task addresses (dynamic — opened via Sidebar)", () => {
        expect(KNOWLEDGE_BASE).not.toMatch(/\/t\//);
        expect(KNOWLEDGE_BASE).not.toMatch(/\/s\//);
    });
});

describe("System prompt — P4 (Bangla-always + links + roles)", () => {
    it("instructs Bangla-always and drops 'same language as the user'", () => {
        expect(SYSTEM_PROMPT).toMatch(/always reply in.*bangla/i);
        expect(SYSTEM_PROMPT).not.toMatch(/same language/i);
    });

    it("instructs emitting in-app links and never inventing an address", () => {
        expect(SYSTEM_PROMPT).toMatch(/markdown link/i);
        expect(SYSTEM_PROMPT).toMatch(/never invent an address/i);
    });

    it("no longer references a Ctrl+K shortcut / command palette", () => {
        expect(SYSTEM_PROMPT).not.toMatch(/ctrl\s*\+\s*k/i);
        expect(SYSTEM_PROMPT).not.toMatch(/command palette/i);
    });

    it("states the role limits (Owners/Admins/Heads) for gated areas", () => {
        expect(SYSTEM_PROMPT).toMatch(
            /Department.*Reports.*only for Owners, Admins/i,
        );
    });

    it("the assembled system message carries the prompt + the KB URL block", () => {
        const msgs = buildMessages([], "test");
        expect(msgs[0].role).toBe("system");
        const sys = msgs[0].content;
        expect(sys).toContain("KNOWLEDGE BASE");
        expect(sys).toContain("/dept");
        expect(sys).toContain("/settings/profile");
        expect(sys).toMatch(/always reply in.*bangla/i);
    });

    it("system prompt is string-safe (no backtick / dollar-brace)", () => {
        expect(SYSTEM_PROMPT).not.toMatch(/`/);
        expect(SYSTEM_PROMPT).not.toContain("${");
    });
});

// P12 freshness net (gap A5): every shipped feature area MUST appear in the KB.
// Shipping a feature without a KB entry should FAIL a row here — that is the
// point. When you add a feature: update knowledgeBase.ts, then add its row.
describe("KB feature manifest (freshness net)", () => {
    it.each([
        ["spaces", /space/i],
        ["lists", /list/i],
        ["tasks", /task/i],
        ["board/calendar views", /board view/i],
        ["comments", /comment/i],
        ["checklists", /checklist/i],
        ["attachments", /attachment/i],
        ["forms", /form/i],
        ["search", /search/i],
        ["notifications", /notification/i],
        ["engineering", /engineering/i],
        ["department review", /department/i],
        ["reports", /report/i],
        ["settings", /settings/i],
        ["roles", /owner|admin|member|guest/i],
    ] as const)("KB covers %s", (_label, re) => {
        expect(KNOWLEDGE_BASE).toMatch(re);
    });
});

/**
 * P2 (AI_ASSISTANT_PERFECT_PLAN.md) — the false statements, removed at source.
 *
 * Each of these was found by checking the KB claim against the LIVE system, and
 * each is worded so the test fails if the claim ever comes back. A confused user
 * acting on a confidently wrong answer is worse off than one told "I don't know".
 */
describe("KB accuracy — P2: no false claims", () => {
    it("does NOT promise that the workspace can be deleted (no such endpoint exists)", () => {
        // `routes/workspace.ts` has GET and PATCH only — there is no delete.
        // The assertion targets the CLAIM, not the denial: the KB is allowed to
        // say "there is no way to delete the workspace", which is the fix.
        expect(KNOWLEDGE_BASE).not.toMatch(/including delet\w*\s+the\s+workspace/i);
        expect(KNOWLEDGE_BASE).not.toMatch(/can\s+delete\s+the\s+workspace/i);
        expect(KNOWLEDGE_BASE).toMatch(/no way to delete the workspace/i);
    });

    it("describes the Guest the seeded role ACTUALLY grants (7 keys, not the old 19)", () => {
        // ⚠️ REVERSED by DEEP P1 (2026-08-13). This assertion used to demand the
        // OPPOSITE — "Guest is NOT read-only… the only thing they lack is
        // attachment upload" — which was true when it was written and became
        // false when F28/D12.1 cut GUEST_GRANTS from 19 keys to 7 after finding
        // that a guest could delete any task and read every public-form
        // submission. The KB kept the old sentence for months, so the bot was
        // telling admins that Guests could delete work. The pin now follows
        // `rbac/bootstrap.ts`: view spaces/tasks/members/activity, comment,
        // assistant.use, bug.report — and nothing else.
        expect(KNOWLEDGE_BASE).not.toMatch(/Guest is NOT read-only/i);
        expect(KNOWLEDGE_BASE).not.toMatch(
            /cannot do that a Member can is upload attachments/i,
        );
        expect(KNOWLEDGE_BASE).toMatch(
            /Guest CANNOT create, edit, assign, archive or delete tasks/,
        );
    });

    it("lists the Roles & permissions settings page (the live nav has 10 sections, not 9)", () => {
        expect(KNOWLEDGE_BASE).toMatch(/\*\*Roles & permissions\*\*/);
    });

    it("does NOT claim permissions are fixed to Admin/Owner (they are configurable)", () => {
        expect(KNOWLEDGE_BASE).not.toMatch(
            /Most setup and management actions[^\n]*need Admin or Owner/i,
        );
        expect(KNOWLEDGE_BASE).toMatch(/configurable/i);
    });

    it("does NOT claim Spaces/Lists/tasks have no address — it says do not LINK to them", () => {
        // They do have addresses (/s/:id, /s/:id/l/:id, /t/:id); the bot simply
        // cannot know the ids, which is a different (and honest) reason.
        expect(KNOWLEDGE_BASE).not.toMatch(/do NOT have fixed addresses/i);
        expect(KNOWLEDGE_BASE).toMatch(
            /never write a link to a Space, List or task/i,
        );
    });

    it("names all SEVEN task types (Incident was missing)", () => {
        for (const type of [
            "Task",
            "Bug",
            "Feature",
            "Campaign",
            "Order",
            "Complaint",
            "Incident",
        ]) {
            expect(KNOWLEDGE_BASE).toContain(type);
        }
        // The core-structure sentence must carry the full list, not five of them.
        expect(KNOWLEDGE_BASE).toMatch(
            /Campaign, Order, Complaint or Incident/,
        );
    });

    it("no longer claims Recurrence is dead — upgrades/024 gave it a job", () => {
        // ⚠️ REVERSED (2026-08-16). This used to assert the OPPOSITE, and was
        // right to: the picker saved a pattern and nothing in `src/jobs/` ever
        // read it, so promising repeating tasks would have been a lie the user
        // discovers when the next task never appears. `recurrence-spawn` now
        // creates it, so the honest limitation became a stale one — the exact
        // failure mode this file exists to catch, in the good direction.
        expect(KNOWLEDGE_BASE).not.toMatch(/Recurrence is not automatic yet/i);
        expect(KNOWLEDGE_BASE).not.toMatch(
            /does not create the next occurrence/i,
        );
        expect(KNOWLEDGE_BASE).toMatch(/How do I make a task repeat every day/);
        // …and the promise it replaces it with is the one the job keeps:
        // a fresh copy, named with the date, carrying nothing.
        expect(KNOWLEDGE_BASE).toMatch(/Stock check — 17 Aug 2026/);
        expect(KNOWLEDGE_BASE).toMatch(/no assignee, no dates, no checklist/);
    });

    it("still contains no backtick or dollar-brace (the literal must stay valid)", () => {
        expect(KNOWLEDGE_BASE).not.toMatch(/`/);
        expect(KNOWLEDGE_BASE).not.toMatch(/\$\{/);
    });
});

/**
 * P3 (AI_ASSISTANT_PERFECT_PLAN.md) — the RBAC feature, taught accurately.
 *
 * The bot could not answer the flagship question of the newest feature; worse,
 * it sent people to Settings → Members, which cannot do it. These assertions pin
 * both halves: what the product CAN do, and — just as important — the honest
 * limit, because the per-space assignment screen does not exist yet.
 */
describe("KB coverage — P3: roles & permissions", () => {
    it("gives the roles page as a real in-app link", () => {
        expect(KNOWLEDGE_BASE).toMatch(
            /\[Roles & permissions\]\(\/settings\/roles\)/,
        );
        // …and in the page-address block. P4 turned that block from plain text
        // into links, so the address now appears in link form there too.
        expect(
            (KNOWLEDGE_BASE.match(/\[Roles & permissions\]\(\/settings\/roles\)/g) ?? [])
                .length,
        ).toBeGreaterThanOrEqual(2);
    });

    it("explains the permission grid and that a change is instant", () => {
        expect(KNOWLEDGE_BASE).toMatch(/permission grid/i);
        expect(KNOWLEDGE_BASE).toMatch(/New role/);
        expect(KNOWLEDGE_BASE).toMatch(/very next click/i);
    });

    it("names all three scopes in the UI's own words", () => {
        // These must match `RolesSettings.tsx`'s SCOPE_LABEL exactly, or the bot
        // describes buttons that do not exist on the screen.
        expect(KNOWLEDGE_BASE).toMatch(/\*\*Everywhere\*\*/);
        expect(KNOWLEDGE_BASE).toMatch(/\*\*Their spaces\*\*/);
        expect(KNOWLEDGE_BASE).toMatch(/\*\*Own items\*\*/);
    });

    it("identifies See spaces as the master visibility switch", () => {
        expect(KNOWLEDGE_BASE).toMatch(/See spaces/);
        expect(KNOWLEDGE_BASE).toMatch(/master switch/i);
    });

    it("says the Owner role cannot be edited (the anti-lockout floor)", () => {
        expect(KNOWLEDGE_BASE).toMatch(/Owner\*\* role is shown but cannot be edited/i);
    });

    it("is HONEST about custom-role assignment — but no longer denies PER-SPACE roles", () => {
        // ⚠️ HALF-REVERSED by DEEP P1. Both halves were true when written; the
        // team-access Teams page then shipped, and putting someone on a team IS
        // granting them the seeded Member role scoped to that space — so
        // "per-space cannot be done" became false while "no UI gives ONE person
        // a CUSTOM role" stayed true (`rbacApi.assignRole` still has no caller
        // in any page; MembersSettings hardcodes admin/member/guest). The KB
        // contradicted itself for a while, which is the likeliest reason the
        // live bot produced a garbled answer to this exact question.
        expect(KNOWLEDGE_BASE).not.toMatch(/cannot be done from Settings yet/i);
        expect(KNOWLEDGE_BASE).toMatch(
            /no screen yet for giving a custom role to a person/,
        );
        expect(KNOWLEDGE_BASE).toMatch(
            /only offers \*\*Admin\*\*, \*\*Member\*\* or \*\*Guest\*\*/i,
        );
    });

    it("explains what a permission refusal means and who to ask", () => {
        expect(KNOWLEDGE_BASE).toMatch(/don't have permission/i);
        expect(KNOWLEDGE_BASE).toMatch(/not a bug/i);
    });

    it("adds quick answers for the two questions that failed live", () => {
        expect(KNOWLEDGE_BASE).toMatch(/How do I create a new role\?/);
        expect(KNOWLEDGE_BASE).toMatch(/How do I stop someone seeing other departments\?/);
    });
});

/**
 * P4 (AI_ASSISTANT_PERFECT_PLAN.md) — the link layer.
 *
 * The bot's purpose is to TAKE a confused person somewhere, not just describe
 * it. At the P0 baseline only 3 of 15 answers carried a clickable route,
 * because the KB held 11 links across 2 of its 18 sections and wrote every
 * address as plain text. These assertions keep the addresses in LINK form.
 */
describe("KB coverage — P4: every destination is a link", () => {
    /** Static routes a beginner is actually sent to. Dynamic ones are excluded
     *  on purpose — the bot must never construct an id. */
    const LINKED_ROUTES = [
        "/",
        "/inbox",
        "/search",
        "/dept",
        "/reports",
        "/forms",
        "/eng",
        "/eng/sprint",
        "/eng/on-call",
        "/settings",
        "/settings/profile",
        "/settings/workspace",
        "/settings/members",
        "/settings/roles",
        "/settings/task-types",
        "/settings/tags",
        "/settings/statuses",
        "/settings/custom-fields",
        "/settings/templates",
        "/settings/import-export",
        "/login",
        "/forgot-password",
    ];

    // Plain substring, no regex: "](/inbox)" can only be the tail of a markdown
    // link, and there is no escaping to get wrong.
    it.each(LINKED_ROUTES)(
        "%s appears as a markdown link, not bare text",
        (route) => {
            expect(KNOWLEDGE_BASE).toContain("](" + route + ")");
        },
    );

    it("the sidebar list links every destination it names", () => {
        for (const [label, route] of [
            ["Home", "/"],
            ["Inbox", "/inbox"],
            ["Search", "/search"],
            ["Department", "/dept"],
            ["Reports", "/reports"],
            ["Engineering", "/eng"],
            ["Settings", "/settings"],
        ] as const) {
            expect(KNOWLEDGE_BASE).toContain(`[**${label}**](${route})`);
        }
    });

    it("carries far more links than the 11 it had before this phase", () => {
        const count = (KNOWLEDGE_BASE.match(/\]\(\//g) ?? []).length;
        expect(count).toBeGreaterThanOrEqual(60);
    });

    it("still never links a Space, List or task (dynamic ids)", () => {
        expect(KNOWLEDGE_BASE).not.toMatch(/\]\(\/s\//);
        expect(KNOWLEDGE_BASE).not.toMatch(/\]\(\/t\//);
    });

    it("keeps the whole system message inside its size budget (landmine L2)", () => {
        // It ships on EVERY request, so growth is a latency and cost decision,
        // not a free one. Baseline before P4 was ~27.6k chars. Raised 34k →
        // 38k for team-access P10 (2026-08-11): visibility, edit rights and
        // the approval flow are now the app's OPERATING MODEL — "why can't I
        // see/edit/assign" is exactly what the office will ask this bot, and
        // ~1k extra tokens on gpt-4o-mini is the cheap side of that trade.
        // Raised 38k → 39k for create_task (2026-08-13): the CREATING A TASK
        // section is the bot's only write authority, and each of its rules
        // exists because a live probe failed without it (re-asking a named
        // list, unasked self-assign, absolute-domain links). Compressing
        // behaviour rules to dodge a budget is the wrong trade; the budget
        // moves, with this paper trail, instead.
        //
        // Raised 39k → 43k by DEEP PLAN P1 (2026-08-13), the nirbhul audit.
        // The growth is corrections, not padding, and two items dominate it:
        //   · team access is now described as the TWO MODES it really has
        //     (open vs team-scoped, decided by role reach) instead of
        //     asserting the scoped one — the KB was telling the office rules
        //     that are not switched on for them yet;
        //   · the Banglish rule, which exists because the bot demonstrably
        //     answered in Roman letters 2 times out of 3 on one question.
        // Paid for partly by trimming genuinely dead text (the "brand-new
        // empty workspace" setup walkthrough — this workspace is long past
        // that) and by compressing P1's own prose once it was written.
        // ~42.5k after P1; the ceiling left room for P2's <=400-char caller
        // block. It is NOT a licence to grow: P7 (guidance polish) owns a
        // read-the-whole-KB pass for fat, and any phase that needs more space
        // writes its reason here first.
        //
        // Raised 44k → 46k by P2 (2026-08-13). The caller BLOCK came in on
        // budget (<=400, enforced in code and tested), but P2 also had to
        // teach the bot what to DO with it — role-aware guidance and the
        // honest-denial wording — and those rules are the whole point of the
        // phase: they are what turns "permission nei" from silence into an
        // answer. Written, then compressed ~20% once they existed on the page.
        //
        // Raised 46k → 47k by P4–P7 (2026-08-13), which took the bot from 4
        // tools to 10 (people, approvals, reports, SLA). P3 and this phase
        // BOTH paid their own way first — the Sidebar/Where-things-live
        // duplication, the Search and Assigning sections, and the roles
        // walkthrough were all compressed rather than the budget moved — and
        // the last 1k is two rules that each exist because a live probe
        // failed without them: never refuse a data question from the role
        // rules (it told a department Head she could not read her own team's
        // reports), and an empty result is not a permission problem.
        //
        // Raised 47k → 48k for the permanent-delete approval (2026-08-16).
        // The product genuinely grew a workflow the bot has to explain, and
        // two of the added lines exist because a live probe was WRONG without
        // them: the bot told a Member she could not delete a task at all, and
        // told an ADMIN to file a request. Four earlier phases paid their own
        // way by deleting real duplication; there is no fifth duplication left
        // to spend, so the ceiling moves instead of the accuracy.
        const sys = buildMessages([], "x")[0].content as string;
        expect(sys.length).toBeLessThan(48000);
    });

    it("keeps the TOOL DEFINITIONS inside their own budget", () => {
        // The defs ride every request in the `tools` parameter — they are NOT
        // inside the system message, so the budget above never saw them, and
        // they more than doubled (3,143 → ~7k) when P4–P6 added six tools.
        // Pinned here so the next tool is a decision, not a drift.
        //
        // Raised 8k → 9k for INSIGHTS_PLAN P3 (2026-08-19): `get_person_tasks`
        // is the 11th tool — another person's task list/history through the
        // asker's SQL-scoped visibility, the plan's headline ask. Its
        // description carries the routing triggers gpt-4o-mini demonstrably
        // needs (the person_workload fabrication incident), and P3 paid what
        // it could first: person_workload's description was cut to the quick
        // count it actually is, and the system-prompt sentence it replaces
        // SHRANK the system message by 81 chars. Measured after: 8,422.
        //
        // Raised 9k → 9.5k for INSIGHTS_PLAN P4 (same day): `get_team_stats`
        // is the 12th — team-window analytics behind the same scoped SQL. Its
        // description was trimmed 73 chars first; what remains is the routing
        // triggers and the anti-enumeration instruction, which are the parts
        // that keep the model honest. Measured after: 9,020.
        expect(JSON.stringify(ASSISTANT_TOOL_DEFS).length).toBeLessThan(9500);
    });

    it("every tool description says WHEN to use it, not just what it is", () => {
        // The routing failure this catches: a tool the model never calls is
        // worse than no tool, because the model answers from the KB instead
        // and can contradict the person's real permissions.
        // The union type also allows a "custom" tool shape; ours are all
        // function tools, which this narrowing asserts in passing.
        for (const t of ASSISTANT_TOOL_DEFS) {
            expect(t.type).toBe("function");
            const fn = (t as { function: { description?: string } }).function;
            expect(fn.description ?? "").toMatch(/use|call/i);
            expect((fn.description ?? "").length).toBeGreaterThan(60);
        }
    });

    it("costs nothing extra when there is no caller block (the degraded path)", () => {
        // `buildCallerBlock` returns "" on any failure, and the prompt must
        // then read exactly as it did before — no stray blank line, no
        // dangling "You are talking to".
        // NB: the prompt's own rule QUOTES the phrase ("the line starting
        // 'You are talking to ...'"), so the test must look for a LINE that
        // starts with it — a plain substring check passes vacuously.
        const callerLine = (msg: string): string | undefined =>
            msg.split("\n").find((l) => l.startsWith("You are talking to"));

        const bare = buildMessages([], "x")[0].content as string;
        expect(callerLine(bare)).toBeUndefined();

        const withBlock = buildMessages(
            [],
            "x",
            "You are talking to A B — Member, teams: X.",
        )[0].content as string;
        expect(callerLine(withBlock)).toBe(
            "You are talking to A B — Member, teams: X.",
        );
        expect(withBlock.length).toBeGreaterThan(bare.length);
    });
});

describe("System prompt — P4: the always-give-a-destination rule", () => {
    it("requires every answer to end with a clickable link", () => {
        expect(SYSTEM_PROMPT).toMatch(
            /EVERY answer must give the person somewhere to start/i,
        );
        expect(SYSTEM_PROMPT).toMatch(/end it with at least one clickable link/i);
    });

    it("names the fallback destination for things with no address of their own", () => {
        // A Space / List / task has no linkable address, so the prompt must say
        // which page to send someone to instead — otherwise the model falls back
        // to "open it from the Sidebar", which is the instruction a confused
        // person cannot act on. This rule is what moved links 7/15 -> 14/15.
        for (const route of ["(/)", "(/search)", "(/inbox)"]) {
            expect(SYSTEM_PROMPT).toContain(route);
        }
    });

    it("still allows no link when the question genuinely has no page", () => {
        expect(SYSTEM_PROMPT).toMatch(/Only skip the link when/i);
    });
});


describe("KB coverage — team access + cross-team approval (P10, 2026-08-11)", () => {
    it("states the team-scoped default (members see only their own team)", () => {
        expect(KNOWLEDGE_BASE).toContain("Member or Guest sees only their own team's");
        expect(KNOWLEDGE_BASE).toContain("Owners and Admins still see everything");
    });

    it("no longer claims team membership is automatic from assignments", () => {
        expect(KNOWLEDGE_BASE).not.toContain("Team membership is automatic");
        expect(KNOWLEDGE_BASE).toContain("managed on the [Teams](/settings/teams) page");
    });

    it("states the edit-rights rule (assignees, creator, the owning team's Head, admins)", () => {
        expect(KNOWLEDGE_BASE).toContain("Who can edit a task");
        expect(KNOWLEDGE_BASE).toContain("View only");
    });

    it("explains the cross-team assignment request + the deciders", () => {
        expect(KNOWLEDGE_BASE).toContain("assignment request");
        expect(KNOWLEDGE_BASE).toContain("never by the person who asked");
        expect(KNOWLEDGE_BASE).toContain("expires after 7 days");
    });

    it("routes people to the Inbox Requests tab and the drawer panel", () => {
        expect(KNOWLEDGE_BASE).toContain('"Requests" tab');
        expect(KNOWLEDGE_BASE).toContain("Assignment approval");
    });

    it("quick-answers cover the three questions the office will actually ask", () => {
        expect(KNOWLEDGE_BASE).toContain("Why can't I see another team's Space or tasks?");
        expect(KNOWLEDGE_BASE).toContain(
            "Why can't I edit this task (\"View only\")?",
        );
        expect(KNOWLEDGE_BASE).toContain("I assigned someone but they were not added");
    });
});
