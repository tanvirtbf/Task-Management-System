# 🤖 AI Assistant — post-RBAC scan (2026-07-28)

> ## ✅ ALL TEN DEFECTS CLOSED — 2026-07-28
> This scan was turned into `AI_ASSISTANT_PERFECT_PLAN.md` and executed as phases P0–P11
> (log: `AI_ASSISTANT_BUILD_LOG.md`). Every defect below is fixed; the numbers that mattered
> moved from **links 3/15, data 2/10** to **links 14–15/15, data 9–10/10**.
>
> | # | defect | closed in | evidence |
> |---|---|---|---|
> | **D1** | links missing from 12/15 answers | **P4** | KB 17→83 links **+** a system-prompt rule; 3/15 → 14–15/15 |
> | **D2** | KB predates RBAC | **P3** | `/settings/roles`, the 3 scopes, per-space assignment, and its honest limit |
> | **D3** | five factual errors | **P2** | audit found **seven**; each removed and pinned by a test |
> | **D4** | tool round-trip discarded | **P1 + P10** | the latent `contentStreamed` bug fixed and tested; then the *real* live failure — the model reading the wrong field — fixed by naming the scope inside each key |
> | **D5** | KB freshness guard blind | **P5** | `route-parity.test.ts` reads `router.tsx`; verified by breaking it both ways |
> | **D6** | `assistant.use` gated nothing | **P6** | `requirePermission` on all three routes; 9 tests |
> | **D7** | widget on the legacy role | **P7** | `usePermissions()`; the head-of-space rule deliberately kept |
> | **D8** | L12 scoping untested | **P8** | 5 end-to-end tests; verified by removing the filter (2 failed) |
> | **D9** | JSON path had no tools | **P9** | one shared tool loop for both transports |
> | **D10** | no RBAC starter question | **P7** | shown only to `role.manage` holders |
>
> **Still open — by design, and the bot now says so itself:** giving one person a role inside a
> single Space (and assigning custom roles) has no UI yet — that is RBAC plan P24/P27, not an
> assistant gap. The knowledge base states this limitation plainly rather than inventing a recipe.
>
> The original scan is preserved below, unedited, as the record of what was found.

---


**Why now:** the chatbot was last upgraded on 2026-07-23 (`AI_ASSISTANT_BUILD_LOG.md`, P0–P13).
Since then the **dynamic RBAC** feature shipped, which touches the assistant twice: its data tools
read through repositories that are now visibility-filtered (plan landmine **L12**), and its
knowledge base describes a permission model that no longer exists.

**Method:** read the whole surface (server `src/assistant/*` + `AssistantService` + controller +
route; client widget + chat store + suggestions), ran `jest.assistant`, then **drove the live bot
against the running dev stack** with 13 real questions and measured the answers. Replies are
Bangla and are never echoed to a terminal — every check below is an ASCII verdict from
`scratchpad/assistant-scan.cjs`.

---

## Verdict

The **plumbing is healthy**; two things are materially wrong. One is a real bug that makes the
live-data features fail most of the time, and one is content drift that makes the bot confidently
wrong about the newest feature in the product.

| | |
|---|---|
| 🔴 **C1** | Live-data tools are silently dropped ~2 times in 3 |
| 🔴 **C2** | The knowledge base predates RBAC — the bot mis-answers the flagship new feature |
| 🟠 **H1** | The KB freshness guard did not catch C2 (it only knows the *previous* feature) |
| 🟠 **H2** | The widget still gates its suggestions on the legacy `user.role` string |
| 🟢 **L12** | Assistant data-leak risk: **largely closed** by the RBAC work — verified, not assumed |

---

## 🔴 C1 — the tool round-trip is discarded when the model also streams text

`server/src/services/AssistantService.ts`, in `streamReply`:

```ts
const toolCalls = Object.values(acc).filter((t) => t.name);
// Answered with content, no tool calls, or tools disabled → done.
if (contentStreamed || toolCalls.length === 0 || !opts.tools) return;
```

If the model emits **any** content delta in the same round as a tool call, `contentStreamed` is
true and the function returns — **the tool calls are thrown away and never executed**. `gpt-4o-mini`
under a "always answer in Bangla" system prompt very often opens with a short sentence before
calling a tool, so this fires constantly.

**Measured on the live stack** (ground truth from `/home/kpis`: my=2, due=0, overdue=2, team=34):

| question | reply length | digits returned | correct? |
|---|---|---|---|
| "amar koyta open task ache? sonkha bolo." | 31 chars | — | ❌ no number at all |
| "how many open tasks do I have right now?" | 36 chars | — | ❌ no number at all |
| "team er koto gulo open task ache?" | 42 chars | **34** | ✅ |
| "amar koyta task overdue ache?" | 67 chars | — | ❌ |
| "'Allergic reaction' naame kono task ache?" (task EXISTS) | 213 chars | — | ❌ not found |

So `get_my_task_counts`, `get_my_agenda` and `search` — the entire "data-aware" half of the
assistant — work only when the model happens to emit a bare tool call. The user sees a one-line
non-answer the rest of the time, with no error to explain it.

**Fix direction:** a round that produced tool calls must always execute them. Keep the streamed
preamble (push it as the assistant turn's content alongside `tool_calls`), run the tools, and let
the next round answer. The early return should be `toolCalls.length === 0 || !opts.tools`.

---

## 🔴 C2 — the knowledge base predates RBAC

`server/src/assistant/knowledgeBase.ts` has **zero** occurrences of `Roles & permissions`,
`/settings/roles`, or `space.view`. Live probes:

| asked | what the bot answered | correct? |
|---|---|---|
| "ekjon ke shudhu Marketing space er access dite chai" | points to **Settings → Members**, "Admin/Owner" | ❌ that page cannot do per-space access |
| "notun custom role banate chai, kothay jabo?" | mentions Admin/Owner, **no page at all** | ❌ |
| "shudhu nijer task edit korar permission dite chai" | says "own", no page | ⚠️ half |
| "password kivabe change korbo?" *(baseline)* | links **`/settings/profile`** | ✅ |

The baseline proves link emission and Bangla output still work perfectly — the bot is not broken,
it simply has not been told the feature exists.

**Also now factually wrong in the KB:**
1. *"Owner — … can do everything, **including deleting the workspace**."* There is no
   delete-workspace endpoint; the permission catalog deliberately omits `workspace.delete` for
   exactly this reason. The bot will confidently promise an action that cannot be performed.
2. *"Guest — limited, mostly **read-only** access."* The seeded Guest role holds **19**
   permissions including create / edit / delete task and comment. Read-only is wrong.
3. The Settings list names 8 sections; the live nav has **10** (missing **Roles & permissions**,
   and every entry is now permission-gated rather than "Admin/Owner").
4. *"Most setup and management actions need Admin or Owner"* — now configurable per role.
5. *"Your Spaces, Lists and individual tasks do NOT have fixed addresses"* — they do
   (`/s/:spaceId`, `/s/:spaceId/l/:listId`, `/t/:id`). The **intent** is right (never guess an id);
   the wording is false and undercuts the bot's credibility if a user notices the URL bar.

**Missing entirely:** custom roles · the permission grid · the three scopes (Everywhere / Their
spaces / Own items) · assigning a role inside one space · "holding a role in a space = membership
of it" · the Owner-cannot-be-edited rule · what a 403 means and who to ask.

---

## 🟠 H1 — the freshness guard has the same blind spot it was built to fix

`server/tests/assistant/kb-coverage.test.ts` (20 assertions) is entirely about **Dept Review** —
"no Ctrl+K", "lists Department and Reports", "explains the Head", "references /dept and /reports".
It passed the whole time the KB was going stale about RBAC, because a point-in-time content
assertion can only test the feature that existed when it was written.

That is not a flaw in the assertions; it is a flaw in the *shape* of the guard. Something
structural is needed — e.g. a test that asserts every top-level client route in `router.tsx`
appears in the KB's page-address block, so a NEW page cannot ship without the bot learning it.

---

## 🟠 H2 — the widget gates its suggestions on the legacy role

`client/src/components/assistant/AssistantWidget.tsx:122`:

```ts
const isAdmin = user.role === "owner" || user.role === "admin";
```

Six `role ===` string checks remain, and the file does not import `usePermissions()`. Post-RBAC
this is wrong in both directions: someone holding `review.read` through a **custom** role never
sees the Department starter question, and someone whose Admin role was tightened still does. This
is the same P29/P30 gating pass that is still open for the rest of the client.

---

## 🟢 L12 — the assistant leaking data across permission boundaries

The plan flagged this as a landmine ("its `search` / `get_my_task_counts` / `get_my_agenda` tools
run workspace-wide"). The RBAC work closed most of it **as a side effect**, and this scan
confirmed the mechanism rather than assuming it:

| tool | reads | now filtered? |
|---|---|---|
| `search` | `SearchRepo.searchTasks/Lists/Spaces/Comments` | ✅ all four carry the visibility predicate (P18) |
| `get_my_task_counts` | `HomeRepo` — incl. `openTeamSeries`, `slaBreachesSeries` | ✅ both workspace-wide series filtered (P19) |
| `get_my_agenda` | `HomeRepo.agendaTasks` | ✅ already `assignee = me` |

The tools run inside the HTTP request, so the global `rbacContext` applies. The open question was
whether the async context survives the assistant's unusual shape — `AsyncLocalStorage.run` →
`await` → `for await` over the OpenAI stream → `await` a DB call inside the loop. Probed that exact
shape on this Node build: **context PRESERVED** on every iteration.

**Still owed:** an end-to-end test (a space-scoped user asking the bot to search for something in
another department and getting nothing). That is the remaining half of P22.

---

## 🟢 Healthy — no change needed

- **Transport / security:** SSE streaming, 401→refresh→retry, per-user 20/min limit, clean 503
  when `OPENAI_API_KEY` is absent, upstream errors never leaked, tool params are model-supplied but
  identity is injected from the JWT (the model cannot reach another user or workspace).
- **Bangla-always:** all 13 live probes answered in Bangla.
- **In-app links:** the baseline question emitted `[…](/settings/profile)` — `mdLink` navigates via
  react-router without a reload.
- **Error UX:** `chat.ts` exposes `error` + `retryLast()`; the widget renders an inline
  `role="alert"` banner with a Retry button (P8 shipped correctly).
- **Tests:** `jest.assistant` **4 suites / 52 tests** green; client `vitest` 40 green.

---

## Minor

- **`POST /assistant/chat` (JSON, non-streaming) has no tools** — only the SSE path wires them
  (`AssistantController.chat` → `ask()` vs `chatStream` → `streamReply({tools})`). The client always
  streams, so it is invisible today, but the JSON contract is quietly weaker than the SSE one.
- The starter questions (`suggestions.ts`) have no RBAC entry — once C2 is fixed, "kivabe kauke
  shudhu ekta department er access debo?" is an obvious addition.

---

## Suggested order if this gets fixed

1. **C1** — one condition in `streamReply`, plus a test that a content-preamble round still
   executes its tools. Highest impact per line changed: it turns the data tools from ~1-in-3 to
   reliable.
2. **C2** — rewrite the KB's "Roles and permissions" + Settings + page-address sections for the
   dynamic model, and delete the three false claims.
3. **H1** — make the guard structural (routes-in-KB parity) so the next feature cannot drift.
4. **H2** — swap the widget onto `usePermissions()` as part of the client gating pass.
5. **L12** — the end-to-end scoping test.

---

# ADDENDUM — measured against its ACTUAL purpose

> *"chatbot er main purpose hocche system jodi keu na bujhe bujhaiya dibe use korar jonno."*

The findings above are a general bug list. Graded against **that** purpose the ranking changes, so
this section re-measures with the questions a confused, non-technical first-timer really asks.

## The test

15 questions across orientation / concepts / how-to / account / admin, asked live. Each answer
graded on the four things that decide whether a beginner can actually follow it.

| category | LINK | STEPS | len | route given |
|---|---|---|---|---|
| "what is this system?" | — | — | 577 | — |
| "I understand nothing, where do I start?" | — | ✅ | 608 | — |
| "Space / List / Task — what's the difference?" | — | ✅ | 675 | — |
| "how do I create a task?" | — | ✅ | 272 | — |
| "how do I give a task to someone?" | — | ✅ | 346 | — |
| "where do I see my work?" | — | ✅ | 337 | — |
| "how do I change a task's status?" | — | ✅ | 415 | — |
| "what is Board view?" | — | ✅ | 447 | — |
| "how do I comment / get notified?" | ✅ | ✅ | 554 | `/inbox` |
| "how do I attach a file?" | — | ✅ | 273 | — |
| "I forgot my password" | — | ✅ | 326 | — |
| "how do I add someone to the team?" | ✅ | ✅ | 546 | `/settings/members` |
| "who checks my finished work?" | ✅ | — | 308 | `/dept` |
| "how do I create a new department?" | — | ✅ | 444 | — |
| "does it work on mobile?" | — | — | 101 | — |

**LINKS 3/15 · STEPS 12/15 · substantive 14/15 · Bangla 15/15**

## Verdict: not perfect — about 70% there

**It teaches well. It does not take you there.**

- ✅ **Explaining** is genuinely good: 12 of 15 answers are numbered/bulleted step-by-step, all in
  Bangla, all substantive. A beginner reading the text can follow it.
- ❌ **Guiding** is the gap, and it is the half the owner asked for by name — *"link diye
  instruction and link e dhuke ki ki korte hobe setao jeno perfectly user friendly way te bola
  thake."* Only **3 of 15** answers handed over a clickable address. The other 12 say "open it from
  the Sidebar", which is precisely the instruction a person who *does not understand the system*
  cannot act on.
- ❌ Worse than silence on the newest feature: asked how to give someone access to one department,
  it confidently sends them to **Settings → Members**, which cannot do it (C2 above).

## Root cause of the link gap — found, and it is small

The KB contains **11 markdown links in total, across only 2 of its 18 sections**:

```
  7  Quick answers (with the page to go to)
  4  Department review and weekly reports
  0  About this system
  0  The core structure
  0  Navigation — where things are
  0  Where things live (page addresses)      <-- routes ARE here, as PLAIN TEXT
  0  Getting started
  0  Working with tasks — the 4 views
  0  Task details
  0  Assigning and following work
  0  Inbox and notifications · Search · Forms · Engineering
  0  Settings and administration · Roles and permissions · Account and sign-in
```

The bot emits a link only when the question happens to hit one of those 11 lines — which is
exactly the 3/15 measured. The addresses already exist in the KB; they are written as
`**Inbox** — /inbox` instead of `[Inbox](/inbox)`, and the how-to prose never carries one at all.

So this is not a model problem, a prompt problem, or an architecture problem. It is ~18 sections of
content that need their real routes inlined as links, and each how-to closing with
"go here → then do 1-2-3".

## Re-prioritised for THIS purpose

| was | now | why |
|---|---|---|
| 🔴 C1 tools dropped | 🟡 **medium** | "how many tasks do I have" is a *convenience*, not teaching. A first-timer is not asking it. |
| 🔴 C2 KB predates RBAC | 🔴 **critical** | It gives a WRONG route for a real need. Wrong is worse than "I don't know" for a confused user. |
| — | 🔴 **critical (new)** | **Links missing in 12/15 answers** — the guide-me half of the purpose does not work. |
| 🟠 H1 guard blind spot | 🟠 high | It is why both content gaps went unnoticed. |
| 🟠 H2 legacy role gate | 🟢 low | Cosmetic for this purpose. |

**What "perfect for this purpose" would mean:** every how-to answer ends with a real clickable
route plus what to do on arrival; nothing in the KB is factually wrong; and a structural guard
fails the build when a new page ships without the bot learning it.
