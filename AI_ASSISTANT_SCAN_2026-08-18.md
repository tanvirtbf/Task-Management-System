# 🤖 CHATBOT DEEP SCAN — 2026-08-18

**Scanned state:** `main` @ `9f40f86`, working tree clean.
**Scope:** the AI Help Assistant (সহায়ক) end to end — routes, orchestration, the 10 tools and
their permission model, the knowledge base and its drift guards, prompt construction, cost
envelope, persistence, the client widget, and the eval gates.
**Method:** read every line of the subsystem's 2,856 server LOC + 1,102 client LOC, traced each
tool down to the repository SQL, measured the real prompt sizes by importing the modules, and
queried the live chat tables. The 14-suite jest run (227 tests) was executed this session and is
green.

---

## 0. Verdict

**This is the best-engineered subsystem in the codebase, and its security model holds up under
direct examination.** The permission story is genuinely three-layered and I could not find a way
through it: the route requires `assistant.use`; every data tool inherits row-level RBAC scoping
from the repository layer via AsyncLocalStorage; and the tools that mirror a permission-gated
HTTP route assert that permission *themselves*, because the tool path never passes through the
route. Anti-enumeration is real — a task you cannot see and a task that does not exist return
byte-identical refusals. Denials are returned as *data*, so they survive the executor's catch-all
instead of collapsing into "tool_execution_failed". Every design decision carries a comment
naming the live probe that forced it.

**The findings are not in the permission model.** They are: one genuine injection surface
(conversation history is taken from the client and the server's own stored transcript is
ignored), a data-retention gap (chat transcripts are kept forever in plaintext with no way to
delete them), a knowledge base that is 99% full against its own guard, and a stray NUL byte that
makes the single most security-critical file in the subsystem invisible to grep.

---

## 1. Architecture, measured

| Component | Lines | Role |
|---|---|---|
| `assistant/tools.ts` | 1,175 | 10 tool definitions + the executor and its permission asserts |
| `assistant/knowledgeBase.ts` | 265 | The bot's entire factual knowledge, injected every request |
| `assistant/callerContext.ts` | 204 | The "who is asking" block — name, role, teams, capabilities |
| `assistant/systemPrompt.ts` | 149 | Identity, Bangla-script rule, link rules, denial rendering |
| `assistant/links.ts` | 128 | Streaming link repair (strips invented domains mid-stream) |
| `assistant/buildMessages.ts` | 62 | system + history + question assembly |
| `services/AssistantService.ts` | 316 | The tool-calling loop, both transports |
| `controllers/AssistantController.ts` | 294 | HTTP/SSE, persistence, per-request tool executor |
| `routes/assistant.ts` | 223 | DI wiring, `assistant.use` gate, rate limit |
| `services/openaiClient.ts` | 40 | Singleton client, graceful disable |
| **client** | 1,102 | Widget, SSE reader, chat store, link renderer, suggestions |
| **tests** | 3,921 | 14 suites, 227 tests — *more test code than source code* |

**10 tools:** `get_my_task_counts`, `get_my_tasks`, `get_task_details`, `get_my_agenda`,
`search`, `get_people`, `get_my_approvals`, `get_report_status`, `get_sla_breaches`,
`create_task` — the last being the only write.

**Measured prompt sizes** (imported, not estimated):

| | chars | ≈ tokens | budget | headroom |
|---|---|---|---|---|
| `SYSTEM_PROMPT` | 11,892 | ~2,970 | — | — |
| `KNOWLEDGE_BASE` | 35,618 | ~8,900 | — | — |
| **system message total** | **47,550** | **~11,890** | 48,000 | **450 (0.9%)** |
| tool definitions | 7,042 | ~1,760 | 8,000 | 958 |

---

## 2. The permission model — verified sound

I traced all three layers rather than trusting the comments.

**Layer 1 — the route.** All three endpoints carry `authenticate` + `requirePermission("assistant.use")`
(declared as a `canUseAssistant` alias). The rate limiter sits *outside* the permission check on
purpose — it is an in-memory counter and the check is a DB read, so letting a flood through just
to look up permissions would defeat it.

**Layer 2 — the repository, via AsyncLocalStorage.** This is the load-bearing one. `rbacContext`
runs on every v1 route, so the tool path has the caller's scope in ALS. Verified in the SQL:

- `SlaRepo.listBreached` → `listScopeFilter(tasks.primaryListId, await taskOwnEscape())` in the WHERE
- `HomeRepo` → `listScopeFilter`/`taskOwnEscape` used **5 times**, including both workspace-wide KPI series (the code comment records the RBAC P19 fix: "the two workspace-wide KPI series counted the whole company for everyone")
- `TasksRepo.findDetailInWorkspace` → `listScopeFilter` + `taskOwnEscape` in the WHERE

This is why `get_sla_breaches` can call `sla.listBreached({workspaceId, filters:{}})` with no role
argument and still be safe — **and it is why the ALS-survives-streaming test matters.** That test
exists: *"the async context survives the streaming loop — a tool called mid-stream still sees the
caller, not the last request."* That is exactly the bug this architecture would otherwise have.

**Layer 3 — the tool's own assert.** For surfaces the HTTP routes gate with `requirePermission`,
the tool re-asserts, because the route never runs:

- `get_people` → `member.view` on **every** mode (the comment records finding G7: the directory used to be reachable through `create_task` with only `assistant.use`)
- `create_task` → `member.view`, but **only when assigning to someone other than `@me`** — correct, self-assignment needs no directory access
- `get_report_status` → `report.view`, with an owner/admin-or-head branch
- `create_task` writes through the real `TaskWriteService`, so RBAC, the team-access approval gate and the audit trail all apply

**Anti-enumeration is real.** `taskDetailsTool` returns one identical `NOT_FOUND` for
"does not exist" and "exists but you cannot see it", and does not echo the requested name back.
The system prompt documents the doctrine: *"A denial must never confirm that something the caller
cannot see EXISTS."*

**Denials are data, not exceptions.** `denied(key)` returns `{error, code, permission, reason}`.
This matters more than it looks: `AssistantService.appendToolRound` wraps every `execute()` in a
`try/catch` that collapses throws into `{error:"tool_execution_failed"}`. Had denials been thrown,
every permission refusal would have reached the user as a meaningless generic failure.

**Caller context leaks nothing.** The block carries name, role, team names and capability words —
`userId` appears only as a lookup key, never in the output. Ceiling of 600 chars is *enforced*
(drop the CANNOT list, then hard-truncate), not hoped for.

**Other things that are right:** unknown tool name → safe `{error:"Unknown tool: …"}`; the model
supplies intent only and the executor injects identity; a per-request double-create guard so a
repeated `create_task` in one message returns the first result instead of writing twice; upstream
OpenAI errors are mapped to safe `AppError`s and never leaked; a missing `OPENAI_API_KEY` degrades
to a clean 503 instead of crashing the server at boot; `MAX_TOOL_ROUNDS = 4` with the last round
forced to run *without* tools so the model must produce a plain answer.

**Drift guards are unusually good.** `route-parity.test.ts` reads the actual
`client/src/router.tsx` and fails the build in **both** directions — ship a page without teaching
the bot, or let the KB link an address that does not exist, and the build stops. Its own comment
explains why fact-pinning alone was insufficient: *"its twenty Dept-Review assertions all stayed
green for the whole time the knowledge base went stale about RBAC, because nobody had written an
RBAC assertion yet."*

---

## 3. Findings

### 🟠 A1 — Conversation history is taken from the client, and the server's own transcript is ignored

`POST /assistant/chat` reads `history` straight out of the request body and passes it to the
model unmodified:

```ts
const { message, history, conversationId } = req.body;
…
await this.assistantService.ask(history ?? [], message, { … });
```

`chatValidator` checks *shape* only: at most 20 turns, `role` in `{user, assistant}`, content
≤4000 chars. Nothing checks that those turns are what the assistant actually said. Meanwhile the
server **is** persisting the real transcript to `chat_messages` — and never reads it back for
context. Persistence is write-only.

So a user can fabricate assistant turns and put words in the bot's mouth: prior turns that
"establish" it will ignore the anti-enumeration rule, or answer in Roman-script Bangla, or that
it already confirmed some permission the caller does not have.

**What bounds the damage — and this matters, so be precise about it:**

- `role` is restricted to `user|assistant`, so **a `system` turn cannot be injected.** The real system prompt always wins position 0.
- Every tool injects caller identity server-side and every repo read is ALS-scoped, so **no forged history can cross a data boundary.** The bot cannot be talked into reading another team's tasks.
- The blast radius is therefore *behavioral*, not *data*: a user can make the bot produce misleading text **in their own session only**, and screenshot it as "the system says X".

It is also a cost amplifier: 12 turns × 4,000 chars ≈ 12k attacker-controlled tokens, re-sent on
every one of up to 4 tool rounds.

**No test covers this.** `tests/assistant/` has no injection/forged-history case (the scoping
suite proves the data boundary, which is the harder half — but the behavioral half is untested).

**Fix:** when `conversationId` is present, rebuild history from `chat_messages` server-side and
ignore the client array. The repo method already exists (`getMessages`), and this also makes the
persistence layer earn its keep.

---

### 🟠 A2 — Chat transcripts are kept forever, in plaintext, with no way to delete them

```sql
content MEDIUMTEXT NOT NULL   -- no encryption
```

- **No retention job.** The registry has 9 jobs; none touches chat.
- **No delete endpoint.** The router has `GET /conversations` and `GET /conversations/:id` — there is no `DELETE`.
- **No UI to delete either**, since there is no chat-history UI at all (see A5).
- **`db:seed:demo` does not clear the chat tables**, so test data survives a reseed.

The dev database already holds **1,392 conversations / 2,784 messages**, all written between
13–16 August. Those are eval artifacts — the same questions repeat 44–62 times each
("ami ki ki task e assign asi? list dao" ×62), i.e. the eval suite run 44+ times, 1,147 of them
under `owner@company.local`. Not a threading bug; the client does thread correctly. But it shows
the accumulation rate, and on production those rows will be real conversations instead.

The contrast is the sharp part: **form submissions get field encryption *and* a 90-day expiry job**
(`form-submission-expiry`). Chat messages can contain exactly the same operational content — task
names, complaint details, colleagues' names, whatever someone pastes in — and have neither.

**Fix:** a `chat-retention` job mirroring `form-submission-expiry`, plus
`DELETE /assistant/conversations/:id`. Decide the window deliberately (90 days would match the
existing PII precedent).

---

### 🟠 A3 — The system message is at 47,550 of its 48,000-char budget

**450 characters of headroom — 0.9%.** The next fact anyone teaches the bot fails the build.

The guard working is good news; being out of room is not. The KB is the "retraining" mechanism for
this bot, and it is effectively full. This needs a decision rather than another squeeze:

- compress (the test comments show this has already been done at least twice — "the walkthrough were all compressed rather than the budget moved"),
- raise the ceiling and accept the per-request cost, or
- move from KB-in-prompt to retrieval, which is the real answer eventually but a genuine project.

Worth deciding *before* the next feature needs teaching, not during it.

**Cost envelope while we are here:** ~13,650 fixed tokens per round (system + tool defs), up to 4
rounds, plus up to 12k of client-supplied history per round. Worst case for a single user message
is on the order of **100k input tokens**. At 20 requests/min/user that is the only spend guard
there is — see A8.

---

### 🟡 A4 — A literal NUL byte makes `tools.ts` invisible to every grep-based tool

At line 306:

```ts
].join(" ");   // ← written as a RAW 0x00 byte in the file, not as this escape
```

`file src/assistant/tools.ts` reports **`data`**, not text. Consequence: `grep` and `ripgrep`
treat it as binary and **skip it by default**. The most security-critical file in the subsystem —
the one holding every permission assert — is silently absent from any code search, audit sweep, or
`grep -r` across the repo. It bit this scan twice before I noticed.

Runtime behaviour is correct and `tsc` compiles it fine; the separator itself is a reasonable
choice for a dedup key.

**Fix:** replace the raw byte with the two-character escape ` ` (or `\0`). Identical runtime
behaviour, and the file becomes greppable text again. One-character-class change, no test impact.

---

### 🟡 A5 — Chat history has no UI; two of three endpoints are orphaned

`GET /assistant/conversations` and `GET /assistant/conversations/:id` are built, permission-gated,
owner-scoped, tested — and **no client code calls either one**. The chat store persists only the
*current* thread to localStorage, so a user cannot revisit yesterday's conversation.

That makes the whole persistence layer invisible to the product: it costs writes on every message
and returns nothing to the user. It also weakens the A1 fix path — server-side history is much
easier to justify once the user can actually see and manage their threads.

---

### 🟡 A6 — The three assistant endpoints are absent from `API_DESIGN.md`

Carried from the full system scan. `POST /assistant/chat`, `GET /assistant/conversations` and
`GET /assistant/conversations/:id` appear nowhere in the API contract document.

---

### 🔵 A7 — The model is pinned to `gpt-4o-mini`

`OPENAI_MODEL` defaults to `gpt-4o-mini` (`openaiClient.ts`, `config/index.ts:149`), overridable
by env with no code change. Much of the hardest engineering in this subsystem is compensation for
weak tool-calling — the P0 baseline recorded *"only 2 of 10 live data questions came back with a
real number"*, and the fix was a careful restructure of when tool calls are honoured mid-stream.
A periodic re-evaluation against current OpenAI offerings is worth scheduling; it is a config
change plus an eval run, and it may let some of that compensation relax.

### 🔵 A8 — No spend cap beyond the per-minute rate limit

`assistantLimiter` is 20 req/min keyed on user id (falling back to IP). There is no per-user daily
cap, no workspace budget, and no alerting on OpenAI spend. Combined with the ~100k worst-case
input tokens per message (A3), a single user can drive real cost without tripping anything. The
per-round `max_tokens: 800` is also **per round, not per request** — a 4-round answer may emit up
to 3,200 output tokens.

### 🔵 A9 — `listConversationsByUser` does not filter by workspace

It scopes on `user_id` alone. `createConversation` *does* store `workspace_id`. No impact today
(one workspace per deployment), but the column is there and unused in the read.

---

## 4. What I did not run

**The two live gates were not executed**, because they call the real model and spend real money:

- `node server/scripts/assistant-eval.cjs --assert` — grades answer quality (links, data accuracy, steps, Bangla script, fabrication, forbidden content)
- `node server/scripts/assistant-role-matrix.cjs` — asks the acceptance questions **as every role** and checks each answer against the API's own truth, which is the one thing a single-account eval cannot see

Both need the dev stack up with `DISABLE_RATE_LIMIT=1`. Say the word and I will run them.

---

## 5. Recommended order

1. **Rebuild history server-side from `chat_messages`** when `conversationId` is present (A1) — closes the injection surface and makes persistence useful. Add a forged-history test alongside it.
2. **Add a chat-retention job + `DELETE /assistant/conversations/:id`** (A2) — mirror `form-submission-expiry`; decide the window.
3. **Fix the NUL byte** (A4) — one edit, restores greppability of the security-critical file.
4. **Decide the KB budget question** (A3) before the next feature needs teaching.
5. **Build the chat-history UI** (A5) — two tested endpoints already waiting.
6. Document the three endpoints (A6); schedule a model re-evaluation (A7); consider a daily spend cap (A8).
