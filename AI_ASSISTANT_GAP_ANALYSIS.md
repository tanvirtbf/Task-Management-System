# 🤖 AI Help Assistant — Readiness & Gap Analysis (2026-07-23)

**Purpose of this doc:** the in-app chatbot ("সহায়ক · Help Assistant") is meant to help
**non-technical users** understand and use the system — a first-timer who doesn't know
where to click should be able to ask, and get a friendly, step-by-step, **Bangla** answer
with **working links** ("go here → click this"). This file records: (1) how the bot works
today, (2) the verdict on readiness, (3) every gap found, (4) the concrete updates the
chatbot needs, and (5) the features required to fully meet the owner's requirements.
**No implementation yet — notes only.** Based on a 3-agent deep scan (client widget /
server + knowledge-base / full-system URL surface).

---

## 0. Verdict — is it ready?

**Not yet — the plumbing is solid, but the content and the "guide me" experience are not.**
The chatbot streams, persists, is JWT-scoped/injection-safe, degrades gracefully, is
mobile-responsive, renders Markdown, and already shows 4 Bangla starter chips. But three
things block the stated goal:

1. **🔴 The knowledge base is STALE and has NO links.** The entire Department-Review +
   weekly-HR-Reports feature is invisible to the bot, and the KB contains **zero URLs** —
   it can only name menus, never hand the user a clickable "take me there" link.
2. **🔴 Links don't navigate the app.** Every link the bot emits opens a **new browser tab
   that full-reloads the whole SPA** — the opposite of a smooth in-app guided hop.
3. **🟠 No real first-time onboarding, and the starter questions disappear after the first
   message.** A confused new user has little reason to notice, trust, or re-use the bot.

Everything below is grouped so it can be turned into a phase-wise build later.

---

## 1. How it works today (current state)

### Client — `client/src/components/assistant/AssistantWidget.tsx` (+ `.css`)
- Mounted once in the authed shell (`layouts/AppShell.tsx`), on every signed-in screen; hidden for logged-out users. Floating **Bot** FAB, bottom-right → opens a 390×600 panel (full-screen sheet on mobile ≤520px).
- State/streaming: `stores/chat.ts` + `http/assistant.ts` — SSE streaming (`data:{delta}` … `[DONE]`), 401→refresh→retry, conversation persisted to `localStorage["th-chat"]` (messages + conversationId). Server also persists (below).
- Rendering: **Markdown** via `react-markdown` + `remark-gfm` (bold/lists/headings/code/tables). Links render as `<a target="_blank">`.
- **Starter questions EXIST** (`AssistantWidget.tsx:15-20`): 4 hardcoded Bangla chips (create task / what is Board view / change password / assign task). Shown only in the empty state; clicking sends the text to the bot.
- Bangla-first UI (welcome, placeholder, footer); button tooltips/aria-labels + error text are English.
- Polish present: typing dots, stream cursor, auto-scroll, timestamps, Stop button, "New chat", send-on-Enter, auto-grow textarea, Escape-to-close.

### Server — `server/src/assistant/*` + `services/AssistantService.ts`
- `POST /api/v1/assistant/chat` (SSE or JSON) + `GET /conversations[/:id]`. Model `gpt-4o-mini`, `temperature 0.3`, `max_tokens 800`, 30s timeout. Auth on every route; **20/min/user** rate limit; graceful **503** when `OPENAI_API_KEY` is absent; upstream errors never leaked.
- Prompt = `systemPrompt.ts` + `"# KNOWLEDGE BASE\n"` + `knowledgeBase.ts` (a single ~157-line hand-maintained string — **KB-in-prompt, NOT RAG**). History capped at 12 turns.
- **Tools** (`tools.ts`, read-only, JWT-scoped): `get_my_task_counts`, `get_my_agenda`, `search`. Data-lookup only — no "how-to" knowledge, none cover reviews/reports.
- Persistence: real `chat_conversations` + `chat_messages` tables (best-effort writes).

**Assessment:** the transport/security/persistence layer is production-quality and needs **no
change**. All the gaps are in **content, links, and the guide-me UX**.

---

## 2. Gaps found

### A. Knowledge / content gaps (server `knowledgeBase.ts`) — 🔴 highest impact
- **A1. Department Review + Reports feature is entirely MISSING.** No mention of: Spaces-as-departments, the **Head** role (`head_user_id`), `/dept` review dashboard, approve/flag-with-note, the HR `/reports` inbox, `/reports/:id` detail (Mark seen / Regenerate / head-note), the `task_reviewed` / `report_ready` notifications, or the weekly `department-report` job. A user asking "amar completed task ke approve korbe?", "/dept ki?", "HR report kothay?" gets "I don't know / ask your admin."
- **A2. KB has ZERO URLs.** It navigates only by menu/label names. It cannot give a clickable link, and it doesn't even know the app's URL scheme (`/dept`, `/reports`, `/t/:id`, `/s/:spaceId`, `/inbox`, `/search`, `/settings/*`, `/forms`, `/eng/*`).
- **A3. Sidebar description is stale** — the KB's nav list omits **Department** and **Reports**, two items owners/admins/heads now see. The bot can't even name what's on screen.
- **A4. Smaller staleness:** invite flow described as "not finished yet" (it works — `/invitation/:token`); notification list predates the 2 new types; **no notification-preferences** section (correct — no such UI exists, don't promise one); Home/KPI/agenda not described; roles section omits **Head**.
- **A5. No code↔KB parity safeguard.** KB is hand-edited with no test/checklist tying it to shipped features → it silently drifts every release (root cause of A1–A4).

### B. Client UX gaps (`AssistantWidget.tsx`, `chat.ts`, `http/assistant.ts`)
- **B1. 🔴 Links open a new tab + full SPA reload** (`AssistantWidget.tsx:23-29`, hardcoded `target="_blank"`, no react-router). Breaks the "click here and I'll take you there" experience.
- **B2. 🟠 No first-time onboarding.** No auto-open/nudge/tour/first-run flag; the FAB is a bare icon with an English-only tooltip → poor discoverability for the exact audience it's for.
- **B3. 🟠 Starter questions vanish after the first message and are static.** They render only at `messages.length === 0`; because chats persist, a returning/one-message-in user never sees them again unless they hit "New chat." They're the same 4 everywhere — not the "most-common tasks," not context/page-aware, and clicking only asks the bot (no deep-link).
- **B4. Mid-stream errors are silent.** The component never reads `store.error`; the ⚠️ fallback only fires if *nothing* streamed. A failure after partial text shows a dead half-message with no retry. No "assistant offline/degraded" banner. Error copy is English.
- **B5. Accessibility falls short.** `aria-modal` set but no focus-trap, no focus-restore to the FAB on close, background not `inert`/`aria-hidden`.
- **B6. UI chrome is half-English** (tooltips "New chat"/"Stop generating"/"Send message", aria-labels, error strings) — undercuts the Bangla-first goal.
- **B7. No message-level helpers** — no copy, no 👍/👎 "was this helpful?", no regenerate.

### C. Requirement-specific gaps (the owner's explicit asks)
- **C1. "Instructions with links + what-to-do-inside-the-link."** Today impossible: KB has no URLs (A2) and links don't navigate (B1). Even the *text* rarely pairs a destination with the on-page steps — needs KB answers structured as **"go to `<link>` → then do 1-2-3 here."**
- **C2. "Common questions on open for first-timers."** Partially there (B3) but shallow: too few, disappear, static, no deep-link, and the answers they trigger are limited by the stale KB.
- **C3. "Answer everything in Bangla."** The system prompt currently says *mirror the user's language* (defaults to Bangla) — it does **not** force Bangla. If the requirement is strictly-Bangla, `systemPrompt.ts` must change; and the UI chrome/error strings (B6) must be Bangla too.
- **C4. "Maximum UX."** Blocked by B2/B4/B5/B7 (onboarding, error recovery, a11y, feedback).

### D. System-surface facts the KB rewrite must respect (from the URL scan)
- Task detail is **not its own URL** — it overlays the current page via `?task=<id>`. The only stable "click here" task link is **`/t/<id-or-customId>`** (redirects into the list with the drawer open).
- **Role-gated nav:** `/dept` and `/reports` (and their Sidebar items) show only to **owner/admin or a space head**; members/guests are redirected home. The bot must condition these answers on the asker's role.
- **No `⌘K` command palette** (the `⌘K` hint is cosmetic — it just routes to `/search`) and **no notification-preferences screen** exist. The bot must not instruct users to use either.
- Subtasks / Reviewer / story-points / Git panel show **only on dev-type tasks**; the **Custom Fields** section shows only if the list has custom fields configured.
- Two "form" concepts: `/forms` (build public intake forms) vs. a list's **Form** view tab.

---

## 3. Chatbot updates needed (concrete, mapped to files)

**Content (server):**
1. **Rewrite `knowledgeBase.ts` to be current + link-rich.** Add a full **Department Review / Reports** section; refresh Sidebar/roles/notifications; fix the invite claim; add a **URL table** (every route pattern) and, for each common task, pair the **exact URL with the on-page steps**. (Raw material = Appendix A + B below.)
2. **`systemPrompt.ts`:** (a) instruct the model to emit **Markdown links to app URLs** in every navigational answer; (b) decide Bangla policy — either keep "mirror the user" or enforce **Bangla-always**; (c) tell it to **condition role-gated answers** (Department/Reports/admin-only actions) and to never mention `⌘K` or a notification-preferences page.
3. **(Optional) add "how-to" reach:** consider a tool or KB index that lets the bot map a task-name → the canonical answer, so answers stay consistent. Add a **KB-freshness checklist/test** so this doesn't drift again (A5).

**Client (`AssistantWidget.tsx` + `chat.ts`):**
4. **Make in-app links navigate via react-router** — custom `a` renderer: same-origin/relative href → `useNavigate()` (keep the widget open or briefly highlight the target); external → new tab. (Fixes B1/C1.)
5. **Persistent + richer + context-aware starter questions** — show quick-prompts even after messages exist (e.g. a small "suggestions" toggle or a header menu), expand to the **most-common tasks**, and optionally vary them by current route. Consider a "browse topics" menu for non-typists. (Fixes B3/C2.)
6. **First-time onboarding** — one-time gentle nudge (pulse/badge or a small "নতুন? এখানে জিজ্ঞেস করুন" bubble) and/or auto-open on first login, gated by a `hasSeenAssistant` flag. (Fixes B2/C4.)
7. **Error UX** — subscribe to `store.error`, show a Bangla inline error + **Retry/Regenerate**, and a degraded/offline banner. (Fixes B4.)
8. **Bangla-ize all chrome** (tooltips, aria-labels, error strings) + **accessibility** (focus-trap, focus-restore, inert background). (Fixes B5/B6.)
9. **Message helpers** — copy button, optional 👍/👎 feedback, regenerate. (Fixes B7.)

---

## 4. Features needed to fulfill the requirements

Mapped to the owner's asks (help confused users · high UX · linked step-by-step instructions ·
starter questions on open · Bangla · max UX):

| # | Feature | Fulfills | Where |
|---|---|---|---|
| F1 | **Up-to-date, link-rich KB** (incl. Department/Reports) with per-task "URL + do-this-here" steps | "instructions with links + what to do inside" | `knowledgeBase.ts`, `systemPrompt.ts` |
| F2 | **In-app deep-link navigation** from the bot's answers (react-router, not new-tab) | clickable "take me there" | `AssistantWidget.tsx` link renderer |
| F3 | **Persistent, contextual, most-common starter questions** (don't vanish; role/page aware; more of them; a "topics" browse mode) | "common questions on open for first-timers" | `AssistantWidget.tsx` + a small config |
| F4 | **First-time onboarding nudge** (discoverable FAB, one-time hint / optional auto-open) | high UX for confused first-timers | `AssistantWidget.tsx` + `hasSeen` flag |
| F5 | **Bangla-first answers + Bangla chrome** (prompt policy + localized tooltips/errors) | "answer everything in Bangla" | `systemPrompt.ts`, widget strings |
| F6 | **Robust error/degraded UX** (inline Bangla error, retry, offline banner) | max UX / trust | widget + `chat.ts` |
| F7 | **A11y + message helpers** (focus trap/restore, copy, feedback, regenerate) | max UX, learning what works | widget |
| F8 | **KB-freshness guardrail** (checklist or parity test so the KB tracks new features) | keeps it ready over time | test/process |

**Suggested phase-wise build (for later, matching the owner's phase workflow):**
- **P1 — KB refresh + URL knowledge** (F1) and **prompt policy: links + Bangla + role-gating** (F5 server half). *Biggest correctness win; content-only.*
- **P2 — In-app deep-link navigation** (F2). *Unlocks real "click here."*
- **P3 — Starter questions v2** (F3): persistent, most-common, context-aware, Bangla.
- **P4 — Onboarding nudge + discoverable FAB** (F4).
- **P5 — Error/degraded UX + Bangla chrome + a11y + helpers** (F6/F7).
- **P6 — KB-freshness guardrail** (F8) + a browser UX pass (first-time flow, mobile).

---

## Appendix A — App URL map (source material for the KB's links)

Deep-linkable (paste-able) routes; role notes matter for the bot's conditioning.

| URL | Page | Role |
|---|---|---|
| `/` | Home dashboard | any |
| `/inbox` | Notifications | any |
| `/search?q=…` | Global search | any |
| `/dept?space=…` | Department review dashboard | **owner/admin or space head** |
| `/reports`, `/reports/:reportId` | Weekly HR reports list + detail | **owner/admin or head** |
| `/s/:spaceId` | Space overview (+ dept-head card) | space visibility |
| `/s/:spaceId/l/:listId[/:viewId]` | List (viewId = board \| calendar \| form) | space visibility |
| `/t/:taskKey` | **Task deep-link** (id or customId → opens drawer) | space visibility |
| `/forms`, `/forms/:formId/edit` | Forms manager + builder | any authed |
| `/forms/:slug` | **Public** intake form (no login) | public |
| `/eng`, `/eng/sprint`, `/eng/on-call` | Engineering home / sprint board / on-call | any authed |
| `/settings/{profile,workspace,members,task-types,tags,statuses,custom-fields,templates,import-export}` | Settings pages | view any; mutations admin/owner |
| `/login`, `/forgot-password`, `/reset-password/:token`, `/invitation/:token` | Auth/guest flows | guest |

## Appendix B — Most-common tasks → the "click here + do this" the KB should teach

Each answer should read: **"যান `<link>` → তারপর এখানে ১-২-৩।"** (Go to link → then 1-2-3 here.)

1. **নতুন task বানানো** — Topbar `+` → "New Task" (full), or on a list page `+ Add task` (quick). Link: the list `/s/:spaceId/l/:listId`.
2. **Task assign করা** — খুলুন task (`/t/:id`) → drawer-এ Assignees → search → click. 
3. **Status / priority / due date সেট** — task drawer → Status/Priority/Due controls (or drag between columns in Board).
4. **Comment / checklist / attachment** — task drawer → Comments (Ctrl+Enter) / Checklists ("Add checklist") / Attachments ("Upload" or drag).
5. **View বদলানো (List/Board/Calendar)** — list page-এর view tabs; URLs `…/l/:listId`, `…/board`, `…/calendar`.
6. **Space / List বানানো** — Sidebar "Spaces" `+` (space) / space row `+` (list), or Topbar `+` → New List.
7. **Search করা** — Sidebar/Topbar Search → `/search` → type → filter chips.
8. **Inbox দেখা / notification-এ action** — `/inbox` → filter → click row (deep-links), snooze/archive.
9. **Password বদলানো** — `/settings/profile` → "Change password".
10. **Member invite** — `/settings/members` → "Invite member" (admin/owner).
11. **(Engineering) bug report** — Sidebar "Report a bug" → modal → Submit.
12. **(Engineering) on-call assign** — `/eng/on-call` → week row → pick engineer.
13. **(Dept) Head assign** — `/s/:spaceId` → "Department head" card (owner/admin).
14. **(Dept, as Head) task review** — `/dept` → queue → Approve / Flag-with-note (or in-task "Department review" section once done).
15. **(HR/admin) weekly report দেখা + Mark seen** — `/reports` → week card → `/reports/:id` → "Mark seen".

## Appendix C — Recommended starter-question set (Bangla, click → linked instruction)

Replace the current 4 with a broader, most-common set (persistent, ideally role/page-aware):
- "কীভাবে একটা নতুন task বানাবো?"
- "কাউকে task assign করব কীভাবে?"
- "Board / Calendar view কীভাবে দেখব?"
- "কীভাবে comment বা checklist যোগ করব?"
- "আমার আজকের কাজ / কী কী due আছে?" *(can use the live `get_my_agenda` tool)*
- "Search কীভাবে করব?"
- "পাসওয়ার্ড কীভাবে বদলাবো?"
- *(head/admin only)* "Department review / weekly report কোথায়?"

---

*Compiled 2026-07-23 from a 3-agent scan (client widget · server + KB · full URL surface).
Next step when you're ready: say the word and I'll turn §4/§3 into a phase-wise build plan
(like the Dept-Review one) — one phase at a time. No changes made yet.*

---

## ✅ RESOLUTION — all gaps closed (2026-07-23)

Built phase-wise per `AI_ASSISTANT_UPGRADE_PLAN.md`; log = `AI_ASSISTANT_BUILD_LOG.md`.

| Gap | Closed by |
|---|---|
| **A1** Dept Review/Reports absent from KB | P2 (full KB section) |
| **A2** KB has no URLs | P3 (URL reference block + linked answers) |
| **A3** stale Sidebar list | P1 |
| **A4** stale notifications / invite / no Home | P1 |
| **A5** no KB-freshness safeguard | P12 (`kb-coverage.test.ts` + manifest net + maintenance checklist) |
| **B1 / C1 / F2** links open new-tab + full reload | P6 (react-router in-app nav; unsafe→plain text) |
| **B2 / C4 / F4** no onboarding / undiscoverable FAB | P8 (one-time nudge + pulse + Bangla FAB title) |
| **B3 / C2 / F3** starter Qs vanish + static | P7 (curated, persistent mid-chat, role-aware) |
| **B4 / F6** silent errors | P9 (Bangla error banner + Retry/Regenerate) |
| **B5 / F7** a11y (trap/restore/inert) | P10 (viewport-correct: mobile trap + aria-modal, focus-restore; inert deliberately N/A for the non-modal desktop + link-nav design) |
| **B6 / C3 / F5** English chrome, mirror-language | P4 (Bangla-always prompt) + P10 (Bangla tooltips) |
| **B7 / F7** no copy/feedback | P11 (per-answer Copy) |
| **C1 / F1** link + on-page steps | P3 (KB) + P4 (prompt emits links) |

Verified: server `jest.assistant` **52 tests**, client `vitest` **32 tests**, **7/7 committed
Playwright e2e** with live gpt-4o-mini, and the P5 real-key content pass (**9/9**). Bot answers
are Bangla, link-rich, role-aware, error-recoverable, discoverable, and up to date.
