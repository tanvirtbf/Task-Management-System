# 🤖 AI Assistant — "make it perfect" plan (phase-wise)

**Date:** 2026-07-28 · **Status:** PLAN (nothing built) · **Evidence:** `AI_ASSISTANT_SCAN_2026-07-28.md`

**Goal, in the owner's words:** *"chatbot er main purpose hocche system jodi keu na bujhe bujhaiya
dibe use korar jonno"* — so every gap is judged by one question: **can a confused, non-technical
person be taught to use this system by the bot alone?**

**Protocol:** you say **"AI phase N koren"** → only that phase is built → tested → verified →
logged to `AI_ASSISTANT_BUILD_LOG.md`. One phase at a time. Same workflow as the RBAC and
Dept-Review builds.

---

# PART 1 — THE MEASURED BASELINE

Not opinions. Every number below was measured against the running dev stack on 2026-07-28.

## 1.1 The first-timer test (15 questions a beginner actually asks)

| | today | verdict |
|---|---|---|
| Step-by-step explanation | **12/15** | good |
| Answered in Bangla | **15/15** | good |
| Substantive (>150 chars) | **14/15** | good |
| **Handed over a clickable route** | **3/15** | ❌ **this is the failure** |

**It teaches, but it does not take you there.** 12 answers say "open it from the Sidebar" — the
one instruction a person who does not understand the system cannot act on.

## 1.2 The confirmed defects

| # | Defect | Evidence | Severity *for this purpose* |
|---|---|---|---|
| **D1** | **Links missing from 12/15 answers.** KB holds **11 markdown links across only 2 of its 18 sections** (Quick answers 7, Dept review 4). Routes exist in the KB but as plain text (`**Inbox** — /inbox`) and the how-to prose carries none. | link count per section | 🔴 critical |
| **D2** | **KB predates RBAC.** Zero occurrences of `/settings/roles`. Asked "give someone access to one department only", the bot confidently sends the user to **Settings → Members**, which cannot do it. | live probe | 🔴 critical |
| **D3** | **Five factual errors in the KB.** (a) "Owner … can delete the workspace" — no such endpoint; (b) "Guest — mostly read-only" — Guest holds **19** permissions incl. create/edit/delete; (c) Settings lists 8 sections, the live nav has **10**; (d) "Most setup needs Admin or Owner" — now permission-based; (e) "Spaces/Lists/tasks do NOT have fixed addresses" — they do (`/s/:id`, `/t/:id`). | file read vs live app | 🔴 critical |
| **D4** | **Tool round-trip discarded.** `AssistantService.streamReply` returns early when `contentStreamed` is true, so any tool call emitted alongside a preamble is thrown away. Measured: 4 of 5 data questions returned no number at all. | live probe vs `/home/kpis` | 🟡 medium *(a convenience, not teaching)* |
| **D5** | **KB freshness guard is blind.** All 20 assertions in `kb-coverage.test.ts` are about Dept-Review; it passed green while the KB went stale about RBAC. A point-in-time content assertion cannot catch the *next* drift. | test read | 🟠 high |
| **D6** | **`assistant.use` gates nothing.** The permission is in the catalog and granted to all four roles, but no route checks it — violating the catalog's own invariant that every key maps to a real enforcement point. | grep: 0 non-catalog hits | 🟠 high |
| **D7** | **Widget gates on the legacy role.** `AssistantWidget.tsx:122` uses `user.role === "owner"\|"admin"`; 6 `role ===` checks, no `usePermissions()`. A custom-role holder never sees the Dept starter question. | file read | 🟢 low |
| **D8** | **L12 scoping has no end-to-end proof.** The tools DO inherit RBAC visibility (verified: `SearchRepo`/`HomeRepo` filtered, and the async context survives the OpenAI stream), but nothing tests it. | code + ALS probe | 🟠 high |
| **D9** | **The JSON (non-streaming) chat path has no tools.** `chat()` → `ask()` without tools; only `chatStream` wires them. Invisible today (the client always streams) but the contract is quietly weaker. | file read | 🟢 low |
| **D10** | **No RBAC starter question**, and the 8 existing ones were curated before the feature existed. | `suggestions.ts` | 🟢 low |

## 1.3 What is already good — do not touch

SSE streaming · 401→refresh→retry · 20/min per-user limit · clean 503 without an API key ·
upstream errors never leaked · identity injected from the JWT (the model cannot reach another
user/workspace) · **no fabricated routes** (hallucination probe: clean) · **multi-turn memory
works** · error banner + Retry · in-app `mdLink` navigation without reload · a11y focus handling ·
`jest.assistant` 4 suites / 52 tests green.

---

# PART 2 — WHAT "PERFECT" MEANS (the pass/fail contract)

Measurable, so the gate phase is not a judgement call. Re-running the 15-question first-timer eval
must produce:

| metric | today | target |
|---|---|---|
| answers with a clickable in-app route | 3/15 | **≥ 14/15** |
| answers with step-by-step instructions | 12/15 | **≥ 14/15** |
| answers in Bangla | 15/15 | **15/15** |
| factually wrong statements | 5 known | **0** |
| static client routes the KB knows | partial | **100%, guarded by a test** |
| data questions that return a real number | 1/5 | **≥ 9/10** |
| fabricated routes | 0 | **0** |

The one allowed miss is a question with no page to point at (e.g. "does it work on mobile?").

---

# PART 3 — DECISIONS (locked defaults — say so at P0 to change any)

- **D-1 · KB stays in the system prompt** (no RAG). It is 18 KB today; the link work adds ~1 KB.
  Below ~30 KB the cost is not worth the complexity of retrieval.
- **D-2 · Every how-to answer ends with a route + what to do on arrival.** Enforced in BOTH places:
  the KB carries the links, and the system prompt makes it a rule.
- **D-3 · Only STATIC routes are ever emitted.** Spaces / lists / tasks have addresses but the bot
  cannot know the ids, so it keeps directing people through the Sidebar — the current instruction
  is right, only its wording ("do NOT have fixed addresses") is wrong and gets corrected.
- **D-4 · The freshness guard becomes STRUCTURAL** — a test that reads the router and fails when a
  static route is missing from the KB. Point-in-time assertions stay as well; they encode real facts.
- **D-5 · `assistant.use` gets enforced** on the assistant routes. All four seeded roles hold it, so
  this changes nothing today (same "dormant until configured" rule as the rest of RBAC).
- **D-6 · The live eval script is a committed GATE, not a CI test.** It calls the real model and
  costs money; it runs when a phase says so, exactly like the P5 verify script.
- **D-7 · Bangla-always stays.** UI chrome stays as it is.
- **D-8 · No new dependencies, no architecture change.** Every defect here is content, one
  condition, one middleware, and tests.

---

# PART 4 — LANDMINES (each assigned a phase)

| # | Landmine | Defused in |
|---|---|---|
| **L1** | The KB is a TS template literal — **a backtick or `${` inside the content breaks the build**. Adding ~60 markdown links is safe; a code sample is not. | P2–P4 (the existing string-safety test already guards it) |
| **L2** | The KB ships on **every** request. Careless expansion raises latency and cost for every message. Budget: keep the total system message under ~30 KB. | P4 (measure before/after) |
| **L3** | `kb-coverage.test.ts`'s 20 existing assertions encode real facts. A rewrite that breaks them is a regression, not a cleanup. | P2–P5 (they must stay green) |
| **L4** | A route-parity guard that demands **dynamic** routes (`/s/:spaceId`, `/t/:id`) would force the bot to invent ids — the exact behaviour D-3 forbids. The guard must cover static routes only. | P5 |
| **L5** | Enforcing `assistant.use` on a workspace whose admin already tightened a custom role would silently kill the widget for those users. | P6 (403 must surface as the widget's "unavailable" state, not a dead panel) |
| **L6** | Changing the `streamReply` early-return also affects the **no-tool** path; 52 existing tests cover it. | P1 |
| **L7** | The widget must not flash Dept suggestions before permissions load (`ready === false`). | P7 |
| **L8** | Bangla content must never be echoed to the user's terminal — verification scripts print ASCII verdicts only. | all phases (established pattern) |

---

# PART 5 — PHASES

12 phases (P0–P11). Each is small, independently testable, and ends deployable.

### P0 · Baseline & decisions — *no product change*
Confirm the green line (`jest.assistant` 52, client vitest 40, both dev servers), lock D-1…D-8,
create the build-log section, and **record the 15-question baseline as the pass/fail contract**
(3/15 links · 12/15 steps · 15/15 Bangla). Commit the eval script as
`server/scripts/assistant-eval.cjs` so every later phase measures the same way.

### P1 · D4 — fix the tool round-trip *(server, small, high value)*
`streamReply`: a round that produced tool calls must always execute them. Push the streamed
preamble as the assistant turn's content **alongside** `tool_calls`, run the tools, let the next
round answer. Early return becomes `toolCalls.length === 0 || !opts.tools`.
**Tests:** a fake stream that emits content *and* a tool call → the tool executes and the final
answer contains the tool's data; the no-tool path is unchanged (52 existing tests stay green).

### P2 · D3 — delete every false statement from the KB
The five factual errors, fixed at source: no "delete the workspace"; Guest described by what it
actually holds; the Settings list matched to the live 10-item nav; "Admin or Owner" replaced with
the permission-based reality; the address wording corrected to "you cannot link to a specific
Space/List/task — open them from the Sidebar" (true, and keeps the no-guessing rule).
**Tests:** new assertions in `kb-coverage.test.ts` for each — worded so they fail if the claim ever
returns.

### P3 · D2 — teach the bot the RBAC feature
A new **"Roles and permissions"** section written for the dynamic model: what a role is, the
permission grid at `[Roles & permissions](/settings/roles)`, the three scopes (Everywhere / Their
spaces / Own items) in plain language, assigning a role **inside one space**, "holding a role in a
space is what makes you a member of it", the Owner role being uneditable, and what a "you don't
have permission" message means and who to ask. Plus the Quick-answers entries for the two questions
that failed live: *"give someone access to one department only"* and *"create a new role"*.
**Tests:** KB assertions + a live probe that those two questions now return `/settings/roles`.

### P4 · D1 — the link layer *(the phase that fixes the actual purpose)*
Rewrite all 18 KB sections so **every destination is a markdown link to its real route**, and every
how-to reads *"go to [X](/x) → then 1-2-3 on that page"*. The address block becomes links rather
than plain text. Sections in order: About · Core structure · Navigation · Page addresses · Getting
started · Working with tasks · Task details · Assigning · Inbox · Search · Forms · Engineering ·
Dept review · Settings · Roles · Account · Quick answers · Good to know.
**Guard:** measure the system-message size before/after (L2).
**Tests:** a KB assertion that every static route appears **as a link**, not just as text.

### P5 · D5 — make the freshness guard structural
A test that reads the static route table out of `client/src/router.tsx` and asserts each one appears
in the KB — so a NEW page cannot ship without the bot learning it. Dynamic routes excluded (L4).
Keep all 20 existing assertions.

### P6 · D6 — enforce `assistant.use`
`requirePermission("assistant.use")` on the assistant routes. No behaviour change today (all four
seeded roles hold it). The widget must render its "assistant unavailable" state on a 403 rather
than a dead panel (L5).
**Tests:** a user without the permission gets 403; a seeded member is unaffected.

### P7 · D7 + D10 — the widget
Swap the six `user.role ===` checks for `usePermissions()`; gate the Dept starter question on
`review.read`/`report.view` instead of the role string; do not render gated suggestions until
`ready`. Add the RBAC starter question ("kivabe kauke shudhu ekta department er access debo?").
**Tests:** client vitest for `pickSuggestions` + the permission gate.

### P8 · D8 — prove the tools are scoped (L12's remaining half)
An end-to-end test: a user scoped to one space asks the bot to search for something in another
department and gets nothing; an unrestricted user gets it. Uses the existing `jest.assistant`
OpenAI fake plus the RBAC test kit.

### P9 · D9 + polish
Wire tools into the JSON path too (or document the difference and make the JSON route reject
data-questions cleanly — decide at P0). Sweep the system prompt for the "always give a route" rule
so it holds even for questions the KB does not cover verbatim.

### P10 · Full verification
Re-run the 15-question first-timer eval and assert the Part-2 thresholds; re-run the data-tool
probe (≥9/10); `jest.assistant`; client vitest; `e2e/assistant.pw.ts` against the live model; a
browser pass of the widget (open → suggestion → answer → link click navigates in-app → error →
retry).

### P11 · Ship gate
`AI_ASSISTANT_BUILD_LOG.md` entries for every phase · update `AI_ASSISTANT_SCAN_2026-07-28.md` with
the closed items · memory update · a short Bangla note for the team on what the bot can now do ·
zero-open triage.

---

# PART 6 — TEST STRATEGY

1. **The 15-question eval is the contract** (P0 records it, P10 asserts it). Content work is
   graded by outcome, not by how much text was written.
2. **Deterministic KB tests** (`kb-coverage.test.ts`) for every factual claim — cheap, no model.
3. **The structural route-parity guard** (P5) is what stops the *next* drift; it is the single most
   valuable artifact of this plan.
4. **Live-model checks** stay manual gates (D-6): the eval script and `assistant.pw.ts`.
5. **Regression:** `jest.assistant` must stay green at every phase; the 52 existing tests already
   cover transport, degradation and string-safety.

---

# PART 7 — FILE MAP

**Server — changed:** `src/assistant/knowledgeBase.ts` (P2–P4, the bulk) · `src/assistant/systemPrompt.ts` (P4, P9) ·
`src/services/AssistantService.ts` (P1) · `src/routes/assistant.ts` (P6) · `src/controllers/AssistantController.ts` (P9)
**Server — new:** `scripts/assistant-eval.cjs` (P0) · `tests/assistant/route-parity.test.ts` (P5) ·
`tests/assistant/tool-roundtrip.test.ts` (P1) · `tests/assistant/scoping.test.ts` (P8)
**Client — changed:** `components/assistant/AssistantWidget.tsx` (P6, P7) · `components/assistant/suggestions.ts` (P7)
**Client — new tests:** `components/assistant/suggestions.test.ts` additions (P7)
**Docs:** `AI_ASSISTANT_BUILD_LOG.md` · `AI_ASSISTANT_SCAN_2026-07-28.md` · this file

---

# PART 8 — SIZE & SEQUENCING NOTES

- **Biggest phase by far: P4** (18 KB sections rewritten with links). Everything else is small.
- **Highest value per line changed: P1** (one condition) and **P5** (the structural guard).
- **P2 → P3 → P4 must run in order** — they all edit the same file, and P4 assumes P2/P3's content
  is already correct.
- **Deployable at every phase.** Nothing here is half-enforced: content fixes are additive, the
  `streamReply` fix is strictly better, and `assistant.use` is dormant until an admin tightens it.
- **P1 alone makes the data tools reliable; P2–P4 alone make the bot a competent teacher.** If time
  is short, P1–P5 is the set that changes the user's experience.

---

*Compiled 2026-07-28 from a live scan of the running system: full source read, `jest.assistant`
run, 28 real questions asked of the live bot, per-section KB link counts, and an
AsyncLocalStorage propagation probe. Say **"AI phase 0 koren"** to start.*
