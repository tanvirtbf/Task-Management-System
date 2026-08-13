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

---
---

# 🎯 SECOND UPGRADE — "make it perfect" (plan: `AI_ASSISTANT_PERFECT_PLAN.md`)

Per-phase log for the 2026-07-28 plan. Reference scan: `AI_ASSISTANT_SCAN_2026-07-28.md`.
Protocol: **"AI phase N koren"** → only that phase → build → test → verify → log here.

---

## Phase 0 — Baseline, decisions, and the measuring stick — ✅ COMPLETE (2026-07-28)

**No product change.** This phase pins the number the later phases have to move, and makes it
reproducible by anyone.

### The known-good line
| Check | Result |
|---|---|
| `jest.assistant` (mocked OpenAI) | **4 suites / 52 tests** ✅ |
| Client `vitest` | **7 files / 40 tests** ✅ |
| Dev stack | API `:5501` 200 · app `:5173` 200 ✅ |
| Live model | `gpt-4o-mini` reachable, every probe answered ✅ |

### Shipped — `server/scripts/assistant-eval.cjs`
The measuring stick, committed so every later phase is graded the same way:

- **A. First-timer** — 15 questions a confused, non-technical person actually asks (Banglish,
  because that is how this team types), graded on **LINK / STEPS / Bangla / length**.
- **B. Live data** — 10 questions only a working tool round-trip can answer.
- Prints **ASCII verdicts only**; the replies are Bangla and this project's terminal cannot render
  Bengali script.
- `--assert` exits non-zero below target, which is what P10 will run.

**One measurement bug found and fixed inside this phase.** The first version scored a data
question as answered if the reply contained *any* digit — but a numbered list ("1. …") satisfies
that, so a completely broken tool round-trip scored **8/10**. The script now pulls ground truth
from `/home/kpis` and requires a **standalone number that matches it**; the same run then scores
**2/10**. A metric that flatters the thing it measures is worse than no metric, so this is recorded
rather than quietly corrected.

### 📌 THE BASELINE — the contract P10 must beat

Measured 2026-07-28 against the live stack (ground truth `my=2 · due=0 · overdue=2 · review=0 ·
team=36 · sla=0`):

| metric | **baseline** | target |
|---|---|---|
| answers with a clickable route | **3 / 15** | ≥ 14 |
| answers with step-by-step | **13 / 15** | ≥ 14 |
| answers in Bangla | **15 / 15** | 15 |
| data questions answered correctly | **2 / 10** | ≥ 9 |
| fabricated routes emitted | **0** | 0 |
| forbidden claims repeated | **0** | 0 |

Read plainly: **the bot explains well and never invents a page — it just never hands you the
link, and its live-data half is broken.** Only 3 of 15 answers carried an address, and only 2 of
10 data questions came back with a true number.

Two observations worth keeping:
- **The link rate is unstable run-to-run (1/15 and 3/15 across two runs).** That is the signature
  of the diagnosed cause — the model can only emit a link when the question happens to hit one of
  the 11 linked KB lines, so which questions get one is luck. After P4 it should be structural,
  not lucky.
- **`forbidden claims` scores 0 even though the KB still contains all five false statements.** The
  model simply did not repeat them in these 15 answers. The claims are still there and are still
  wrong; P2 removes them at source rather than trusting that luck holds.

### Locked decisions (defaults accepted, plus the one the plan deferred to P0)
D-1 KB stays in the system prompt (no RAG) · D-2 every how-to ends with a route + on-page steps,
enforced in the KB **and** the system prompt · D-3 only STATIC routes are ever emitted · D-4 the
freshness guard becomes structural (router→KB parity) · D-5 `assistant.use` gets enforced ·
D-6 the live eval is a manual gate, not CI · D-7 Bangla-always stays · D-8 no new dependencies and
no architecture change.

**D-9 (decided here, deferred by the plan): the JSON chat path gets tools too.** The alternative
was to document that `POST /assistant/chat` is weaker than its SSE twin. A contract that behaves
differently depending on the transport is a latent bug — the next client to use the JSON path
would silently lose every data answer — so both paths will share one tool loop (P9).

### Verified
`jest.assistant` 4/52 ✅ · client vitest 7/40 ✅ · eval script runs clean against the live stack ✅ ·
zero files changed outside `server/scripts/` ✅.

**Verdict: Phase 0 COMPLETE — the baseline is pinned and reproducible. Ready for "AI phase 1
koren" (fix the discarded tool round-trip: 2/10 → ≥9/10).**

---

## Phase 1 — the tool round-trip — ✅ COMPLETE (2026-07-28)

**Target: data questions 2/10 → ≥9/10. Result: 9/10 PASS.**

But the honest story is not the one the plan predicted, so it is written out in full below.

### ⚠️ CORRECTION TO THE P0 BASELINE

**P0 reported "data questions 2/10 — the live-data half is broken". That reading was wrong, and
the fault was in my measuring stick, not in the product.**

The bot answers in Bangla and **writes numbers in Bengali numerals** (২, ৩৬). The eval script
matched ASCII digits only, so a perfectly correct answer scored as a miss. A second flaw compounded
it: three of the six demo KPIs are **zero**, and a correct Bangla answer to "how many overdue?" when
the answer is zero is *"কোনো task নেই"* — words, no digit at all.

With both handled (Bengali→ASCII normalisation, and a per-question KPI check that accepts a
"none" phrasing when the truth is 0), the **same code** scores **9/10**.

That is now the second measurement bug in this script — P0 caught one that flattered the product,
this phase caught one that maligned it. Both are recorded rather than quietly corrected, because a
metric nobody distrusts is how a team ends up fixing the wrong thing.

### What was actually measured — three probes, no guessing

Rather than reason from the code a third time, the model was instrumented directly:

| probe | question | answer |
|---|---|---|
| does the model call the tool at all? | 5 data questions through the real service | **5/5 called `get_my_task_counts`** |
| does the tool result reach it? | injected sentinel values (777/555/333/111) | **5/5 answered with the sentinel** |
| does it stream content *alongside* the tool call? | raw stream, 6 questions | **0/6** — always a bare tool call |

So the pipeline was working end-to-end the whole time.

### The bug that WAS real — and why it still had to be fixed

`streamReply` returned as soon as any content had streamed:

```ts
if (contentStreamed || toolCalls.length === 0 || !opts.tools) return;
```

A round that emits a lead-in sentence **and** a tool call had its tool call **silently discarded**.
The third probe shows `gpt-4o-mini` does not currently do that (0/6), so this never fired in
production — but it is a live trap: a model change, a temperature change, or the much larger system
prompt coming in P4 can all start producing a preamble, and the failure mode is silent (the user
gets a stub, no error anywhere).

**Fixed:** the early return is now `toolCalls.length === 0 || !opts.tools`, and the already-streamed
text is carried into the assistant turn's `content` alongside `tool_calls` — so the follow-up round
continues from what the reader has already seen instead of repeating it.

### Tried, measured, reverted — the system-prompt edit

The prompt contains a real contradiction: *"Answer **ONLY** using the KNOWLEDGE BASE"* (line 34)
against *"**USE a tool** whenever the user asks about their ACTUAL tasks"* (line 36). I rewrote it
into an explicit (a) how-to → KB / (b) real-data → tool decision, on the theory that the grounding
rule was suppressing tool use.

**Then I measured it: the ORIGINAL prompt also produced 6/6 tool calls.** The theory was wrong, the
change moved nothing, and P1's scope is the round-trip — so it was **reverted**. Prompt work belongs
with the KB rewrite (P4/P9), where it can be measured against a content baseline rather than
shipped on a hunch.

### Shipped
- **`src/services/AssistantService.ts`** — the early-return fix + preamble carried into the
  assistant turn.
- **`tests/assistant/tool-roundtrip.test.ts`** (7 tests) — drives the real HTTP route with a fake
  stream, so the controller → service → executor path is covered exactly as production runs it:
  **the regression** (content + tool call in one round still runs the tool) · the tool's real result
  reaches the model · the lead-in is carried into the follow-up turn · a bare tool call still works ·
  a plain answer still ends in one round · a throwing/unknown tool still gets a round to answer ·
  **the round cap holds** against a model that asks for a tool forever (≤4 calls).
- **`scripts/assistant-eval.cjs`** — Bengali-numeral normalisation, per-question KPI matching, and
  the zero-said-in-words case.
- **`.eslintignore`** — `scripts/` excluded (plain Node CJS, outside the TS project).

### Verified
`jest.assistant` **5 suites / 59 tests** ✅ (was 4/52) · server `tsc` clean ✅ ·
`eslint src` unchanged (54 pre-existing, none in touched files) ✅ · live eval **data 9/10 PASS** ·
Bangla 15/15 ✅ · fabricated routes 0 ✅.

Links (3/15) and steps (12–13/15) are untouched, as expected — those are P2–P4's job.

**Verdict: Phase 1 COMPLETE. The metric now tells the truth, a latent silent-failure bug is closed
and pinned by tests, and one speculative change was measured and thrown away. Ready for "AI phase 2
koren" (delete the five false statements from the knowledge base).**

---

## Phase 2 — every false statement removed at source — ✅ COMPLETE (2026-07-28)

The plan listed five. Auditing the KB claim-by-claim against the **live system** found **seven**.

### The audit
Every factual claim in all 18 KB sections was checked against running code or the live database —
not against memory. Most held up (the 4 views, WIP limits, swimlanes, the Unscheduled calendar
panel, the 5 default statuses, the Reviewer property, snooze durations, the public-form flow, the
search surface). Seven did not.

| # | The claim | The reality | Checked by |
|---|---|---|---|
| 1 | "Owner … can do everything, **including deleting the workspace**" | `routes/workspace.ts` has **GET and PATCH only** — there is no delete endpoint anywhere | route read |
| 2 | "**Guest** — limited, mostly **read-only** access" | The seeded Guest role holds **19 permissions** including `task.create/edit/archive/delete` and `comment.create`. The only thing a Guest lacks that a Member has is **attachment upload** | live DB query |
| 3 | Settings has **9** sections | The live nav has **10** — **Roles & permissions** was missing | live nav |
| 4 | "Most setup and management actions **need Admin or Owner**" | Since RBAC it is whatever an admin configured; Owner/Admin is only the default | shipped feature |
| 5 | "Spaces, Lists and tasks **do NOT have fixed addresses**" | They do — `/s/:spaceId`, `/s/:spaceId/l/:listId`, `/t/:taskKey`. The real reason not to link them is that the bot cannot know the id | router read |
| **6** | Task types are "(Task, Bug, Feature, Campaign, Order or Complaint)" | There are **seven** — **Incident** was missing | live DB query |
| **7** | **Recurrence** listed as an ordinary task Property, no caveat | The field, its UI (`RecurrenceConfig.tsx`) and its DB columns all exist and save — but **no job in `src/jobs/` ever acts on it**. Set a recurrence and the next task never appears | jobs dir + schema |

**#6 and #7 were not in the plan.** #7 is the worst of the seven: the other six mislead about where
a thing is, while this one lets someone set a repeating task, walk away, and never learn it did not
repeat.

### Fixed
The Roles section now describes the Owner as the account that cannot be locked out (and says
plainly there is no way to delete the workspace), the Guest by **what it can actually do**, and
states that permissions are configurable. The Settings list gained **Roles & permissions** and a
note that you only see what you have permission for. The address rule now says *never write a link
to a Space, List or task* — true, and it keeps the no-guessing behaviour for the right reason.
Task types name all seven. Recurrence carries an honest caveat in Properties and a full entry under
"Good to know".

*(The new Roles **section** — custom roles, the permission grid, the three scopes — is P3. P2 only
stops the lies.)*

### Tests — `kb-coverage.test.ts` +8
One assertion per correction, each written to catch the claim's **return**, not merely its absence
today: no "including deleting the workspace" / "can delete the workspace" · no "mostly read-only" ·
`Roles & permissions` present · "configurable" present · no "do NOT have fixed addresses" · all
seven task types with the exact full-list sentence · the recurrence caveat present · the literal
still free of backticks and `${`.

**Two of the first assertions caught my own corrections** — `/delet\w*\s+the\s+workspace/i` matched
the sentence *"there is no way to delete the workspace"*, and `/guest[^\n]*read.?only/i` matched
*"a Guest is NOT read-only"*. Both were retargeted at the CLAIM rather than the topic, and each is
now paired with a positive assertion so a wholesale rewrite of the section fails too.

**The guard was then verified to actually bite:** reintroducing "mostly read-only access" into the
KB made the suite fail (1 failed), and restoring it made it pass again. A guard nobody has seen fail
is not yet a guard.

### Live confirmation
| asked | before | now |
|---|---|---|
| "Guest role er manush ki ki korte pare?" | described as read-only | no read-only claim |
| "workspace ta kivabe delete korbo?" | could promise it | clean |
| "task er koi rokom type ache?" | six | names **Incident** |
| "Settings e ki ki section ache?" | nine | names **Roles** |
| "recurring set korle system nijei porer task banabe?" | (unasked) | **3/3 answered honestly: no, make it yourself** |

### A third measurement bug, found and fixed
The eval flagged **1 fabricated route** — it was **`/settings`**, which is a real route (the index
that redirects to `/settings/profile`) that my hand-written `REAL_ROUTES` list had omitted. The list
is now taken from `client/src/router.tsx`'s actual 22 static paths, with dynamic routes
deliberately excluded so that a link to `/t/:id` still counts as a fabrication.

That is three metric bugs in three phases (P0 flattered, P1 maligned, P2 false-alarmed). Worth
saying out loud: on this kind of work the measuring stick needs as much scepticism as the product.

### Verified
`jest.assistant` **5 suites / 67 tests** ✅ (was 5/59) · server `tsc` clean ✅ · eslint unchanged ✅ ·
live eval: **data 9/10 PASS · Bangla 15/15 PASS · fabricated 0 PASS · forbidden claims 0 PASS** ·
links 4/15 and steps 13/15 still open, as expected — that is P3/P4.

**Verdict: Phase 2 COMPLETE — the bot no longer says anything untrue about the system. Ready for
"AI phase 3 koren" (teach it the RBAC feature: `/settings/roles`, custom roles, the three scopes,
per-space assignment).**

---

## Phase 3 — the bot learns the RBAC feature — ✅ COMPLETE (2026-07-28)

### First: what is actually true today
Before writing a word, the claim was checked against the shipped UI — the P2 lesson. Two findings
shaped the whole section:

- ✅ **`/settings/roles` works**: the role list with holder counts, the grouped permission grid, the
  inline scope selector, New role, Save changes, delete-custom-role, Owner locked.
- ❌ **There is NO UI to assign a role.** `MembersSettings.tsx` hardcodes
  `["admin","member","guest"]`, and **nothing in the client calls the assignment API**. Per-space
  assignment and custom-role assignment are RBAC P24/P27 — still open.

So the flagship question — *"give this person Marketing-only access"* — **cannot be fully done from
the product yet.** Writing a confident recipe for it would have been a new false claim two phases
after removing five of them. The section therefore teaches what the product can do and states the
limit plainly.

### Written
- **Editing what a role can do** — the page, the grid, the 12 permission groups, red for dangerous,
  New role, "the change takes effect on that person's very next click", and the Owner role shown
  but uneditable *with the reason*.
- **How far a permission reaches** — the three scopes in the UI's own words (**Everywhere** /
  **Their spaces** / **Own items**), with `See spaces = Their spaces` called out as the master
  switch that everything else follows.
- **"I want someone to see only their own department"** — the four-step recipe, ending in a
  ⚠️ step that the switch hits **everyone holding that role**, plus the honest limit.
- **"You don't have permission" — what it means** — not a bug, ask an Owner/Admin, with the link.
- `/settings/roles` added to the page-address block, and three new Quick answers.

### Tests — `kb-coverage.test.ts` +8
The roles link (in prose *and* in the address block) · the grid + "very next click" · **the three
scope labels matched to `RolesSettings.tsx`'s own `SCOPE_LABEL`**, so the bot cannot describe
buttons that are not on screen · See spaces as the master switch · the Owner-uneditable rule ·
**the honest "no UI yet" limit** · the refusal explanation · the two new Quick answers.

### Live — the two questions that failed at P0
| question | before | after |
|---|---|---|
| "notun custom role kivabe banabo?" | no page at all | **4/4 → `/settings/roles`** |
| "ekjon ke shudhu Marketing space er access dite chai?" | 0/3 mentioned roles; **2/3 sent them to Settings → Members**, which cannot do it | **3/4 → `/settings/roles` + names See spaces + Their spaces** |
| "amake bolche permission nai, ki korbo?" | — | **→ `/settings/roles`** |

**One iteration inside the phase, worth recording.** The first draft led with the limitation
paragraph, which contained a `[Settings → Members]` link — and the bot kept latching onto it, still
answering with the wrong page (2/3). Putting the actionable steps FIRST and demoting the Members
mention to unlinked prose flipped it to 3/4 correct. Then the caveat started disappearing (0/4), so
it was moved *inside* the numbered steps as step 4; it now survives in 2/4.

**Residual variance is real and not hidden:** 1 in 4 answers still reaches for
`/settings/members`, and the "applies to everyone with that role" warning appears about half the
time. Both are the same root cause the plan already names — the model can only link when the
question happens to hit a linked passage — and both are what **P4** exists to fix by making links
structural across all 18 sections rather than concentrated in a few.

### Verified
`jest.assistant` **5 suites / 75 tests** ✅ (was 67) · server `tsc` clean ✅ · eslint unchanged ✅.
Live eval: **steps 14/15 PASS** (was 13) · **data 10/10 PASS** · Bangla 15/15 ✅ · fabricated 0 ✅ ·
forbidden 0 ✅ · **links 4/15 — the one remaining failure, and it is P4's whole job.**

**Verdict: Phase 3 COMPLETE — the bot now teaches the newest feature accurately, including what it
cannot yet do. Five of six targets pass. Ready for "AI phase 4 koren" (the link layer: 4/15 → ≥14/15).**

---

## Phase 4 — the link layer — ✅ COMPLETE (2026-07-28)

**The phase that fixes the stated purpose. Links 3/15 → 14/15. Every plan target now passes.**

```
  answers with a clickable route   14/15    target >= 14   PASS
  answers with step-by-step        14/15    target >= 14   PASS
  answers in Bangla                15/15    target >= 15   PASS
  data questions answered           9/10    target >= 9    PASS
  fabricated routes emitted            0    target == 0    PASS
  forbidden claims repeated            0    target == 0    PASS
  VERDICT: PERFECT (all targets met)
```

### What changed — two halves, and the second one was the decisive one

**Half 1 — the KB (17 links → 83).** Every destination the KB names is now a markdown link:
the whole Sidebar list, the page-address block (converted from plain text like `**Inbox** — /inbox`
to `[Inbox](/inbox)`), the Inbox / Search / Forms / Engineering / Settings sections, all ten
Settings sub-pages, and the Account section (`/login`, `/forgot-password`, `/settings/profile`,
`/settings/members`). Every how-to now says where to stand before it says what to press — creating
a task leads with **Quick Create (+)** "on every page, including [Home](/)"; opening a task lists
the three real ways to reach one; assigning ends with "to see everything assigned to YOU, go to
[Home](/)".

That alone took links from **3/15 to 7/15** — real progress, and clearly not enough.

**Half 2 — the system prompt rule (D-2's other half).** The KB *had* links for several of the
remaining questions; the model simply did not reach for them, because the natural focus of "how do
I attach a file" is the in-task action, not a page. So the prompt now carries the rule:

> **EVERY answer must give the person somewhere to start — end it with at least one clickable
> link.** … If the exact thing has no address of its own (a Space, a List, a single task), link the
> nearest page that DOES and then say what to do from there: own tasks / getting started → Home;
> finding something → Search; notifications → Inbox; settings/people/roles → the matching Settings
> page. Only skip the link when the question genuinely has no page at all.

**7/15 → 14/15.** This is the half the plan named in decision D-2 ("enforced in BOTH places") and it
is where most of the movement came from — worth recording, because the instinct is to treat content
as the whole job.

### Honest note on variance
Three consecutive runs scored **14/15, 15/15, 14/15** on links, and **14, 13, 14** on steps. So
links are now solidly at target while *steps* sits on the boundary and dips below on some runs. The
underlying answers are the same quality; the grader counts a numbered or bulleted list, and a short
two-sentence answer to a concept question ("what is Board view?") sometimes has neither. Recorded
rather than smoothed over — P10 re-runs this and will decide whether the steps rule needs the same
treatment the link rule just got.

### Size (landmine L2)
The system message ships on **every** request, so growth is a real cost:
**27,611 → 29,341 chars (~6,903 → ~7,335 tokens), +6.3%** — a test now fails the build above
34,000 chars.

### Tests — `kb-coverage.test.ts` +25 (76 → 101 → 104)
Each of the **22 static routes** asserted to appear in **link** form (plain-substring check, no
regex) · the Sidebar list links all seven of its destinations · a floor of 60 links so the layer
cannot quietly erode · Spaces/Lists/tasks still never linked · the size budget · and three
assertions pinning the prompt rule itself, including the fallback destinations, so removing it
fails the build.

### Two mistakes made and corrected inside this phase
1. A bulk replace linked **"Workspace"** in the *core-structure hierarchy* — where it means "the
   whole company" — to `/settings/workspace`. Wrong meaning, right word. Reverted to plain text
   with the settings page mentioned separately.
2. The first version of the route assertions built a regex through a template literal; the
   backslashes collapsed and every one of the 22 silently became a character class that matched
   nothing. Replaced with `toContain("](" + route + ")")` — no escaping to get wrong. *(A test that
   fails for the wrong reason is at least loud; one that passes for the wrong reason would have
   been worse.)*

Also noted: the link scanner flagged an unlinked "**Settings**" in the Forms section — it is the
form editor's own *tab*, not the app's Settings page. Correctly left alone; the scanner was wrong.

### Verified
`jest.assistant` **5 suites / 104 tests** ✅ (was 75) · server `tsc` clean ✅ · eslint unchanged ✅ ·
live eval **all six targets PASS**.

**Verdict: Phase 4 COMPLETE — the bot now takes people where they need to go, which was the whole
point. Ready for "AI phase 5 koren" (make the freshness guard structural, so the next new page
cannot ship without the bot learning it).**

---

## Phase 5 — the freshness guard becomes structural — ✅ COMPLETE (2026-07-28)

The most durable artifact of this plan. Every other phase fixes something that is wrong *today*;
this one stops the same thing going wrong *again*.

### The problem with the guard we had
`kb-coverage.test.ts` asserts facts a person thought to write down — so it can only catch drift
somebody already knows about. Its twenty Dept-Review assertions sat green for the entire time the
knowledge base was going stale about RBAC, because nobody had written an RBAC assertion yet. That
is not a bug in the assertions; it is the shape of the guard.

### What replaces it — `tests/assistant/route-parity.test.ts`
The new guard depends on nobody remembering anything. It reads **the router** — the app's real list
of pages — and compares it with the knowledge base, in both directions:

| assertion | catches |
|---|---|
| every static `path:` in `client/src/router.tsx` is mapped | **a new page shipped** without anyone telling the bot |
| the KB **links** every page the app has | a page the bot knows about but cannot send anyone to |
| the KB never links a page that is not in the router | **a fabricated or deleted route** — the build-time version of the eval's runtime "fabricated routes" metric |
| the KB never links a Space, List or task | landmine L4 — those ids are unknowable, so linking one is always wrong |
| the router still HAS dynamic routes | the L4 exclusion has not quietly become a no-op |
| the router file is present at all | a silent skip is not a guard |

The segment→address map is **hand-maintained on purpose**: the router nests (`settings` → `profile`
is really `/settings/profile`), and a new page failing the first assertion forces whoever added it
to decide what the bot should say about it. Two lines of work, at exactly the moment the knowledge
is fresh.

### Both directions verified to actually bite
A guard nobody has watched fail is not yet a guard, so both were tested by breaking them:

- **Shipped a fake page.** Added `{ path: "analytics" }` to the router → the suite failed with
  `unmappedRouterPaths: ["analytics"]`. Router restored, green again.
- **Faked a link to a page that does not exist.** Added `[Analytics](/analytics)` to the KB → the
  suite failed with `inventedRoutes: ["/analytics"]`. KB restored, green again.

That second one matters more than it looks: it means the assistant can no longer send anyone to a
dead URL, and it is checked by `tsc`-speed unit tests rather than by asking the live model 15
questions and hoping.

### Verified
`jest.assistant` **6 suites / 110 tests** ✅ (was 5/104) · server `tsc` clean ✅ · eslint unchanged ✅.
Live eval unchanged and still passing everything:
**links 15/15 · steps 14/15 · Bangla 15/15 · data 9/10 · fabricated 0 · forbidden 0 — PERFECT.**

**Verdict: Phase 5 COMPLETE — the knowledge base can no longer silently fall behind the product.
Ready for "AI phase 6 koren" (enforce `assistant.use`, the catalog key that currently gates
nothing).**

---

## Phase 6 — `assistant.use` becomes a real permission — ✅ COMPLETE (2026-07-28)

The key was in the catalog and granted to all four seeded roles, but **no route checked it**. An
admin who unticked "Use the AI help assistant" in the permission grid got exactly nothing. That
breaks the catalog's own stated rule — *every key maps to at least one real enforcement point,
because a checkbox that gates nothing is a lie to whoever ticks it.*

### Shipped
- **`routes/assistant.ts`** — `requirePermission("assistant.use")` on all three routes:
  `POST /chat`, `GET /conversations`, `GET /conversations/:id`.
- **`client/src/http/assistant.ts`** — a 403 now says *"সহায়ক ব্যবহারের অনুমতি আপনার রোলে দেওয়া নেই"*
  instead of the generic "something went wrong, try again". Retrying a 403 will never work, so
  offering it makes the panel look broken (landmine L5). A 429 got a specific line too, since the
  20/min limiter was equally opaque.

**Ordering decision:** the rate limiter stays OUTSIDE the permission check
(`authenticate → assistantLimiter → requirePermission`). The limiter is a cheap in-memory counter;
the permission check is a database read. Letting a flood through the limiter just to look up
permissions would defeat the point of having a limiter.

### Nothing changes today — and that is the thing being proved
All four seeded roles hold `assistant.use`, so this is dormant until an admin decides otherwise —
the same "seeded default reproduces today" rule the whole RBAC rollout runs on.

### Tests — `tests/assistant/permission.test.ts` (9)
- **owner / admin / member / guest can all still chat** (one case each) and a member can still list
  their conversations — the no-change half.
- A user whose role omits the key gets **403**, and the error `details` name **which** permission
  was missing, so "why can't I use the bot?" has a one-word answer.
- The conversation endpoints 403 too, not just chat.
- **OpenAI is never called** when the permission is missing — the gate runs before the controller,
  so a refused request spends no tokens.
- **401 still beats 403**: an anonymous caller gets 401 and the response never mentions
  `assistant.use` — someone who has not signed in learns nothing about the permission model.

### Deliberately NOT done here
Hiding the floating button for someone who lacks the permission. It needs `usePermissions()` and a
`ready` guard to avoid flashing a button that then vanishes — that is **P7**'s whole job, and doing
it twice would mean doing it worse. Today such a user sees the button, asks once, and gets a clear
Bangla explanation instead of a dead panel.

### Verified
`jest.assistant` **7 suites / 119 tests** ✅ (was 6/110) · server `tsc` clean ✅ ·
`eslint src/routes/assistant.ts` clean ✅ · client `tsc -b` clean ✅ · client `vitest` 40 ✅ ·
live eval unchanged: **links 15/15 · steps 14/15 · Bangla 15/15 · data 9/10 · fabricated 0 ·
forbidden 0 — PERFECT**.

**Verdict: Phase 6 COMPLETE — the permission grid now tells the truth about the assistant. Ready
for "AI phase 7 koren" (the widget: swap its six legacy `user.role ===` checks for
`usePermissions()`, gate the Dept starter question on the real permission, and add the RBAC
starter question).**

---

## Phase 7 — the widget stops guessing from the legacy role — ✅ COMPLETE (2026-07-28)

### ⚠️ Correction to the scan
`AI_ASSISTANT_SCAN_2026-07-28.md` reported "**six** `role ===` string checks" in the widget. That
was a grep count, not a reading. Five of them are `m.role === "assistant"` / `m.role === "user"` —
**message** roles inside the transcript renderer, nothing to do with authorization. There was
exactly **one** permission check, on line 122. The defect was real; its size was overstated, and
the scan is corrected rather than quietly matched.

### Shipped
- **`AssistantWidget.tsx`** now calls `usePermissions()`:
  - **The floating button is hidden entirely without `assistant.use`.** P6 made the routes refuse;
    leaving a button that only ever apologises would be worse than no button. Guarded on `ready`,
    so a slow permission fetch shows nothing rather than flashing a button that then disappears.
  - The Department starter question is gated on **`review.read` / `report.view`**, not on
    `user.role === "owner" || "admin"`.
- **`suggestions.ts`** — each question can now declare its own audience
  (`show: (a) => a.canManageRoles`), replacing the single `deptOnly` boolean, and a **ninth
  question** was added: *"কাউকে শুধু একটা department-এর access কীভাবে দেব?"* — the exact question
  that failed at P0 — shown only to someone holding `role.manage`.

### The head check stays, deliberately
The obvious change was to replace the role string with the permission and stop. That would have
**hidden Department from the very people it was built for**: a plain Member who is the Head of a
Space can reach `/dept`, and that rule lives in the service (head-of-space), not in a grant — the
seeded roles give `review.read` to admin and owner only. So the gate is
`holds("review.read") || holds("report.view") || isHeadOfAnySpace`. Same reasoning as the RBAC
build: permissions are **additive** to the in-service rules, never a replacement for them.

### Tests — `suggestions.test.ts` rewritten (4 → 8)
Ungated questions go to everyone · the curated set is still ≥7 · Department hidden/shown by its
gate · roles question hidden/shown by its own · **the two gates do not leak into each other**
(seeing Department must not imply editing roles) · both together shows everything · every question
is a non-empty Bangla string.

### Verified in the browser
Signed in as an admin on the live stack: the FAB renders, the panel opens, and **nine** starter
chips are shown — including *"Department review আর weekly report কোথায়?"* and the new
*"কাউকে শুধু একটা department-এর access কীভাবে দেব?"*.

Client `vitest` **7 files / 44 tests** ✅ (was 40) · client `tsc -b` clean ✅ ·
`jest.assistant` **7 suites / 119 tests** ✅ · live eval unchanged: **PERFECT**.

**Verdict: Phase 7 COMPLETE — the widget now mirrors what the person can actually do, and offers
the RBAC question to exactly the people who can act on it. Ready for "AI phase 8 koren" (prove the
assistant's tools are scoped by RBAC — the untested half of landmine L12).**

---

## Phase 8 — the assistant is proven RBAC-scoped — ✅ COMPLETE (2026-07-28)

Landmine **L12** said the assistant could become a way around the whole permission system: its
tools read the workspace, and a bot that answers "find me X" without a visibility filter is a
prettier version of querying the database directly.

The RBAC work closed it *by construction* — `SearchRepo` and `HomeRepo` now filter by the caller's
scope — and the scan verified the mechanism in isolation. What was missing was a test that proves
it **through the real route, against a real database**, in the one place in this app that reads the
database from inside a **streaming loop**, several awaits deep in an OpenAI response iterator. If
the async context did not survive that, every tool would silently run unrestricted.

### `tests/assistant/scoping.test.ts` (5)
Each drives `POST /assistant/chat` with a fake model that calls a tool, and asserts on **the tool
result the model was shown** — not on the rendered answer. That distinction matters: asserting on
the reply would test the model's discretion; asserting on the tool result tests the boundary.

| test | proves |
|---|---|
| a person scoped to Marketing searches "ZQ" | sees `ZQMARKETING`, **not** `ZQSUPPORT` |
| an admin runs the same search | sees **both** — the filter is the caller's, not a blanket |
| a scoped person searches broadly | their own space name comes back, the foreign **space and list names do not** — a name alone tells an outsider that a department exists |
| `get_my_task_counts` for both | admin's `openTeamTasks` = **4**, the Marketing-only person's = **1** (that counter used to count the whole company for everyone) |
| two different callers in sequence | each gets only their own department — if the async context were lost or shared, the second would inherit the first |

### Verified to actually bite — twice
1. **Vacuity guard.** "Support is absent" proves nothing if the search returned nothing at all, so
   every negative assertion is paired with a positive one (`toContain("ZQMARKETING")`,
   `toContain("Marketing")`) in the same result.
2. **Broke the thing under test.** Removed the visibility predicates from `SearchRepo` → **2 of the
   5 failed**. Restored → 5/5 green. A test that has never failed is not yet evidence.

### Verified
`jest.assistant` **8 suites / 124 tests** ✅ (was 7/119) · server `tsc` clean ✅.

**L12 is now closed and evidenced, not merely reasoned.**

**Verdict: Phase 8 COMPLETE. Ready for "AI phase 9 koren" (give the JSON chat path the same tools
as the SSE path — decision D-9 from P0 — plus the prompt sweep).**

---

## Phase 9 — one contract, both transports — ✅ COMPLETE (2026-07-28)

### The gap
`POST /assistant/chat` came in two flavours that behaved differently. With
`Accept: text/event-stream` it had tools; without it, `ask()` called the model once with no tools
at all — so the JSON path silently could not answer "how many tasks do I have" while its own twin
answered it fine. The browser always streams, so **nobody had noticed**, and that is exactly what
made it worth removing rather than documenting: the next client to use the JSON path — a script, a
mobile app, an integration — would have lost every data answer with no error to explain it.

P0 locked this as **decision D-9: both transports get tools.**

### Shipped
- **`AssistantService.ask()`** now runs the same round loop as `streamReply`: tools offered on
  every round but the last, tool calls executed, results fed back, and a plain answer returned when
  the model stops asking. Never answering across all rounds is a clean **502
  `assistant.empty_reply`**, not a hang or an empty body.
- **`appendToolRound()`** — the assistant tool-call turn plus each tool result, extracted and now
  shared by BOTH transports. That block was the duplicated-and-divergent logic in the first place;
  leaving two copies would have re-created this bug the next time one side changed.
- **`ToolBridge`** type and **`MAX_TOOL_ROUNDS`** hoisted so the two paths cannot drift on the
  shape of a tool or on the loop cap.
- **`AssistantController.chat()`** passes the same `ASSISTANT_TOOL_DEFS` +
  `executeAssistantTool(…, toolCtx, …)` the streaming path uses — same identity injection, so the
  RBAC scoping proven in P8 covers this path too.

### The prompt sweep
The plan also listed "sweep the system prompt for the always-give-a-route rule". That rule went in
during **P4**, where it was measured (links 7/15 → 14/15) rather than assumed, and P5 pinned it
with three assertions. Nothing further was needed here — recorded so the phase is not credited with
work it did not do.

### Tests — `tool-roundtrip.test.ts` +3 (7 → 10)
The JSON path calls a tool, feeds the **real** result back and answers from it (two model calls) ·
still answers plainly in one round when no tool is needed · **the round cap holds here too** — a
model that asks for a tool forever gets a 502 after at most four calls rather than looping.

### Verified
`jest.assistant` **8 suites / 127 tests** ✅ (was 8/124) · server `tsc` clean ✅ ·
`eslint` clean on both touched files ✅ · live eval unchanged: **links 15/15 · steps 14/15 ·
Bangla 15/15 · data 9/10 · fabricated 0 · forbidden 0 — PERFECT**.

**Verdict: Phase 9 COMPLETE — the assistant behaves the same whichever way you call it. Ready for
"AI phase 10 koren" (full verification: the eval against the Part-2 thresholds, every suite, and a
browser pass of the widget).**

---

## Phase 10 — full verification — ✅ COMPLETE (2026-07-28)

Verification found two real defects and two metrics that were measuring the wrong thing. Both
kinds are written up, because a verification phase that only reports green numbers is not
verification.

### 🐞 Defect found and fixed: the bot read the wrong number

Asked *"workspace e mot koyta open task ache?"* (truth **36**) the bot answered **2** — the user's
own count. Same for *"aj koyta task due ache amar?"*: answered 2 when the truth was 0. The tool
returned correct data every time; the model picked the wrong field out of it, and a wrong number
delivered confidently is worse than no answer.

Cause: terse, ambiguous keys — `myOpenTasks` vs `openTeamTasks` — with nothing saying which scope
each covered. Fixed by naming the scope **inside the key**:

```
openTasksAssignedToMe · myTasksDueToday · myTasksOverdue
tasksAwaitingMyReview · openTasksAcrossTheWholeWorkspace · slaBreachesAcrossTheWholeWorkspace
```

plus a tool description that says outright that a question about the team is **not** a question
about the user's own tasks. **Data answers went from 8/10 to 10/10** on the next run and have not
dropped below 9/10 since.

### Two metrics corrected (five, cumulatively, across this plan)

1. **"Answered in Bangla" was an ASCII ratio.** But the bot is *supposed* to keep UI labels in
   English and to emit `](/settings/roles)` — both pure ASCII — so P4's link work pushed
   correct answers toward the threshold. Replaced with: strip link targets, then require **≥50% of
   the letters to be Bengali**. Measured across the 15 answers the real share runs **0.71–0.96
   (median 0.84)**, so a failure now means an answer genuinely was mostly English — which is what
   the metric is for. The script self-checks that it still **rejects** an English answer and accepts
   a Bangla one; a grader that cannot fail is not a grader, and this file has now had five bugs.

2. **"Step-by-step" demanded numbered lists from questions that should not have them.** The two
   questions that consistently lacked steps were *"what is this system?"* and *"who reviews my
   work?"* — prose answers, correctly. Forcing a numbered list on them would make the answer worse.
   The metric now asks: of the **12 questions with something to do**, how many give steps —
   target **all of them**, which is stricter per question than the old "14 of 15 including the
   ones that shouldn't".

### The e2e detour, recorded honestly
Two of the seven `assistant.pw.ts` tests failed at the **login** step. I diagnosed the 5/min login
rate limiter, then wrote a retry loop (made it worse — the wait blew the per-test timeout), then a
`storageState` fixture (worse again — 3 failures). Only then did I read `rateLimit.ts` properly and
find the escape hatch that already existed for exactly this:

```
DISABLE_RATE_LIMIT=1   // "used by local browser-E2E runs — those log in many
                       //  times per minute from one IP"
```

Both invented fixes were reverted. With the documented flag — and after killing the stale server
that was still holding port 5501, which is why my first attempt with the flag *also* showed 429s —
the suite is **7/7 in 42s**. Lesson worth keeping: I built two solutions to a solved problem
because I diagnosed from a grep instead of reading the file.

### The full sweep

| check | result |
|---|---|
| `jest.assistant` | **8 suites / 127 tests** ✅ |
| client `vitest` | **7 files / 44 tests** ✅ |
| `e2e/assistant.pw.ts` (live gpt-4o-mini) | **7/7** ✅ — incl. streaming, **in-app link navigation with no reload**, mid-conversation suggestions, the onboarding nudge, **error banner + Retry recovers**, focus restore, Copy |
| server `tsc` / client `tsc -b` | clean ✅ |
| eslint | unchanged (54 pre-existing, none in touched files) ✅ |

### The gate, across runs

| metric | observed | target |
|---|---|---|
| answers with a clickable route | **14–15 / 15** | ≥14 |
| actionable answers with steps | **11–12 / 12** | 12 |
| answers in Bangla | **14–15 / 15** | 15 |
| data questions answered correctly | **9–10 / 10** | ≥9 |
| fabricated routes | **0**, every run | 0 |
| forbidden claims | **0**, every run | 0 |

**Most runs are PERFECT; some dip one point on steps or Bangla.** That is live-model variance at
`temperature 0.3`, not a regression — roughly one answer in fifteen, in one metric, in some runs.
Recorded as a range rather than quoting the best run, because the honest statement is *"it clears
the bar nearly every time"*, not *"it always does"*.

Compare with where this started (P0): **links 3/15, data 2/10** — and both of those numbers were
themselves wrong in the pessimistic direction.

**Verdict: Phase 10 COMPLETE. Ready for "AI phase 11 koren" — the ship gate.**

---

## Phase 11 — ship gate — ✅ COMPLETE (2026-07-28) — 🏁 "MAKE IT PERFECT" SHIPPED

### The gate run
```
  answers with a clickable route   15/15    target >= 14   PASS
  actionable answers with steps    12/12    target >= 12   PASS
  answers in Bangla                15/15    target >= 15   PASS
  data questions answered          10/10    target >= 9    PASS
  fabricated routes emitted            0    target == 0    PASS
  forbidden claims repeated            0    target == 0    PASS
  VERDICT: PERFECT (all targets met)          (exit 0)
```
`jest.assistant` **8 suites / 127 tests** ✅ · client `vitest` **7 files / 44** ✅ ·
`e2e/assistant.pw.ts` **7/7** against the live model ✅ · server + client `tsc` clean ✅ ·
eslint unchanged ✅.

### Zero-open triage — all ten defects closed

| # | defect | closed in | how it was proved |
|---|---|---|---|
| D1 | links missing from 12/15 answers | **P4** | KB 17→83 links **plus** a prompt rule; 3/15 → 14–15/15 |
| D2 | KB predated RBAC | **P3** | live probes: the two questions that failed at P0 now return `/settings/roles` |
| D3 | five factual errors | **P2** | audit found **seven**; each pinned by a test, and the guard watched to fail |
| D4 | tool round-trip discarded | **P1 + P10** | the latent bug fixed and tested; the *actual* live failure (wrong field read) found in verification and fixed |
| D5 | freshness guard blind | **P5** | `route-parity.test.ts`, broken deliberately in both directions |
| D6 | `assistant.use` gated nothing | **P6** | 403 with the permission named; OpenAI never called |
| D7 | widget on the legacy role | **P7** | `usePermissions()`, with the head-of-space rule kept |
| D8 | L12 scoping untested | **P8** | 5 end-to-end tests; filter removed → 2 failed |
| D9 | JSON path had no tools | **P9** | one shared tool loop |
| D10 | no RBAC starter question | **P7** | gated on `role.manage` |

### Still open — deliberately, and the bot says so itself
Giving **one person** a role inside a **single Space**, and assigning **custom** roles, has no UI:
`MembersSettings.tsx` offers only Admin/Member/Guest and nothing in the client calls the assignment
API. That is **RBAC plan P24/P27**, not an assistant gap — and rather than invent a recipe, the
knowledge base states the limitation and points at the workspace Owner/Admin.

### Known characteristic, not a defect
Across ~10 gate runs, most are PERFECT and some dip a single point on *steps* or *Bangla* — one
answer in fifteen, in one metric. That is live-model variance at `temperature 0.3`. It is recorded
as a range rather than quoting the best run.

### Shipped in this plan
**Server:** `assistant/knowledgeBase.ts` (the bulk) · `assistant/systemPrompt.ts` ·
`assistant/tools.ts` · `services/AssistantService.ts` · `controllers/AssistantController.ts` ·
`routes/assistant.ts` · `scripts/assistant-eval.cjs` (new) ·
tests: `tool-roundtrip` · `permission` · `scoping` · `route-parity` (all new) + `kb-coverage` +25.
**Client:** `components/assistant/AssistantWidget.tsx` · `suggestions.ts` (+ tests) ·
`http/assistant.ts`.
**Docs:** `AI_ASSISTANT_SCAN_2026-07-28.md` (now headed with the closure table) ·
`AI_ASSISTANT_PERFECT_PLAN.md` · this log · **`ASSISTANT_TEAM_NOTE.md`** — a one-page Bangla note
for the team on what the bot can now do and what it deliberately cannot.

### The one thing worth remembering from this plan
**The measuring stick was wrong five times**, and each time it pointed the work in a direction:
P0 counted any digit as a correct data answer (flattered it, 8/10 for a broken path); P1's Bengali
numerals and words-for-zero maligned it (2/10 for a working one); P2 called a real route
fabricated; P10 measured "Bangla" as an ASCII ratio while the product was correctly emitting
English UI labels, and demanded numbered steps from questions that read better as prose.

Three of the ten defects were only found *because* a metric was fixed — and one "critical" defect
(the discarded tool round-trip) turned out never to fire in production, while the real failure was
something else entirely. **On work graded by a model, the grader needs as much scepticism as the
thing it grades.**

**Verdict: Phase 11 COMPLETE — 🏁 the assistant does what it was built for: it teaches a confused,
non-technical person how to use this system, in Bangla, and takes them to the page.**

---

## Addendum — `create_task`: the assistant's FIRST write tool — ✅ SHIPPED (2026-08-13)

User ask: *"kono member or admin chatbot e prompt er maddhome task create korte parbe"* — create a
real task from chat. This deliberately breaks the "read-only" rule above, for exactly ONE verb, and
keeps every safety property by construction.

### Design (the safety story)
- **The tool goes through the real `TaskWriteService.create`** inside the authenticated request —
  the same code path as the New-task button. So the chatting user's own RBAC decides everything:
  ALS `rbacContext` scopes list resolution, `task.create` is enforced by the service, the
  **team-access P8 approval gate** still converts a cross-team assignee into a pending request, the
  audit trail (`task_created`) carries the real actor, and assignment emails/push fire post-commit
  exactly as from the UI. The model supplies only *intent* (names); identity comes from the JWT.
- **Names, not IDs, at the boundary.** `list_name` resolves via the RBAC-scoped `search` (exact
  match → unique candidate → else a readable error listing candidates); `assignee_names` resolve via
  `UsersRepo.listByWorkspace` with a **surname fallback** (the repo's `q` filter matches per-column,
  so "First Last" strings never match directly). Ambiguity or a miss **aborts the create** — never
  the wrong Rahim.
- **In-tool calendar validation** for `due_date` (the HTTP validator is bypassed on this path);
  `2026-02-30` is refused before anything is written.
- **Errors are data**: every refusal returns `{error, code}` as the tool result — the model is
  instructed a tool error means NOT created, relay the reason, never claim success, never retry
  with guessed values.

### Shipped
`tools.ts` (`create_task` def + handler, `ToolServices` + `taskWrite`/`users`) ·
`routes/assistant.ts` (6th `TaskWriteService` wiring site) · `systemPrompt.ts` (CREATING A TASK
section: explicit-ask-only, named list → call immediately, dates from the "Today is" line,
pendingApproval is normal-not-error) · `buildMessages.ts` (prepends `Today is <dhakaToday>
(Asia/Dhaka).` per call) · `knowledgeBase.ts` (+1 FAQ) · `ASSISTANT_TEAM_NOTE.md` (Bangla note
updated — capability #4).

### Tests — `tests/assistant/create-task-tool.test.ts` (7, same harness as scoping.test.ts)
Real create as the chatting user (row + `createdBy` + priority + dueDate + `task_created` audit) ·
invisible list refused (visibility boundary) · no `task.create` → real-service refusal, no row ·
ambiguous list name asks with candidates · unknown assignee aborts · **cross-team assignee →
`created:true` + `pendingApproval:[name]` + a pending `task_assignment_requests` row (P8)** ·
non-calendar date refused pre-write.

### Verified
`jest.assistant` **9 suites / 140 tests** ✅ (was 8/133) · server `tsc` + build clean ✅ · client
build clean (no client change needed — the widget already renders `/t/:id` links in-app) ✅ ·
**live probe against real gpt-4o-mini** on the dev stack: Bangla prompt → task created with due
date + priority, confirmed with a working `/t/…` link; unknown assignee refused with a question;
known assignee handled (instant path — target's `task.view` reach = all, the Q11 dormancy carve;
the gate path is pinned by jest). One prompt iteration was needed live: the model asked "which
list?" even when the list WAS named — fixed with an explicit "already named → call immediately"
rule, re-verified first-try.

**The bot remains read-only for everything else — edit/assign/complete/delete still get steps, not
actions.**

### Professional pass (same day, on the user's demand for a full re-scan + re-test)

A second, adversarial pass over the whole chatbot — code re-scan, four hardenings, a 13-scenario
live matrix against the real model, and the formal eval gate. It found real defects; all fixed.

**Hardenings from the code re-scan**
1. **Per-request duplicate-create guard** (`makeAssistantToolExecutor`): gpt-4o-mini sometimes
   emits the same tool call twice in one round; the second identical create now returns the FIRST
   result instead of writing a second row. Distinct names still create separately ("make two
   tasks: A and B" works — proven live, T11/S1).
2. **"@me" self-assign**: the model does not know the user's name (identity lives in the JWT), so
   "amake assign koro" used to fail a directory lookup. A literal "@me" now resolves to the caller.
3. **Same person named twice** ("Sadia", then "@me" resolving to the same id) is assigned once and
   reported once.
4. **Out-of-range priority now refuses** instead of silently defaulting — the bot could otherwise
   confirm "high" while the task landed priority-none.
   (Also verified during the re-scan, no change needed: SearchRepo already excludes archived
   lists/spaces from resolution, and `TaskWriteService.create` already dedupes assignee ids.)

**Live matrix (13 scenarios, real gpt-4o-mini, dev stack) — found two PROMPT defects**
- ✅ create with "kal" → due 2026-08-14, "urgent"→1, "normal"→3, description, English prompt,
  same-team assign direct (Q11 membership), **cross-team assign → pending request row for Sadia +
  correct Bangla approval explanation (P8 live-proven through chat)**, no-list→asks,
  unknown-list/person→readable refusal, vague hint→no create, delete request→steps only,
  two-distinct-tasks→both created, SSE transport streams the same tool path.
- 🐞 **Fabricated domain**: confirming TWO tasks at once, the model wrapped the links as
  https://beautybooth.com/t/… — an invented domain. Prompt now pins: the link is the result's url
  field verbatim, RELATIVE, never a domain. Re-probed: relative.
- 🐞 **Unasked self-assign**: the model passed "@me" on nearly every create the user never asked to
  assign (proved model-side: the service does NOT auto-assign creators — T3/T4 rows). Prompt now
  pins: no assignee_names unless the user asked. Re-probed: unassigned.

**The eval gate — and the SIXTH wrong-measuring-stick incident**
First run: `fabricated routes = 1` — but the "fabrication" was `/settings/teams`, a REAL page
(router.tsx) the eval's own `REAL_ROUTES` allowlist never learned when team-access shipped it.
`/sla` (F28) was missing too. Fixed the allowlist, taught it that `/t/<id>` links are now
legitimate (they come from tool results), gave the fabrication detector its own self-check, and —
the systemic fix — **route-parity.test.ts now pins the eval allowlist to the router**, so a new
page fails the build until BOTH the KB and the grader know it.

**Verified after all fixes**
`jest.assistant` **9 suites / 145 tests** ✅ (route-parity 6→7, create-task 7→11) · size budget
raised 38k → 39k with the decision recorded in the test (each create rule exists because a live
probe failed without it) · eval gate: **PERFECT — links 14/15 · steps 12/12 · Bangla 15/15 · data
10/10 · fabricated 0 · forbidden 0** · server tsc + build clean · all 19 probe tasks hard-removed
from the dev DB (the API's DELETE archives; probes were purged by SQL).

> ⚠️ **Corrected the same day by DEEP PLAN P0:** that PERFECT reading was partly luck. Re-run
> three times, the Bangla metric fails in **2 of 3 runs** on one question — the bot answers in
> romanized Banglish instead of Bangla script. See DEFECT-1 below; the honest baseline lives in
> `AI_ASSISTANT_DEEP_PLAN.md` §5.

---

# 🧭 DEEP PLAN (accurate · easy · permission-scoped) — `AI_ASSISTANT_DEEP_PLAN.md`

Protocol: the user says **"AI deep phase N koren"** → only that phase → build → test → log here.

## Deep P0 — decisions locked, design code-verified, honest baseline — ✅ COMPLETE (2026-08-13)

**No product change by design.** P0 exists so P2/P3/P4 build what was designed instead of what
was remembered, and so every later phase has a real number to diff against.

### Baseline
system message **38,272 chars** (budget 39,000 → **728 headroom**) · tool defs **3,143 chars**,
4 tools · `jest.assistant` **9 suites / 145** · eval **not reliably PERFECT** (see DEFECT-1).

### Design verified in the code, not assumed
| claim the plan rests on | verdict |
|---|---|
| `currentActor()` reaches inside a tool | ✅ ALS store from the global v1 chain; carries `isOwner`, `legacyRole`, `perms` |
| a capability summary needs no new query | ✅ `entryFor(actor, key)` → the four reach flags |
| team NAMES available cheaply | ⚠️ **not** from the actor (space **ids** only) → **D11**: `SpacesRepo.listByWorkspace` (already scope-filtered) ∩ `UserRolesRepo.spaceIdsForUser`; explicitly NOT `TeamMembershipService.directory()`, which is the whole unscoped org chart |
| denials can carry a real message + code | ✅ `denyMessage` + `permissionErrorCode` + reasons `no_grant / out_of_scope / not_own` |
| `member.view` is the right gate for the P4 people tool | ✅ `routes/teams.ts` gates `GET /teams` on exactly that — mirror the HTTP surface, don't invent a rule |
| G7 is real | ✅ `UsersRepo` imports no scope filter at all — the directory is an existence oracle on the tool path |

Three decisions were **added** because the verification asked questions the plan had left
implicit: **D9** the CONTROLLER builds the caller block (`buildMessages` has no request context)
and stays pure; **D10** the block is never persisted into chat history, so a permission change
takes effect on the next question; **D11** as above.

### Shipped
`systemPrompt.ts` — a **P2 SPEC comment block** (caller-block format + sources + hard limits +
privacy rule; the denial payload shape; the anti-enumeration split between a category denial and
an ambiguous object miss). It sits OUTSIDE the template literal: re-measured at **38,272 chars —
zero wire cost, zero behaviour change**. Plan file: decisions 🔒 locked, D9–D11 added, §5
execution record.

### 🐞 DEFECT-1 — the bot mirrors Banglish (handed to P1)
The gate's Bangla metric failed 2-of-3 runs, always on *"ekjon ke shudhu Marketing space er
access dite chai, kivabe?"*. The metric was suspected first (five prior wrong-measuring-stick
incidents) — so the answer was read instead of guessed at, and the metric was RIGHT: **3 Bengali
letters vs 329 Latin, ratio 0.009**, a fully romanized reply. Re-measured: that question flips
**2 of 3 times** (0, 0.733, 0) while other Banglish questions hold (0.677 / 0.790 / 0.985) — so
it is question-specific and reproducible, not temperature noise. The prompt says "reply in
Bangla" but never *Bangla SCRIPT, never romanized*, and **this office writes Banglish**, so a
large share of real questions arrive romanized. Also flagged for the P1 audit: the same answer's
*"See spaces" / "Their spaces"* claim looks like a fabrication. **Deliberately NOT fixed here** —
a prompt rule is behaviour, and behaviour belongs to P1.

**Verdict: Deep P0 COMPLETE. Ready for "AI deep phase 1 koren" — which starts with DEFECT-1.**

---

## Deep P1 — the nirbhul audit — ✅ COMPLETE (2026-08-13)

Ask #1 was *"chatbot jeno obosshoi amar system niye nirvul information dey"*. So every claim in
the knowledge base was re-checked against the code that implements it. **Nine were wrong** — and
the bot had been answering all nine confidently.

### The audit table

| # | KB claim | verdict | evidence | fix |
|---|---|---|---|---|
| 1 | *"A Guest is NOT read-only… can create, edit, archive and delete tasks; the only thing they lack is attachment upload"* | ❌ **WRONG, and it described a fixed security hole** | `rbac/bootstrap.ts` — `GUEST_GRANTS` is **7 keys**: view spaces/tasks/members/activity, comment, assistant.use, bug.report. F28/D12.1 cut it from 19 *because* a guest could delete any task and read every public-form submission | rewritten to the real 7; the old sentence is now pinned as forbidden |
| 2 | *Statuses — "manage the workflow statuses of a List and reorder them"* | ❌ WRONG | `StatusesSettings.tsx` has exactly one mutation: `reorder`. Its own comment says "read-only summary today" | "see and reorder; creating/renaming/deleting is NOT available yet" |
| 3 | *Import / Export — "bring data in, or take it out"* | ❌ WRONG on **both** halves | every importer answers `"… importer — coming soon"`; the export button only fires a toast: *"file would download here"* | "not working yet — never tell anyone to move real data with it" |
| 4 | *Templates — "apply them to a List to create tasks quickly"* | ❌ WRONG | `POST /templates/:id/apply` exists in `http/api.ts` with **no caller anywhere**; the Templates page's own subtitle advertises an "Apply template" button that no page renders | "create and edit templates; the Apply button is not in the app yet" |
| 5 | *Team access — "Since the team-access update the workspace is TEAM-SCOPED"* | ❌ WRONG **for the office reading it** | upgrades **019/020 are deliberately held** pending the operator's flip, so on the live system nothing is scoped yet — the bot was quoting rules that do not bite | rewritten as the **two modes** it really has, with "never assert which mode someone is in" + how to tell from the Sidebar |
| 6 | *"giving someone a role inside only one Space cannot be done from Settings yet"* | ❌ half WRONG, and **self-contradictory** | the team-access Teams page grants exactly that (space-scoped seeded Member role) while two other KB sections described it. The half that is still true: `rbacApi.assignRole` has no caller, so no UI gives ONE person a CUSTOM role | rewritten as the real two steps; the still-true half kept |
| 7 | *"Notifications refresh about once a minute, not instantly"* | ❌ stale (pre-SSE) and contradicted line 111 of the same file | SSE live inbox shipped 2026-08-08 | removed |
| 8 | *Checklists — "items you can tick off; shows progress"* | ⚠️ incomplete | rename-by-click on names AND item text, item delete, done/total + % on the task and its card (upgrade 022) shipped | expanded |
| 9 | Invite email | ⚠️ incomplete | the sender/subject changed to the inviter's name (Gmail Promotions fix) | tell people to search the inviter's name and check Promotions/Spam |

**Verified as already CORRECT** (checked, not assumed, so nobody re-audits them): the 5 default
statuses and their names · the 7 task types · `/sla` open to everyone (no `requirePermission` on
the GET) · Reviewer really is a task property (`InlineReviewerEdit`) · Search really covers People
(`SearchRepo.searchUsers`) · recurrence still has no spawn job (`src/jobs/` has 9 jobs, none) ·
the "View only" notice really exists (`TaskDetailDrawer` line 368) · Report-a-Bug really is open
to everyone (`bug.report` is in both EVERYONE and GUEST_GRANTS).

### DEFECT-1 (the Banglish mirroring) — fixed and measured

The LANGUAGE rule said "reply in Bangla" and never said **script**. Added: *write Bangla in the
BENGALI SCRIPT, never Roman letters*, with the failing answer shown as the wrong-vs-right example.

| | before | after |
|---|---|---|
| the failing question, Bengali-letter ratio | **0 · 0.733 · 0** (2 of 3 runs romanized) | **0.736 · 0.782 · 0.749 · 0.729 · 0.770 · 0.654** — 6 of 6 correct |
| eval "answers in Bangla" | 14/15, failing 2 of 3 gate runs | **15/15 in 5 consecutive runs** |

### A second live defect, found by probing the fix

With the script fixed, the same question's *content* was still wrong: the bot invented a UI —
*"Members → the row → **Edit** → a **Teams** section"* — none of which exists, and linked
`/settings/members` instead of `/settings/teams`. Root cause: fix #6 above (the KB contradicted
itself), plus no quick-answer matching how people actually phrase it. Added an explicit quick
answer + "⚠️ never send someone to Members to change a team", and re-probed: both phrasings now
give the real steps. A third probe then caught the bot saying *"type Rakib's email address"* —
`TeamsSettings` uses a **person dropdown**, not an email box — so that was pinned down too.

### Verified
`jest.assistant` **9 suites / 155 tests** ✅ (was 145: +10 pins, and **two OLD pins had to be
reversed** — the Guest one and the per-space-role one, each with the reason written into the
test, because both were true when written and silently went false) · server `tsc` + build clean ✅
· system message **42,907** chars, ceiling raised 39k → **44k** with the decision recorded in the
budget test (paid for partly by deleting the "brand-new empty workspace" walkthrough) ·
eval gate **PERFECT ×3 consecutively**, and better than the P0 baseline on two axes:

| metric | P0 baseline | after P1 |
|---|---|---|
| answers with a clickable route | 13–14/15 | **15/15** |
| answers in Bangla | 14/15 (failed 2 of 3 runs) | **15/15 every run** |

### Product gaps this audit uncovered (NOT fixed — they are product work, not KB work)
1. **Statuses cannot be created/renamed/deleted** from Settings — only reordered.
2. **Import/Export is a mockup** — importers say "coming soon"; the export button downloads nothing.
3. **"Apply template" has no button** — the API exists, the Templates page advertises the button, no page renders it.
4. **No UI assigns a custom role to a person** (`rbacApi.assignRole` has no caller).

**Verdict: Deep P1 COMPLETE — the knowledge base now matches the system that exists, and the bot
writes Bangla in Bangla. Ready for "AI deep phase 2 koren" (caller context + honest denials).**
