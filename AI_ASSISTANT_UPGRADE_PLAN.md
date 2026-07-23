# 🤖 AI Help Assistant — Upgrade Plan (phase-wise)

**Goal:** turn the existing chatbot into a genuinely great help guide for **non-technical
Bangla users** — up-to-date knowledge, **clickable in-app links** that actually navigate,
**"go here → do this"** step-by-step answers, **persistent starter questions** for
first-timers, **first-time onboarding**, **Bangla answers**, and maximum UX. This plan closes
every gap in `AI_ASSISTANT_GAP_ANALYSIS.md` (features F1–F8).

**How to use this plan:** it is split into small phases. You say **"AI phase 1 koren"**,
**"AI phase 6 koren"**, etc., and ONLY that phase is built → tested → verified → logged to
`AI_ASSISTANT_BUILD_LOG.md`. One phase at a time. Nothing is built until you ask.

**Grounded:** every phase below was written after reading the actual files
(`knowledgeBase.ts`, `systemPrompt.ts`, `buildMessages.ts`, `tools.ts`, `AssistantWidget.tsx`,
`stores/chat.ts`, `http/assistant.ts`, `jest.assistant` tests, `e2e/assistant.pw.ts`,
`router.tsx`) — so the file names, seams, and test approach are real, not assumed.

---

## 1. What we are (and are NOT) doing

**Doing:** refresh + link-enable the knowledge base; make the bot answer in Bangla with
clickable links; make links navigate inside the app; add persistent/role-aware starter
questions; add first-time onboarding; harden error/offline UX + accessibility; add a
KB-freshness guardrail so this never silently goes stale again.

**NOT doing (out of scope, on purpose):**
- **No RAG / vector DB** — keep the proven KB-in-system-prompt design (D-2). The KB is small; gpt-4o-mini handles it.
- **No model change**, no new paid infra. Stays `gpt-4o-mini`, backend-only key.
- **No write/act-on-behalf** — the bot stays read-only + guide-only (injection-safe).
- **No touching the working plumbing** (streaming, tool execution, persistence, degradation, rate-limit) except where a phase names it.
- Live-data tools for reviews/reports, route-aware suggestions, and 👍/👎 analytics are **optional/deferred** (listed at the end), not core.

---

## 2. Design decisions (locked defaults — tell me at P0 to change any)

- **D-1 · Language = Bangla-always.** The bot replies in simple, friendly **Bangla** regardless of the input language, keeping on-screen UI labels in English exactly as they appear (Settings, Board view, Inbox…). *(Current prompt "mirrors the user's language" — we change it. You said "answer sob banglay dibe.")*
- **D-2 · KB stays in the system prompt** (bundled TS string), just made current + link-rich + sectioned. No RAG.
- **D-3 · Links navigate IN-APP.** The bot writes **relative Markdown links** to real routes (`[Reports](/reports)`); the widget renders same-origin/relative links to use react-router `navigate()` (no page reload, widget stays open); external `http(s)` links → new tab. Task links = `/t/:id`.
- **D-4 · Starter questions = curated + persistent + role-aware.** A broader "most-common" Bangla set, reachable even mid-conversation (not only on empty state), with Department/Reports questions shown only to owner/admin/head.
- **D-5 · Onboarding = passive one-time nudge** (a small dismissible Bangla bubble + gentle FAB pulse, gated by a `hasSeenAssistant` flag). NOT auto-open. *(Flip to auto-open if you prefer.)*
- **D-6 · Error/offline UX** = inline Bangla error bubble + **Retry/Regenerate**, plus a distinct "assistant unavailable" banner for the 503/degraded case.
- **D-7 · Accessibility** = focus-trap + focus-restore to the FAB on close + background inert when open.
- **D-8 · Bangla chrome** = tooltips/aria-labels/hints/error strings localized (product UI labels stay as-is).
- **D-9 · Message helpers** = Copy button per answer. 👍/👎 feedback = optional, client-only.
- **D-10 · New live-data tools (reviews/reports) = DEFERRED** (optional phase). Core plan is how-to help.
- **D-11 · KB-freshness guardrail** = a content-assertion test (`kb-coverage.test.ts`) + a "update the KB when you ship a feature" checklist.

---

## 3. Build rules (apply to every phase)

1. **Don't break the plumbing.** Streaming, tool execution, persistence, 503-degradation, and the 20/min rate-limit stay intact unless a phase explicitly changes them.
2. **KB/prompt string safety:** the KB and prompt are plain-markdown TS template strings — **NEVER put a backtick or a `${` sequence inside them** (it terminates the literal — same failure class as the `*/`-in-comment bug). Markdown links `[label](/path)` are safe.
3. **URLs must match `router.tsx` EXACTLY** (use the map in `AI_ASSISTANT_GAP_ANALYSIS.md` Appendix A). Tasks → `/t/:id`. Flag role-gated routes (`/dept`, `/reports` = owner/admin/head).
4. **Bangla answers, English UI labels inline** (D-1). Never promise things that don't exist — **no `⌘K`/Ctrl+K palette, no notification-preferences page** (both confirmed absent).
5. **Client gate per phase:** `npx tsc -b` clean · `eslint` zero-NEW on touched files · `vitest run` green · the assistant e2e still passes.
6. **Server gate per phase:** `tsc --noEmit` clean · `jest.assistant` module green. Any KB/prompt content change **extends `kb-coverage.test.ts`**.
7. **Real-key verification** at content-phase boundaries + the final gate: run the actual `gpt-4o-mini` on the QA stack and confirm answers are Bangla + have working links + respect roles. Non-deterministic → manual/browser proof (documented like the Dept-Review passes), NOT a CI assertion.
8. **Security:** link renderer navigates ONLY same-origin relative paths (never `javascript:`/unknown schemes); external → `rel="noreferrer"` new tab. Tools stay read-only + JWT-scoped. Prompt keeps the anti-injection + honesty rules.
9. **Log** each phase to `AI_ASSISTANT_BUILD_LOG.md`; keep `AI_ASSISTANT_GAP_ANALYSIS.md` as the reference.

---

## 4. Testing strategy (how each kind of change is proven)

- **KB/prompt content → deterministic assertion tests.** Import `KNOWLEDGE_BASE` / `SYSTEM_PROMPT` / `buildMessages` and assert they contain the required feature keywords + canonical URL patterns + the Bangla/links/role instructions. (This doubles as the freshness guardrail, F8.)
- **Server behavior → mocked-OpenAI tests.** `jest.assistant` already mocks `services/openaiClient` (`jest.mock(... mockCreate.mockImplementation ...)`). We assert the **assembled system message** sent to OpenAI carries the new KB/URLs, and that tools still execute — without depending on model output.
- **Client logic → vitest.** The link renderer (relative→navigate, external→new-tab, bad-scheme→ignored), starter-question role-gating, error-state rendering — unit-tested with a mocked router/store.
- **Widget behavior → `client/e2e/assistant.pw.ts`** (real backend). Extend for: link-click navigates without reload, onboarding nudge shows once, suggestions reachable mid-chat. Keep deterministic (test widget behavior, not model wording).
- **Answer quality → real-key manual/browser pass** at phase boundaries (Bangla, links, roles, error recovery).

---

## 5. Phases

### STAGE 0 — Setup
- **P0 · Foundation & decisions.** Confirm green baseline: run `jest.assistant`, client `vitest`, and `e2e/assistant.pw.ts` (needs `OPENAI_API_KEY` on the QA stack — verify present). Lock D-1…D-11 (record chosen values; you may override here). Create `AI_ASSISTANT_BUILD_LOG.md`. Decide the KB's new section order. **No product changes.**
  *Files:* new `AI_ASSISTANT_BUILD_LOG.md`. *Done when:* baseline green + decisions recorded.

### STAGE A — Knowledge base & prompt (server content = the correctness core)
- **P1 · KB de-stale / core refresh.** In `knowledgeBase.ts`: remove the **Ctrl+K command-palette** claim (Search just routes to `/search`); add **Department** + **Reports** to the Sidebar list; refresh the **notifications** list (add review/report events); fix the **invite** "not finished" limitation (accept flow works); add a short **Home / KPI / agenda** description; add a one-line **Head** role pointer. Create `kb-coverage.test.ts` (skeleton) asserting the corrected facts.
  *Files:* `server/src/assistant/knowledgeBase.ts`, new `server/tests/assistant/kb-coverage.test.ts`. *Test:* content assertions + `jest.assistant` green.
- **P2 · KB: Department Review + Reports section.** Add a full section: Spaces-as-departments + **Head** (`head_user_id`; owner/admin assigns it on the space page); the **`/dept`** dashboard (review queue buckets, **Approve**, **Flag** + note, in-task "Department review" section, only once a task is Done/Closed); the HR **`/reports`** inbox + **`/reports/:id`** detail (**Mark seen** = owner/admin, **Regenerate** = admin/head, **head-note** = the report's head); the `task_reviewed` / `report_ready` notifications; the automatic weekly report (Monday). Role notes throughout. Extend `kb-coverage.test.ts`.
  *Files:* `knowledgeBase.ts`, `kb-coverage.test.ts`. *Test:* assertions incl. `/dept`, `/reports`, "Head", "task_reviewed".
- **P3 · KB: URL layer + "link → do this here" rewrite.** Add a **URL reference block** (Appendix A of the gap doc) and rewrite the "Quick answers"/how-to items into the **relative-link + on-page steps** format (Appendix B): every common task answer points to a real route as a Markdown link and lists the 1-2-3 to do there, with role caveats. Extend `kb-coverage.test.ts` to assert the canonical URL patterns are present.
  *Files:* `knowledgeBase.ts`, `kb-coverage.test.ts`. *Test:* URL-pattern assertions.
- **P4 · System prompt upgrade (links + Bangla + roles).** In `systemPrompt.ts`: switch to **Bangla-always** (D-1); instruct the model to **emit Markdown links to the app's URLs** when guiding navigation (only real routes from the KB); add **role-conditioning** ("if the user isn't owner/admin/head, note that Department/Reports are admin/head-only"); drop the Ctrl+K example; keep the numbered-steps, honesty, anti-injection, and scope rules; update EXAMPLES to show a **linked Bangla answer**.
  *Files:* `server/src/assistant/systemPrompt.ts`; a mocked-OpenAI test in `chat.test.ts` (or `kb-coverage.test.ts`) asserting the assembled `system` message includes the KB + URL block. *Test:* `jest.assistant` green.
- **P5 · Server content real-key pass.** On the QA stack with the real `gpt-4o-mini`: ask the canonical questions (create task, assign, Board view, Department review, where are Reports, change password, invite, "what's due today") and verify each answer is **Bangla + has a working relative link + respects the asker's role + promises nothing fake**. Fix any KB/prompt wording nits. Document the pass.
  *Files:* wording-only edits if needed. *Test:* documented manual proof.

### STAGE B — Client: in-app navigation
- **P6 · In-app link navigation.** Replace the `a` renderer in `AssistantWidget.tsx`: same-origin/relative href → `react-router navigate()` (no reload; widget stays open, auto-closes on mobile full-screen); external → new tab `rel="noreferrer"`; ignore non-path/unknown schemes. Unit-test the renderer (vitest). Extend the e2e: a link in an answer navigates without a full reload.
  *Files:* `client/src/components/assistant/AssistantWidget.tsx`, new `AssistantWidget.linkrender.test.tsx` (vitest), `client/e2e/assistant.pw.ts`. *Test:* vitest + e2e.

### STAGE C — Client: starter questions v2
- **P7 · Persistent, curated, role-aware starter questions.** Extract suggestions to a small config (Appendix C set); **role-gate** Department/Reports questions via the auth store; make them **reachable mid-conversation** (a "সাধারণ প্রশ্ন" button in the header or above the input), not only at `messages.length === 0`. *(Optional sub-step: vary the default set by current route.)* Clicking still sends the question (→ linked answer from the upgraded KB).
  *Files:* `AssistantWidget.tsx` + new `assistant/suggestions.ts`. *Test:* vitest (role-gating) + e2e (suggestions visible mid-chat).

### STAGE D — Client: onboarding & discoverability
- **P8 · First-time onboarding nudge.** A one-time, dismissible Bangla bubble near the FAB ("নতুন? 👋 এখানে যেকোনো প্রশ্ন করুন") + a gentle FAB pulse, gated by a `hasSeenAssistant` flag (ui-store or localStorage); make the FAB read clearly as "সহায়ক / Help". No auto-open (D-5).
  *Files:* `AssistantWidget.tsx`, `AssistantWidget.css`, `stores/ui.ts` (flag). *Test:* e2e (nudge shows first visit, stays dismissed after).

### STAGE E — Client: robustness, Bangla chrome, a11y, helpers
- **P9 · Error & degraded UX.** Subscribe to `store.error`; show an inline **Bangla** error + **Retry/Regenerate** (re-send the last user turn); a distinct "সহায়ক এখন unavailable" banner for the 503/degraded case; Bangla-ize the error strings in `http/assistant.ts`.
  *Files:* `AssistantWidget.tsx`, `stores/chat.ts`, `http/assistant.ts`. *Test:* vitest + e2e (simulate a failed request).
- **P10 · Bangla chrome + accessibility.** Localize tooltips/aria-labels/hints/error strings (Bangla or Bangla+English); add a **focus-trap** in the panel, **focus-restore** to the FAB on close, and mark the background `inert`/`aria-hidden` while open.
  *Files:* `AssistantWidget.tsx`, `AssistantWidget.css`. *Test:* e2e a11y checks where feasible.
- **P11 · Message helpers.** A **Copy** button per assistant message (Bangla tooltip). *(Optional: client-only 👍/👎.)*
  *Files:* `AssistantWidget.tsx`, `AssistantWidget.css`. *Test:* vitest/e2e.

### STAGE F — Guardrail & ship gate
- **P12 · KB-freshness guardrail + docs.** Finalize `kb-coverage.test.ts` (asserts every major feature keyword + canonical URL is present, so a future feature ship must update the KB or CI fails); add a short "**when you ship a feature, update `knowledgeBase.ts`**" checklist to `AI_ASSISTANT_PLAN.md` + the build log.
  *Files:* `kb-coverage.test.ts`, `AI_ASSISTANT_PLAN.md`. *Test:* the guardrail itself.
- **P13 · Final gate.** Full regression (`jest.assistant` + client `vitest` + `eslint` zero-new + `tsc` ×2); extend + commit `e2e/assistant.pw.ts` (onboarding + link-nav + suggestions); a **real-key browser pass** of the whole flow (Bangla + working links + role-gating + error recovery + onboarding); UX polish; docs (update `AI_ASSISTANT_PLAN.md`, add a gate-report entry, annotate `AI_ASSISTANT_GAP_ANALYSIS.md` gaps as CLOSED); demo checklist; memory update; sign-off.

---

## 6. Phase → gap/feature traceability

| Phase | Closes (gap-analysis) |
|---|---|
| P1 | A3, A4 (stale Sidebar/notifications/invite, Ctrl+K, Home) |
| P2 | A1 (Department Review + Reports entirely missing) · D-facts |
| P3 | A2, C1 (no URLs; link + on-page steps) — F1 |
| P4 | A2, C1, C3 (prompt: links + Bangla + roles) — F1/F5 |
| P5 | verification of F1/F5 |
| P6 | B1, C1 (links open new-tab/reload → in-app nav) — F2 |
| P7 | B3, C2 (starter Qs vanish/static → persistent/curated/role-aware) — F3 |
| P8 | B2, C4 (no onboarding/discoverability) — F4 |
| P9 | B4 (silent errors) — F6 |
| P10 | B5, B6 (a11y, half-English chrome) — F5/F7 |
| P11 | B7 (no copy/feedback) — F7 |
| P12 | A5 (KB drift guardrail) — F8 |
| P13 | full verification + docs |

---

## 7. File map (what each phase touches)

**Server:** `assistant/knowledgeBase.ts` (P1–P3), `assistant/systemPrompt.ts` (P4), `tests/assistant/kb-coverage.test.ts` (new; P1, grown P2–P4, P12), `tests/assistant/chat.test.ts` (P4 assertion).
**Client:** `components/assistant/AssistantWidget.tsx` (P6–P11), `components/assistant/AssistantWidget.css` (P8/P10/P11), new `components/assistant/suggestions.ts` (P7), `stores/chat.ts` (P9), `stores/ui.ts` (P8 flag), `http/assistant.ts` (P9), new vitest specs (P6/P7), `e2e/assistant.pw.ts` (P6/P7/P8/P13).
**Docs:** `AI_ASSISTANT_BUILD_LOG.md` (new, P0+), `AI_ASSISTANT_PLAN.md` (P12/P13), `GO_LIVE_GATE_REPORT.md` (P13), `AI_ASSISTANT_GAP_ANALYSIS.md` (P13 close-out).

---

## 8. Deferred / optional (not scheduled — ask if you want them)

- **Live review/report tools** — read-only JWT-scoped `get_flagged_tasks`, `get_reports_awaiting_ack` so the bot can answer live-data questions about the new feature (e.g. "amar kono task flag hoyeche?"). Extends `tools.ts`. Nice-to-have, not needed for how-to help.
- **Route-aware suggestions** (if not folded into P7): starter questions that change based on the page the user is on.
- **Feedback analytics** — persist 👍/👎 + asked-questions to learn which answers work and where the KB is weak.
- **Voice / larger model** — out of scope.

---

*Plan compiled 2026-07-23, grounded in a full read of the assistant code + a 3-agent scan
(`AI_ASSISTANT_GAP_ANALYSIS.md`). 14 core phases (P0–P13), each small and independently
testable. Nothing built yet — say "AI phase 0 koren" (or any phase) to start, one at a time.*
