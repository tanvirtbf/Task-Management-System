import { KNOWLEDGE_BASE } from "../../src/assistant/knowledgeBase";
import { SYSTEM_PROMPT } from "../../src/assistant/systemPrompt";
import { buildMessages } from "../../src/assistant/buildMessages";

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

    it("does NOT describe Guest as read-only (the seeded Guest role holds 19 permissions)", () => {
        // A Guest can create, edit, archive and delete tasks and comment; the
        // only thing they lack that a Member has is attachment upload. Again the
        // assertion targets the claim — "Guest is NOT read-only" must survive.
        expect(KNOWLEDGE_BASE).not.toMatch(/mostly read.?only/i);
        expect(KNOWLEDGE_BASE).not.toMatch(/Guest[^\n]*?\bis read.?only/i);
        expect(KNOWLEDGE_BASE).toMatch(/Guest is NOT read-only/i);
        expect(KNOWLEDGE_BASE).toMatch(/cannot do that a Member can is upload attachments/i);
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

    it("is honest that Recurrence does not create the next task yet (no job generates it)", () => {
        // The field and its UI exist and save; nothing in `src/jobs/` acts on
        // it, so promising repeating tasks would be a lie the user only
        // discovers when the next task never appears.
        expect(KNOWLEDGE_BASE).toMatch(/Recurrence is not automatic yet/i);
        expect(KNOWLEDGE_BASE).toMatch(/does not create the next occurrence/i);
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

    it("is HONEST that per-space and custom-role assignment has no UI yet", () => {
        // `MembersSettings.tsx` hardcodes ["admin","member","guest"] and nothing
        // in the client calls the assignment API. Promising a screen that does
        // not exist is exactly the failure P2 cleaned up.
        expect(KNOWLEDGE_BASE).toMatch(/cannot be done from Settings yet/i);
        expect(KNOWLEDGE_BASE).toMatch(
            /can only set someone to \*\*Admin\*\*, \*\*Member\*\* or \*\*Guest\*\*/i,
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
        const sys = buildMessages([], "x")[0].content as string;
        expect(sys.length).toBeLessThan(39000);
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
