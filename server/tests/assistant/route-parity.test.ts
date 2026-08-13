import fs from "fs";
import path from "path";
import { KNOWLEDGE_BASE } from "../../src/assistant/knowledgeBase";

/**
 * THE STRUCTURAL FRESHNESS GUARD (AI_ASSISTANT_PERFECT_PLAN.md P5).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `kb-coverage.test.ts` asserts facts someone thought to write down. That kind
 * of guard can only ever catch the drift you already know about: its twenty
 * Dept-Review assertions all stayed green for the whole time the knowledge base
 * went stale about RBAC, because nobody had written an RBAC assertion yet.
 *
 * This test does not depend on anyone remembering. It reads the ROUTER — the
 * actual list of pages the app has — and fails when the bot does not know one
 * of them. Ship a new page without teaching the bot, and the build stops.
 *
 * It also runs the check in reverse: every address the knowledge base links to
 * must be a page that really exists. That is the "no fabricated routes"
 * guarantee, enforced at build time instead of hoped for at runtime.
 *
 * ── WHY DYNAMIC ROUTES ARE EXCLUDED (landmine L4) ────────────────────────────
 * `/s/:spaceId`, `/t/:taskKey` and friends contain an id the bot cannot know.
 * The knowledge base deliberately tells it never to link one. Demanding those
 * here would force exactly the behaviour we forbid.
 */

const ROUTER = path.resolve(
    __dirname,
    "../../../client/src/router.tsx",
);

/**
 * Router path segment → the full address a user types.
 *
 * The router nests (`settings` → `profile`), so a segment alone is not an
 * address. This map is the join, and it is deliberately HAND-MAINTAINED: when a
 * new page appears, the first test below fails with its name, and whoever adds
 * it here has to decide what the bot should say about it.
 */
const SEGMENT_TO_ROUTE: Record<string, string> = {
    "/": "/",
    "": "/",
    login: "/login",
    "forgot-password": "/forgot-password",
    inbox: "/inbox",
    search: "/search",
    dept: "/dept",
    reports: "/reports",
    // F28 (ISS-082, D12.4) — the breached-SLA queue.
    sla: "/sla",
    forms: "/forms",
    eng: "/eng",
    "eng/sprint": "/eng/sprint",
    "eng/on-call": "/eng/on-call",
    settings: "/settings",
    profile: "/settings/profile",
    workspace: "/settings/workspace",
    members: "/settings/members",
    // Team-access P1 — the org chart / roster page.
    teams: "/settings/teams",
    roles: "/settings/roles",
    "task-types": "/settings/task-types",
    tags: "/settings/tags",
    statuses: "/settings/statuses",
    "custom-fields": "/settings/custom-fields",
    templates: "/settings/templates",
    "import-export": "/settings/import-export",
};

/**
 * Pages a user can reach but the bot has no business linking:
 *  · `/login` and `/forgot-password` are for people who are NOT signed in —
 *    the widget only exists inside the authed shell, so anyone reading a reply
 *    is already past them. The KB still links them in the Account section, so
 *    they are not exempt from the KB check; they are listed here only to
 *    document that a future removal of those links is not a regression.
 */
const NO_LINK_REQUIRED = new Set<string>([]);

const readRouter = (): string => {
    if (!fs.existsSync(ROUTER)) {
        throw new Error(
            `Cannot find ${ROUTER}. This guard compares the assistant's knowledge base against the client's route table; both packages must be checked out.`,
        );
    }
    return fs.readFileSync(ROUTER, "utf8");
};

/** Every `path: "..."` in the router, minus the dynamic and catch-all ones. */
const staticSegments = (): string[] => {
    const src = readRouter();
    const all = [...src.matchAll(/path:\s*"([^"]*)"/g)].map((m) => m[1]);
    return [...new Set(all)].filter((p) => !p.includes(":") && !p.includes("*"));
};

/** Every address the knowledge base links to, e.g. `](/settings/roles)`. */
const linkedRoutes = (): string[] => [
    ...new Set(
        [...KNOWLEDGE_BASE.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]),
    ),
];

describe("route parity — the bot must know every page the app has", () => {
    it("finds the client router (both packages checked out)", () => {
        expect(() => readRouter()).not.toThrow();
        expect(staticSegments().length).toBeGreaterThan(15);
    });

    it("every static route in the router is mapped here", () => {
        // Fails the moment a new page ships. The fix is two lines: map the
        // segment above, then teach the bot about the page in the KB.
        const unmapped = staticSegments().filter(
            (seg) => !(seg in SEGMENT_TO_ROUTE),
        );
        expect({ unmappedRouterPaths: unmapped }).toEqual({
            unmappedRouterPaths: [],
        });
    });

    it("the knowledge base LINKS every page the app has", () => {
        const linked = new Set(linkedRoutes());
        const missing = staticSegments()
            .map((seg) => SEGMENT_TO_ROUTE[seg])
            .filter(
                (route) =>
                    route &&
                    !NO_LINK_REQUIRED.has(route) &&
                    !linked.has(route),
            );
        expect({ pagesTheBotCannotLinkTo: [...new Set(missing)] }).toEqual({
            pagesTheBotCannotLinkTo: [],
        });
    });

    it("the knowledge base never links a page that does not exist", () => {
        // The build-time version of the eval's "fabricated routes" metric.
        const real = new Set(Object.values(SEGMENT_TO_ROUTE));
        const invented = linkedRoutes().filter((r) => !real.has(r));
        expect({ inventedRoutes: invented }).toEqual({ inventedRoutes: [] });
    });

    it("never links a Space, List or task (their ids are unknowable — L4)", () => {
        const dynamic = linkedRoutes().filter((r) =>
            /^\/(s|t)\//.test(r),
        );
        expect(dynamic).toEqual([]);
    });

    it("the EVAL script's allowlist knows every page too (incident six)", () => {
        // `scripts/assistant-eval.cjs` grades "fabricated routes" against its
        // own hardcoded REAL_ROUTES list. That list went stale twice
        // (/settings/teams shipped by team-access, /sla by F28) and a CORRECT
        // live answer graded as a fabrication. This pins the list to the same
        // router-derived map the rest of this file uses — ship a page, and
        // BOTH the KB and the grader must learn it before the build goes
        // green.
        const evalSrc = fs.readFileSync(
            path.resolve(__dirname, "../../scripts/assistant-eval.cjs"),
            "utf8",
        );
        const m = evalSrc.match(/const REAL_ROUTES = \[([\s\S]*?)\];/);
        expect(m).not.toBeNull();
        const listed = new Set(
            [...(m as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map(
                (x) => x[1],
            ),
        );
        const missing = [...new Set(Object.values(SEGMENT_TO_ROUTE))].filter(
            (r) => !listed.has(r),
        );
        expect({ routesTheEvalWouldCallFabricated: missing }).toEqual({
            routesTheEvalWouldCallFabricated: [],
        });
    });

    it("the router really does have dynamic routes, so the exclusion is meaningful", () => {
        // If this ever returns nothing, the exclusion above has quietly become
        // a no-op and the L4 guard is guarding nothing.
        const src = readRouter();
        const dynamic = [...src.matchAll(/path:\s*"([^"]*:[^"]*)"/g)].map(
            (m) => m[1],
        );
        expect(dynamic).toEqual(
            expect.arrayContaining(["s/:spaceId", "t/:taskKey"]),
        );
    });
});
