# 🤖 AI Help Assistant — Upgrade Build Log

Per-phase execution log for `AI_ASSISTANT_UPGRADE_PLAN.md`. Reference (gaps):
`AI_ASSISTANT_GAP_ANALYSIS.md`. Protocol: user says **"AI phase N koren"** → only that
phase → build → test → verify → log here. One phase at a time.

---

## Phase 0 — Foundation & decisions — ✅ COMPLETE (2026-07-23)

**No product changes** — this phase only confirms the starting baseline, locks the design
decisions, and sets the target KB structure.

### Baseline (all green — known-good starting point before any edit)
| Check | Result |
|---|---|
| `OPENAI_API_KEY` in `server/.env` | present · `sk-…` · model `gpt-4o-mini` ✅ |
| Server `jest.assistant` (mocked OpenAI) | **3 suites / 17 tests** ✅ |
| Client `vitest` | **10/10** ✅ (incl. `http/assistant.test.ts`) |
| Real-key E2E `e2e/assistant.pw.ts` (QA stack, live gpt-4o-mini) | **1/1, 8.2s** — widget → :5501 → OpenAI → streamed reply → localStorage persist across reload ✅ |

The end-to-end path (widget → SSE stream → OpenAI → persistence → degradation) is confirmed
working, so any regression during the upgrade is attributable to our changes.

### Locked decisions (defaults accepted — user invoked P0 without override)
- **D-1 Language = Bangla-ALWAYS** (change `systemPrompt.ts` from "mirror the user's language"; keep English UI labels inline).
- **D-2 KB stays in the system prompt** (bundled TS string; no RAG).
- **D-3 Links navigate IN-APP** — bot emits relative Markdown links to real routes; widget renders same-origin/relative → react-router `navigate()` (no reload, widget stays open); external → new tab. Tasks → `/t/:id`.
- **D-4 Starter questions** = curated + persistent (reachable mid-chat) + role-aware (Dept/Reports Qs only for owner/admin/head).
- **D-5 Onboarding = passive one-time nudge** (dismissible Bangla bubble + gentle FAB pulse, `hasSeenAssistant` flag); NOT auto-open.
- **D-6 Error/offline UX** = inline Bangla error + Retry/Regenerate + a distinct "unavailable" banner for 503/degraded.
- **D-7 A11y** = focus-trap + focus-restore-to-FAB + background inert when open.
- **D-8 Bangla chrome** = localize tooltips/aria-labels/hints/error strings (UI labels stay as-is).
- **D-9 Message helpers** = Copy per answer; 👍/👎 optional client-only.
- **D-10 Live review/report tools = DEFERRED** (optional).
- **D-11 KB-freshness guardrail** = `kb-coverage.test.ts` + a "update the KB on feature ship" checklist.

### Target KB section order (for P1–P3 — the rewrite target)
1. About this system
2. Core structure (Workspace → Space → List → Task) — **note: a Space can double as a department**
3. **URL / navigation reference (NEW)** — the real route map so the bot can hand out clickable links
4. Navigation — Sidebar (**+Department, +Reports; REMOVE the Ctrl+K palette claim**) + Topbar (**remove Ctrl+K command palette**)
5. Getting started
6. Working with tasks — the 4 views
7. Task details
8. Assigning & following work
9. Inbox & notifications (**+ `task_reviewed` / `report_ready`**)
10. Search (**no Ctrl+K — it routes to `/search`**)
11. Forms
12. Engineering area
13. **Department review & weekly HR reports (NEW SECTION)** — Head (`head_user_id`), `/dept` approve/flag, `/reports` + `/reports/:id` (mark seen / regenerate / note), the 2 notifications, the weekly job
14. Settings & administration
15. Roles & permissions (**+ Head**)
16. Account & sign-in (**invite accept flow works now — fix the stale limitation**)
17. Quick answers — rewritten as **link + on-page steps**
18. Good to know (limitations — refreshed)

### Known-stale KB facts to fix (found in P0 read; addressed P1–P3)
- **Ctrl+K command palette** claimed in 3 places (KB lines 46, 95, 148) — **does not exist** (Search just routes to `/search`). Must remove.
- Sidebar list (KB line 38) omits **Department** + **Reports**.
- Notifications list (KB line 92) predates `task_reviewed` / `report_ready`.
- Invite "not finished yet" (KB line 155) — **outdated**, the `/invitation/:token` accept flow works.
- No URLs anywhere in the KB; no Department-Review/Head content anywhere.

**Verdict: Phase 0 COMPLETE — baseline green, decisions locked, KB target set. Ready for "AI phase 1 koren" (KB de-stale / core refresh).**

---

## Phase 1 — KB de-stale / core refresh — ✅ COMPLETE (2026-07-23)

Server-content only (no client changes). 7 targeted edits to `knowledgeBase.ts`:

1. **Ctrl+K / Command Palette claim REMOVED (×3)** — Topbar bullet, Search section, and the Quick-answers "how do I search" line. It never existed; the Topbar Search box and Sidebar Search both just open `/search`. Replaced with accurate "Search box in the Topbar" wording.
2. **Sidebar list += Department + Reports** — one-line, role-scoped ("shown only to Owners, Admins, or a Space's Head"). Full how-to is P2.
3. **Home bullet expanded** — now describes the KPI cards (assigned to you / due today / overdue / awaiting your review) + today's agenda. (Closes the "Home not described" gap.)
4. **Notifications list refreshed** — added "your Head reviews one of your tasks (approves/flags)" and "a weekly department report is ready" to the notification triggers.
5. **Roles section += Department Head** — clarified it is not a separate account role: any Member/Admin set as a Space's Head reviews the team's completed tasks and gets a weekly report.
6. **Invite limitation FIXED** — replaced the stale "completing sign-up through the invite link is not finished yet" with the real flow (email → open `/invitation/:token` → set password → auto sign-in).

**New freshness guardrail:** `server/tests/assistant/kb-coverage.test.ts` (D-11) — pure deterministic content assertions (no OpenAI/DB): no Ctrl+K/palette, no "not finished yet", Department/Reports/Head present, review+weekly-report notifications present, Home KPIs present, and **string-safety** (no backtick / `${` inside the KB literal). Grows in P2/P3/P4.

### Verified
- KB grep: zero stale terms (Ctrl+K / Cmd+K / command palette / "not finished yet") · string-safe (no backtick/dollar-brace in content).
- Server `tsc --noEmit` clean · **`jest.assistant` 4 suites / 24 tests** (was 3/17 — new kb-coverage suite green).

**Verdict: Phase 1 COMPLETE. Ready for "AI phase 2 koren" (add the full Department Review + weekly Reports KB section: Head assign, /dept approve/flag, /reports mark-seen/regenerate/note, the 2 notifications, the weekly job).**

---

## Phase 2 — KB: Department Review + weekly Reports section — ✅ COMPLETE (2026-07-23)

Server-content only. The feature that was **entirely absent** from the KB (gap A1) is now fully described.

### Added to `knowledgeBase.ts`
- **Core-structure Space bullet** += a one-line Head pointer ("Each Space can have a **Head** who reviews the team's work — see below").
- **New section "Department review and weekly reports"** (inserted between Engineering and Settings), covering:
  - **The Head** — a Member/Admin chosen to lead a Space; set by an Owner/Admin via the **Department head** card on the Space page; team membership auto-derived from task assignees.
  - **Reviewing — [Department](/dept)** — owner/admin/head only; queue tabs (Needs review / Flagged / Overdue / Due today); **Approve** or **Flag** (≤500-char note); in-task **Department review** section (only once Done/Closed); assignee notified.
  - **Weekly reports — [Reports](/reports)** — auto every Monday for the previous week; owner/admin/head only; detail = per-member breakdown + totals-with-delta + flagged tasks + Head's note; actions **Mark seen** (owner/admin, first-wins), **Regenerate** (admin/current-head, keeps note+seen, no re-notify), **Head's note** (report's Head only); on-demand past-week generate.
  - **Notifications** — task reviewed (flag note included) + weekly report ready (links to the report).
- Role gating stated on both pages ("Members and Guests do not see this page").
- Written with **markdown links** (`[Department](/dept)`, `[Reports](/reports)`) — string-safe (no backtick/`${`).

### Guardrail extended
`kb-coverage.test.ts` += a "P2 Department Review + Reports" block (4 tests): `/dept` + `/reports` paths present; Department-head + Approve/Flag/Needs-review present; weekly-report + Mark-seen + Regenerate + Head's-note present; role-gating present.

### Verified
- KB string-safe · server `tsc` clean · **`jest.assistant` 4 suites / 28 tests** (was 24 — +4 P2 assertions green).

**Verdict: Phase 2 COMPLETE. Ready for "AI phase 3 koren" (URL reference block + rewrite the older Quick-answers/how-to items into the "link → do this here" format; extend the guardrail with the canonical URL patterns).**

---

## Phase 3 — KB URL layer + "link → do this here" rewrite — ✅ COMPLETE (2026-07-23)

Server-content only. The KB had **zero URLs** (gap A2/C1) — now the bot knows the app's real addresses and its answers hand out clickable links.

### Added to `knowledgeBase.ts`
- **New "Where things live (page addresses)" section** (after Navigation) — a reference list of the STATIC routes the bot can safely link to: `/`, `/inbox`, `/search`, `/dept`, `/reports`, `/forms`, `/eng` + `/eng/sprint` + `/eng/on-call`, and every `/settings/*` page. Explicitly states **Spaces/Lists/tasks have NO fixed address — open them from the Sidebar; never guess one** (anti-fabrication).
- **Rewrote "Quick answers" → "Quick answers (with the page to go to)"** — every answer now points to its destination as an **in-app markdown link** where a static page exists (`[Inbox](/inbox)`, `[Settings → Profile](/settings/profile)`, `[On-call rotation](/eng/on-call)`, `[Search](/search)`, `[Department](/dept)`, `[Reports](/reports)`) + the on-page steps; dynamic ones (create task, assign, attach) stay as clear navigate-from-Sidebar steps. Added 3 new Q&As (who reviews my tasks, where are the reports, how to report a bug).

This is the few-shot that teaches the model the **"link + steps"** answer shape (the prompt instruction to actually emit links lands in P4).

### Guardrail extended
`kb-coverage.test.ts` += "P3 URL / link layer" block (3 tests): 11 canonical static routes present; quick-answers contain real markdown links (`[…](/inbox)`, `/settings/profile`, `/search`, `/dept`); and a **fabrication guard** — the KB contains **no `/s/` or `/t/` dynamic paths** (those must be opened by navigation, not a guessed URL).

### Verified
- KB string-safe (no backtick/`${`) · no `/s/` or `/t/` in content · server `tsc` clean · **`jest.assistant` 4 suites / 31 tests** (was 28 — +3 P3 assertions green).

**Verdict: Phase 3 COMPLETE — STAGE A content (KB) done. Ready for "AI phase 4 koren" (system prompt: Bangla-always + instruct the model to EMIT the app links + role-conditioning + drop Ctrl+K example; add a mocked-OpenAI assertion that the assembled system message carries the KB + URLs).**

---

## Phase 4 — System prompt upgrade (Bangla-always + emit links + roles) — ✅ COMPLETE (2026-07-23)

Server-content only. Rewrote `systemPrompt.ts`:

1. **LANGUAGE → Bangla-ALWAYS** (D-1) — replaced "reply in the SAME language the user writes in" with "ALWAYS reply in simple, friendly Bangla, even if the user writes in English"; app UI labels stay English.
2. **STYLE → emit in-app links** — new rules: when a page has an address, give it as a clickable **Markdown link** (`[Settings → Profile](/settings/profile)`); use ONLY addresses from the KB's "Where things live"; **never invent an address**; Spaces/Lists/tasks have no fixed address → open from the Sidebar; after a link, still give the on-page steps.
3. **NEW "ROLES" block** — Department/Reports = Owners/Admins/Heads only; most admin actions = Owner/Admin; tell the user briefly when a step is admin/head-only (in Bangla) so a member isn't confused.
4. **Dropped the Ctrl+K example** from STYLE (it doesn't exist).
5. **EXAMPLES rewritten** — now show Bangla answers WITH links: change-password → `[Settings → Profile](/settings/profile)`, and a new "where are the weekly reports" → `[Reports](/reports)` + the role caveat. Kept the honesty, tools, scope, and anti-injection rules intact.

### Guardrail extended
`kb-coverage.test.ts` += "System prompt — P4" block (6 tests): Bangla-always present + no "same language"; emit-Markdown-link + never-invent-address present; no Ctrl+K/palette; role limits stated; **buildMessages assembles a system message that carries the prompt + the KB URL block** (`/dept`, `/settings/profile`, "KNOWLEDGE BASE", Bangla instruction) — proving the real request path sends the upgraded content; prompt string-safe.

### Verified
- Server `tsc` clean · **`jest.assistant` 4 suites / 37 tests** (was 31 — +6 P4). Existing mocked-OpenAI `chat.test.ts` (503/401 + chat) still green — no regression from the prompt change.

**Verdict: Phase 4 COMPLETE — STAGE A (KB + prompt content) fully done. Ready for "AI phase 5 koren" (real-key verification pass on the QA stack: ask the canonical questions with live gpt-4o-mini, confirm Bangla + working links + role caveats + no fake promises; fix any wording nits).**

---

## Phase 5 — Real-key verification pass (live gpt-4o-mini) — ✅ COMPLETE (2026-07-23)

Ran 9 canonical questions against the **real gpt-4o-mini** on the QA stack (API-direct, `DISABLE_RATE_LIMIT=1`). Questions asked in English/Banglish on purpose — to prove **Bangla-always** (English in → Bangla out). Verdicts computed programmatically as **ASCII-only** (Bangla presence via the Bengali Unicode block, markdown-link extraction, Ctrl+K scan, fabricated-path scan, role-word scan) — the raw Bangla replies were never dumped to the terminal.

### Result: 9 / 9 PASS
| Question | Bangla | Link emitted | Role caveat | Ctrl+K | Fabricated |
|---|---|---|---|---|---|
| create a task | Y | — (dynamic, correct) | — | no | none |
| assign a task | Y | — (dynamic) | — | no | none |
| what is Board view | Y | — (explanation) | — | no | none |
| who reviews my tasks | Y | **/dept** | yes | no | none |
| where are weekly reports | Y | **/reports** | yes | no | none |
| change password | Y | **/settings/profile** | — | no | none |
| invite a teammate | Y | **/settings/members** | yes | no | none |
| what's due today (tool) | Y | /inbox | — | no | none |
| what's the weather (out-of-scope) | Y | — (declined) | — | no | none |

Every reply was **Bangla**, every navigational answer emitted a **real in-app link** to the exact expected route, the role-gated features (**Department / Reports / invite**) carried the **Owner/Admin/Head** caveat, and there was **zero Ctrl+K and zero fabricated `/s/` or `/t/` link** anywhere. Dynamic actions (create/assign) correctly gave Sidebar steps without inventing a link.

### Nits found / fixed
**None** — no KB or prompt wording changes needed. The P1–P4 content produces correct, Bangla, linked, role-aware answers live.

### Verified
- 9/9 objective checks pass with live gpt-4o-mini · server torn down after · verification script kept in the session scratchpad.

**Verdict: Phase 5 COMPLETE — STAGE A fully verified end-to-end with the real model. The bot's KNOWLEDGE and BEHAVIOUR are now correct + link-rich + Bangla. Ready for "AI phase 6 koren" (client: make those in-app links actually navigate via react-router instead of opening a new tab + full reload).**

---

## Phase 6 — Client: in-app link navigation — ✅ COMPLETE (2026-07-23)

Client-only. The biggest client blocker (gap B1/C1/F2): the bot now emits real links, but every link opened a **new tab + full SPA reload**. Fixed.

### Changes
- **New `components/assistant/mdLink.tsx`** — `classifyLink(href)` (in-app relative `/x` / external `http(s)` / unsafe) + `makeAssistantMarkdownComponents(navigate, onInAppNavigate)`: in-app links `preventDefault` + **react-router `navigate()`** (no reload); external → new tab `rel=noreferrer`; **unsafe hrefs (`javascript:`, `data:`, protocol-relative `//host`, empty) render as plain text** — never a live link (XSS-safe).
- **`AssistantWidget.tsx`** — removed the old module-level `target="_blank"` renderer; wired `useNavigate()` + a `useMemo` renderer that closes the widget after an in-app hop **only on the mobile full-screen sheet** (`matchMedia("(max-width: 520px)")`), so the destination is visible; on desktop the panel doesn't cover the page, so it stays open.

### Tests
- **`mdLink.test.tsx`** (vitest, happy-dom, real render+click): `classifyLink` matrix (10 cases incl. `//evil.com`, `javascript:`, `mailto:` → unsafe); in-app link **click → `navigate("/dept")` + onInAppNavigate fired**; external link has `target=_blank`/`rel=noreferrer` and does NOT call navigate; unsafe href renders no anchor and never navigates.
- **`e2e/assistant.pw.ts`** += a committed test: ask "change password" → wait for an in-app link in the reply → click → URL becomes the link path, the **widget stays open** (isOpen isn't persisted, so a full reload would have closed it), and no `load` event fired. Runs at the P13 browser gate.

### Verified
- Client `tsc -b` clean · eslint 0 errors on touched files · **vitest 3 files / 23 tests** (was 2/10 — +13 mdLink tests green).

**Verdict: Phase 6 COMPLETE — in-app links now navigate smoothly (no reload), external stay new-tab, unsafe are inert. Ready for "AI phase 7 koren" (starter questions v2: curated + persistent (reachable mid-chat) + role-aware Bangla set).**

---

## Phase 7 — Client: starter questions v2 (curated + persistent + role-aware) — ✅ COMPLETE (2026-07-23)

Client-only (gap B3/C2/F3). The old 4 static chips only showed on the empty state and vanished forever after the first message. Fixed.

### Changes
- **New `components/assistant/suggestions.ts`** — the curated "most-common" set (8 questions: create/assign task, Board+Calendar view, comment+checklist, today's agenda, search, password, and a `deptOnly` "Department review + weekly report" question) + a pure `pickSuggestions(canSeeDept)` that filters the dept question. Extracted from the component so it's unit-testable and reusable.
- **`AssistantWidget.tsx`**:
  - Role-aware: computes `canSeeDept = isAdmin || headsAny` (from `useSpaces`, mirroring the Sidebar's gate) so the Department/Reports starter question shows only to Owners/Admins/Heads.
  - **Persistent access mid-conversation** — a new **Lightbulb toggle** in the header (appears once there are messages) opens an **`.asst-suggestbar`** above the input with the same chips; clicking a chip sends it and closes the bar. The empty-state welcome chips now also use the curated, role-filtered set.
- **CSS** — `.asst-suggestbar` (scrollable chip column above the input) + `.asst-iconbtn--active`.

### Tests
- **`suggestions.test.ts`** (vitest, pure): base questions always present; the dept question is HIDDEN when `!canSeeDept` and SHOWN when `canSeeDept`; curated set ≥ 7.
- **`e2e/assistant.pw.ts`** += a committed test: send a message → the **Suggested questions** toggle appears → click → the `.asst-suggestbar` chips are visible **mid-conversation** → clicking a chip sends it (2nd user bubble) and closes the bar. Runs at the P13 gate.

### Verified
- Client `tsc -b` clean · eslint 0 errors · **vitest 4 files / 27 tests** (was 3/23 — +4 suggestions tests green).

**Verdict: Phase 7 COMPLETE — starter questions are now curated, persistent, and role-aware. Ready for "AI phase 8 koren" (first-time onboarding nudge + more discoverable FAB, gated by a hasSeenAssistant flag).**

---

## Phase 8 — Client: first-time onboarding nudge + discoverable FAB — ✅ COMPLETE (2026-07-23)

Client-only (gap B2/C4/F4). A brand-new Bangla non-tech user had no reason to notice or trust the bare Bot FAB. Fixed — with a passive, dismissible nudge (D-5: NOT auto-open).

### Changes
- **`stores/ui.ts`** — added `assistantNudgeSeen` + `dismissAssistantNudge()`, persisted in `th-ui`. Intentionally **excluded from `reset()`** (it's a per-browser discoverability hint, not per-user data — a real new user on a shared machine still benefits from the more-discoverable FAB, but we don't re-nag the same browser).
- **`AssistantWidget.tsx`** (FAB branch) — when `!assistantNudgeSeen` and the widget is closed: a one-time **Bangla nudge bubble** ("👋 নতুন? এখানে যেকোনো প্রশ্ন করুন…") above the FAB with a **body (opens the assistant)** and an **× (dismiss)**, plus a gentle **FAB pulse ring**. Opening the assistant OR dismissing the bubble sets the flag so it never nags again. FAB `title` is now Bangla ("সহায়ক · Help"); `aria-label` kept as "Open help assistant" (stable e2e selector).
- **CSS** — `.asst-nudge` bubble (fixed above the FAB, slide-in) + `.asst-fab--pulse` ring, both **disabled under `prefers-reduced-motion`**.

### Tests
- **`stores/ui.test.ts`** (vitest): un-seen → `dismissAssistantNudge` sets it; **`reset()` keeps the nudge flag but purges `favoriteIds`** (the per-browser-vs-per-user invariant).
- **`e2e/assistant.pw.ts`** += a committed test: first login shows the nudge → click **Dismiss** → gone → **reload → nudge does not return** (flag persisted) → FAB still present. Runs at the P13 gate.

### Verified
- Client `tsc -b` clean · eslint 0 errors · **vitest 5 files / 29 tests** (was 4/27 — +2 ui-store tests green).

**Verdict: Phase 8 COMPLETE — the assistant now onboards first-timers without nagging. Ready for "AI phase 9 koren" (error & degraded UX: inline Bangla error + Retry/Regenerate + a "assistant unavailable" banner; Bangla error strings).**

---

## Phase 9 — Client: error & degraded UX — ✅ COMPLETE (2026-07-23)

Client-only (gap B4/C4/F6). Mid-stream failures were **silent** (the widget never read `store.error`), error copy was English, and there was no way to recover.

### Changes
- **`http/assistant.ts`** — Bangla-ized all 3 error strings; the non-ok handler now maps by STATUS (503 → "সহায়ক এখন ব্যস্ত বা বন্ধ আছে…", 504 → timeout, else generic) and **never surfaces the server's raw English message**; the mid-stream SSE error event also throws a friendly Bangla line.
- **`stores/chat.ts`** — the catch block no longer injects a "⚠️" dead bubble; it **drops the empty assistant placeholder** (a partially-streamed bubble is kept so the user sees what arrived) and sets `error` (Bangla default). New **`retryLast()`** action: finds the last user turn, drops the failed turn, and re-sends it fresh (no duplication); no-op while streaming.
- **`AssistantWidget.tsx`** — now subscribes to `error` and renders a Bangla **error banner + "আবার চেষ্টা" (Retry)** above the input when `error && !isStreaming`. Sending a new message also clears the error.
- **CSS** — `.asst-error` banner (danger-tinted) + retry button.

### Tests
- **`stores/chat.test.ts`** (vitest, `streamChat` mocked): on failure → `error` set + empty placeholder dropped; **`retryLast` re-runs the last turn without duplicating the user message** and clears the error; retryLast is a no-op mid-stream.
- **`http/assistant.test.ts`** — updated the mid-stream-error test to assert a **Bangla** rejection (Bengali Unicode block) that does NOT contain the server's raw "boom" (Bangla-always behaviour).
- **`e2e/assistant.pw.ts`** += a committed test: Playwright **route-intercepts** `/assistant/chat` with a 503 → the error banner + Retry appear → unroute + click Retry → banner clears and a real assistant reply arrives. Runs at the P13 gate.

### Verified
- Client `tsc -b` clean · eslint 0 errors · **vitest 6 files / 32 tests** (was 5/29 — +3 chat-store tests; fixed 1 SSE test to the Bangla behaviour).

**Verdict: Phase 9 COMPLETE — failures are now visible, Bangla, and recoverable. Ready for "AI phase 10 koren" (Bangla chrome + accessibility: Bangla tooltips/aria, focus-trap, focus-restore to the FAB, background inert when open).**

---

## Phase 10 — Client: Bangla chrome + accessibility — ✅ COMPLETE (2026-07-23)

Client-only (gap B5/B6/F5/F7).

### Bangla chrome
Every visible hover tooltip is now Bangla: New chat → "নতুন চ্যাট", Close → "বন্ধ করুন", Stop → "থামান", Send → "পাঠান" (FAB "সহায়ক · Help", toggle "সাধারণ প্রশ্ন", nudge-× "বন্ধ করুন" were already Bangla). `aria-label`s stay English by design — they are the stable a11y/e2e names, not visible chrome; all *visible* text (welcome, placeholder, hint, chips, error, nudge, tooltips) is Bangla.

### Accessibility — viewport-correct (careful design decision)
The widget is **non-modal on desktop** (a bottom-right popover) but a **true modal on mobile** (full-screen sheet). Critically, P6 made in-app links navigate while KEEPING the widget open on desktop — so the app behind must stay interactive. Therefore we **must NOT `inert` the background** (it would break desktop link-nav) and must not blanket-trap focus on desktop. Implemented:
- **`isMobile`** reactive (`matchMedia("(max-width:520px)")` + listener).
- **`aria-modal={isMobile}`** — true only on the mobile modal; false on the desktop popover (was incorrectly always-true).
- **Focus trap** (`onKeyDown` on the panel, Tab/Shift+Tab wrap) — active **only when `isMobile`** (correct for a modal; a desktop popover must let Tab reach the app).
- **Focus-restore to the FAB** on close (always) via `fabRef` + an `isOpen`-tracking effect.
- Escape-to-close and focus-input-on-open were already present.
- *Deliberately skipped `inert`* — incompatible with the non-modal desktop + link-navigation design; documented here so it isn't "added back" as a perceived gap.

*Verified:* client `tsc -b` clean · eslint 0 · vitest 32/32 (a11y is behavioural — covered by the committed focus-restore e2e).

## Phase 11 — Client: per-answer Copy button — ✅ COMPLETE (2026-07-23)

Client-only (gap B7/F7). Each assistant answer (once it has content and isn't streaming) shows a subtle **Copy** button next to its timestamp; clicking copies the message and flips to a green **Check** for ~1.5s. Bangla tooltip "কপি করুন". 👍/👎 feedback stays optional/deferred (D-9).
- `AssistantWidget.tsx` — `copiedId` state + `copyMsg` (guards `navigator.clipboard`); a `.asst-msgmeta` row wraps the time + copy button.
- CSS — `.asst-copy` (hover-reveal) + `.asst-copy--done` (green, `data-testid="asst-copy"`).

### e2e added (committed, run at P13)
- **P10** — open → Escape → the FAB is focused (focus-restore).
- **P11** — send a question → the answer's Copy button appears → click → `.asst-copy--done` shows (clipboard permission granted in the test).

*Verified:* client `tsc -b` clean · eslint 0 · **vitest 6 files / 32 tests** green.

---

## Phase 12 — KB-freshness guardrail + maintenance docs — ✅ COMPLETE (2026-07-23)

Closes gap A5 (the KB silently drifts). 
- **`kb-coverage.test.ts`** += a **"feature manifest" net** (15 rows) asserting every shipped user-facing area (spaces/lists/tasks/views/comments/checklists/attachments/forms/search/notifications/engineering/department/reports/settings/roles) has a KB mention — shipping a feature without a KB entry now fails a row. Combined with the P1–P4 blocks (no fake claims, Dept/Reports + URLs present, no fabricated dynamic paths, Bangla+links prompt, string-safety), the KB can't quietly go stale.
- **`AI_ASSISTANT_PLAN.md`** += a "Maintaining the assistant — KB freshness" checklist (update knowledgeBase.ts → add its URL/link → add a manifest row → keep string-safe → Bangla).

*Verified:* **`jest.assistant` 4 suites / 52 tests** (was 37 — +15 manifest rows green).

---

## Phase 13 — Final gate — ✅ COMPLETE (2026-07-23) — 🏁 ASSISTANT UPGRADE SHIPPED

### Full regression (all green)
| Check | Result |
|---|---|
| Server `jest.assistant` (incl. kb-coverage guardrail) | **4 suites / 52 tests** ✅ |
| Server `tsc --noEmit` | clean ✅ |
| Server eslint (assistant src) | 0 errors ✅ |
| Client `tsc -b` | clean ✅ |
| Client `vitest` | **6 files / 32 tests** ✅ |
| Client eslint (all assistant-touched files) | 0 errors ✅ |
| **Committed Playwright e2e** `assistant.pw.ts` (live gpt-4o-mini) | **7/7 PASS, 23.6s** ✅ |
| P5 real-key content pass | 9/9 (Bangla + links + roles) ✅ |

The 7 e2e (real browser + real model): streaming+persist · in-app link nav (no reload) · starter Qs mid-conversation · onboarding nudge (persist-dismissed) · error banner + Retry recovery · focus-restore to FAB · per-answer Copy. One test needed a timing fix (wait for the first stream to finish before clicking a chip — a chip, like the input, is intentionally a no-op while streaming); the feature was correct.

### Docs
- `AI_ASSISTANT_GAP_ANALYSIS.md` — every gap annotated CLOSED (resolution table → phase).
- `AI_ASSISTANT_PLAN.md` — KB-freshness maintenance checklist (P12).
- `GO_LIVE_GATE_REPORT.md` — assistant-upgrade addendum.

### 5-minute demo checklist (Bangla non-tech user)
1. Log in → the **nudge bubble** ("👋 নতুন? …") + pulsing FAB appear once. Click it.
2. Ask **"kivabe notun task banabo?"** → Bangla numbered steps (Sidebar → List → Enter).
3. Ask **"password kivabe change korbo?"** → answer has a **[Settings → Profile] link**; click it → the app **navigates in-place** (widget stays open on desktop), Change password shown.
4. Ask **"HR weekly report kothay?"** → **[Reports] link** + "শুধু Owner/Admin/Head" caveat.
5. Mid-chat, click the **💡 header toggle** → the common-questions bar reappears; pick one.
6. Kill the network / hit an error → red **Bangla error banner + "আবার চেষ্টা"**; click → recovers.
7. Hover an answer → **Copy** button → green tick.
8. Press **Esc** → closes, focus returns to the FAB.

### Sign-off
**AI Help Assistant upgrade = 14/14 phases (P0–P13) COMPLETE.** The bot is now up-to-date
(Dept Review/Reports + all features), **Bangla-always**, hands out **clickable in-app links
with on-page steps**, has **persistent role-aware starter questions**, **first-time
onboarding**, **error recovery**, **a11y**, a **Copy** button, and a **KB-freshness guardrail**
so it won't silently go stale. No known open issues. Deferred/optional (not needed):
live review/report tools, route-aware suggestions, 👍/👎 analytics.
