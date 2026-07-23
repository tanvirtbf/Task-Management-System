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
