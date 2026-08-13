# AI Assistant DEEP PLAN — nirbhul answers, easy guidance, permission-scoped data

> **The ask (2026-08-13):** (1) the chatbot must give ONLY correct information about this
> system, (2) a confused person must be guided easily, and (3) any member may ask for any
> DATA and the bot answers **exactly within that member's role permissions** — "ami ki ki
> task e assign asi?" answers with their real tasks if their permission covers it, and
> otherwise the bot says, honestly: *"দুঃখিত — এটা দেখার জন্য আপনার যথেষ্ট permission নেই।"*
>
> **Protocol:** one phase at a time. The user says **"AI deep phase N koren"** → build ONLY
> that phase → test → log in `AI_ASSISTANT_BUILD_LOG.md` → stop. No phase starts itself.

---

## 0) Baseline — what the scan found (2026-08-13, all verified in code)

**What exists and is healthy**
- 4 tools: `get_my_task_counts` (6 scoped numbers), `get_my_agenda` (own tasks due on a
  date), `search` (RBAC-scoped keyword search), `create_task` (the ONE write; RBAC + P8
  approval gate live-proven). Both transports share one loop; `MAX_TOOL_ROUNDS = 4`.
- Tools run INSIDE the authenticated request → AsyncLocalStorage RBAC context applies, so
  every repo that self-filters (`SearchRepo`, `HomeRepo`, `TasksRepo` reads) is safe by
  construction. Proven by `scoping.test.ts` (5) + `create-task-tool.test.ts` (11).
- Guards: `route-parity.test.ts` (router ↔ KB ↔ eval allowlist), `kb-coverage.test.ts`
  (facts + 39k size budget), eval gate `assistant-eval.cjs --assert` = PERFECT today.

**The gaps this plan closes**

| # | Gap | Consequence today |
|---|-----|-------------------|
| G1 | **The bot does not know WHO is asking** — no name/role/teams/permissions in the prompt | Guidance can't be role-aware ("apni Member, tai ei step apnar Admin korbe"); "what can I do?" is unanswerable; the bot can't say WHY something is denied |
| G2 | **No tool lists a member's actual assigned tasks** — counts and due-on-a-date only | The headline question "ami ki ki task e assign asi?" gets a number, not the tasks |
| G3 | **No task-detail tool** (status, assignees, due, checklist %, review verdict) | "X task er ki obostha?" → the bot can only search the name |
| G4 | **No people/team tool** (rosters, heads, who-is-in-which-team, a colleague's open work) | Very common office questions go unanswered |
| G5 | **No approvals tool** (team-access requests: received / sent / my team's) | "amar kache ki approval pending?" — the office's newest workflow — is invisible to the bot |
| G6 | **No reports/review/SLA data tools** | Heads/HR can't ask "ei shoptaher report ready?"; nobody can ask "kono task SLA miss korse?" |
| G7 | **`UsersRepo.listByWorkspace` has NO scope filter** (route gate `member.view` covers the HTTP surface, but `create_task`'s assignee resolution calls it holding only `assistant.use`) | A name-existence oracle. Impact ≈ 0 today (every seeded role holds `member.view`) but it breaks the model the moment an admin revokes it |
| G8 | **Permission denials are silent shrinkage** — a scoped search just returns less; the bot says "kichhu pai nai" instead of "permission nei" | The user's explicit ask #3: the bot must SAY when permission is the reason |
| G9 | KB last full-audited 2026-07-28; since then shipped: team-access P1–P10, checklist counters + editable checklists, invite-email change, permanent member delete, `create_task` | Sections exist for most, but no line-by-line re-verification → risk of nirbhul violations |

**Facts the design leans on (verified)**
- `currentActor()` (rbac/context.ts) returns the caller's resolved permission set inside
  any tool; `holds()` / `can()` / `denyMessage()` (rbac/can.ts) give assertions + wording.
- `AssignmentRequestsService.list` is already relationship-scoped (`box=received|sent|team`).
- `HomeRepo` has the series/agenda queries; a "my open tasks LIST" query does not exist yet
  and must be added WITH `listScopeFilter` (the Home/Tasks pattern).
- Anti-enumeration is doctrine (P8 scoping tests): a denial must never confirm that an
  invisible thing EXISTS. Denial wording must stay ambiguous between "nei" and "dekhar
  permission nei" for foreign OBJECTS, but can be direct for foreign CATEGORIES
  ("onno team er task দেখা" is deniable outright — it names no object).
- Tool DEFINITIONS ride the `tools` param (per-request input tokens), NOT the 39k system
  message — but they still cost per call. Descriptions stay tight; the budget test guards
  only the system message, so P8 adds a def-size guard.

---

## 1) Doctrine — every phase obeys these

1. **Identity from the JWT, intent from the model.** No tool takes a user id from the
   model for "me"; "@me" resolves server-side. Unchanged.
2. **Read-only stays read-only.** `create_task` remains the ONLY write. New tools in this
   plan are ALL reads. Accept/reject/edit keep going through the UI (the bot links it).
3. **Two layers of safety per tool:** (a) an EXPLICIT `holds()`/`can()` assertion inside
   the tool for the permission that gates the surface (because route-level gates do not
   protect the tool path), then (b) the scoped repo/service underneath. Never only (b).
4. **Denials are DATA, in one shape:** `{ error, code: "rbac.forbidden", permission }` —
   the model relays it as the standard Bangla apology + who can help (Admin/Head) + a
   link. Never a 500, never silence, never a guess.
5. **Anti-enumeration:** object-level misses stay `not_found`-shaped ("খুঁজে পাইনি বা আপনার
   দেখার অনুমতি নেই" — ambiguous by design); category-level denials may name the permission.
6. **Nirbhul = KB-grounded + tool-grounded.** How-to answers come from the KB only; data
   answers come from tool results only; the prompt forbids mixing invented numbers.
7. **Every phase ships its tests in the same phase** (jest, and eval rows where graded),
   updates the BUILD_LOG, and leaves `jest.assistant` + builds green. KB-string rule
   (no backtick/`${}` in the literals) and the size budget stay enforced.
8. **Bangla always** for user-visible bot text; English identifiers stay English.

---

## 2) The phases

### P0 — Decisions locked + caller-context design *(small, no product change)*
- Confirm the decision log (§3) or take overrides from the user.
- Write the exact CALLER CONTEXT block format (see D2) + the standard denial paragraph
  (Bangla) into `systemPrompt.ts` as a spec comment (not yet active).
- Baseline snapshot: current eval PERFECT output + 145 jest + system-message size, so
  every later phase diffs against a recorded starting point.
- **DoD:** decisions written into this file's §3; no behavior change; all green.

### P1 — KB nirbhul audit (ask #1: correct information, always) — ✅ **COMPLETE 2026-08-13**
> **9 wrong claims found and fixed** (Guest powers, statuses, import/export, templates apply,
> team-access mode, per-space roles, pre-SSE notifications, checklists, invite email) + DEFECT-1
> fixed and measured 6/6 + a second live defect (invented Members→Edit→Teams UI) caught by
> probing the fix. jest 145 → **155**; eval **PERFECT ×3**, links 13–14 → **15/15**, Bangla
> 14 → **15/15 every run**. Full audit table in `AI_ASSISTANT_BUILD_LOG.md`.
> **Uncovered 4 PRODUCT gaps** (not KB work, listed there for a future decision): statuses are
> read-only, Import/Export is a mockup, "Apply template" has no button, no UI assigns a custom
> role to one person.
- **Starts with DEFECT-1 (§5): the Banglish-mirroring bug.** Fix the language rule so the
  reply is always Bangla SCRIPT even when the question is romanized, re-measure the failing
  question ≥5 times (it flips 2-in-3 today), and pin it with a test + an eval row so it
  cannot come back. Audit the same answer's *"See spaces / Their spaces"* claim, which may
  be a fabrication.
- Line-by-line re-verification of every KB claim against the CURRENT system — the same
  discipline as the P2 audit of 2026-07-23, which found 7 wrong facts.
- Known suspects from the scan: checklist editing + the task progress chip (022), the
  invite email's new sender/subject, permanent member delete (exists in KB — verify the
  wording matches the shipped refuse-with-breakdown behavior), team-access §"Who sees
  what" vs the LIVE pre-flip reality (KB must describe the model as configured, noting
  the flip state is an office decision), `create_task` FAQ, "Good to know" limitations
  (recurrence spawn, sprint/status read-only, role-assign UI — re-verify each is STILL
  true, per the 2026-08-11 system scan).
- Extend **Quick answers** with the questions this plan makes answerable, so links and
  steps exist before the tools land (the bot must never promise a tool it lacks —
  wording stays "coming" -free: only describe what works TODAY at each phase).
- **Tests:** kb-coverage pins for every corrected fact; route-parity stays green.
- **DoD:** audit table in BUILD_LOG (claim → verdict → fix), jest + eval green.

### P2 — Caller context + honest-denial foundation (G1, G8 groundwork) — ✅ **COMPLETE 2026-08-13**
> `assistant/callerContext.ts` builds the ≤400-char caller line (enforced) from `currentActor()`
> + the two D11 reads; controller-built per D9/D10; prompt gained WHO-YOU-ARE-TALKING-TO and
> WHEN-SOMETHING-IS-REFUSED. jest 155 → **163** (new `caller-context.test.ts`, incl. no-PII and
> two-callers-do-not-blur). Live: the same question now answers differently for a Member vs an
> Admin, and a Member asking for weekly reports gets an honest "পারবেন না" + who can. Eval
> **PERFECT ×3**. Budget 44k → 46k (decision in the test).
- `buildMessages.ts`: after the "Today is" line, inject a per-request CALLER block built
  from `currentActor()` + the JWT: display name, legacy role, space-scoped teams (names),
  and a compact capability summary (the ~10 permissions that matter to guidance: task
  view/create/edit reach, member.view, review.read, report.view, role.manage,
  space.members_manage). Format per D2. Cost target: ≤ 400 chars.
- `systemPrompt.ts`: the ROLE-AWARE GUIDANCE rules — tailor steps to the asker's own
  capabilities; when a step needs a permission the asker lacks, say so and route them to
  their Admin/Head with a link; the standard denial paragraph (D3) for tool denials.
- This phase makes "amar ki ki korar onumoti ache?" answerable from the context alone.
- **Tests:** new `caller-context.test.ts` — the block renders for a member vs an admin
  (permission summary differs), no PII beyond name/role/teams, size within budget; a
  scoping-style test that the block reflects the CALLER of each request, not a cached
  user. Budget test re-measured (raise only with a written decision).
- **DoD:** live probe — a dept-only member asks "amar role ki? ami ki korte pari?" and
  gets a correct, personal Bangla answer with zero tool calls; eval PERFECT.

### P3 — "My work" tools (G2, G3 — the headline ask) — ✅ **COMPLETE 2026-08-13**
> `get_my_tasks` (5 buckets, cap 20 + `more`) and `get_task_details` (incl. checklist %) shipped;
> new `HomeRepo.myTasksByBucket` + a scoped `TasksRepo.findDetailInWorkspace`. jest 163 → **184**.
> Three live defects fixed: the invented domain (now stripped deterministically by
> `assistant/links.ts` + `LinkSafeStream`, because two prompt rules failed), a permitted user
> refused over an em dash, and two self-contradicting bits of our own prompt/KB. Eval **PERFECT
> ×5** with `clickable route` at **15/15 for the first time**; budget held at 46k by deleting the
> Sidebar/Where-things-live duplication.
- Tool `get_my_tasks`: buckets `open | due_soon | overdue | awaiting_review | done_recent`
  (arg `bucket`, default `open`; cap 20 rows: name, custom_id/id, list, space, status,
  due, priority, review_status). New `HomeRepo` (or TasksRepo) query WITH
  `listScopeFilter` + assigned-to-me — the proven Home pattern. Self-data needs no extra
  permission beyond `assistant.use` (it is the caller's own assignment row — same
  doctrine as the existing counts/agenda).
- Tool `get_task_details`: resolve by custom_id/id/exact name via the SCOPED TasksRepo
  read (own-escape included); return status, assignees, due/start, priority, list/space,
  checklist done/total, review verdict, watcher count, pending assignment-requests count.
  Out-of-scope/missing → the ambiguous not-found shape (doctrine 5).
- Prompt: data-answer formatting rules (short Bangla list, `/t/<id>` links, no invented
  fields); agenda/counts descriptions cross-reference the new tools so the model picks
  the right one.
- **Tests:** `my-work-tools.test.ts` — buckets return exactly the caller's rows (two
  callers in sequence, P8-style); scoped member cannot fetch a foreign task's details
  (ambiguous error, no name echo); checklist figures match 022 counters; review verdict
  present. Eval: 2 new data rows (see P8).
- **DoD:** live probes as a member: "ami ki ki task e assign asi?", "'Eid banner' task er
  obostha ki?" — correct, linked, Bangla; eval PERFECT.

### P4 — People & teams tool (G4) + the directory oracle fix (G7)
- Tool `get_people`: modes `my_teams` (my spaces + their heads), `team_roster` (members
  of a named team), `find_person` (name → team(s), head-or-member, active status),
  `person_workload` (a colleague's OPEN task count — count, not the list).
- **Explicit gates inside the tool:** all modes require `holds("member.view")`
  (denial per doctrine 4). `person_workload` additionally computes through the
  CALLER-scoped task read, so the number covers only tasks the CALLER may see —
  and says so ("apni ja dekhte paren tar moddhe").
- **G7 fix in the same phase:** `create_task`'s assignee resolution asserts
  `member.view` when `assignee_names` is present (readable refusal otherwise), so the
  directory is uniformly gated on the tool path. (Roster UI is untouched — its route
  gate already does this.)
- Anti-enumeration: `team_roster` for an invisible team → the ambiguous shape;
  `find_person` is workspace-wide BY DESIGN once `member.view` is held (that is exactly
  what the Members page shows).
- **Tests:** `people-tool.test.ts` — with/without `member.view` (both modes), dept-only
  caller sees roster of own team, foreign team → ambiguous denial, workload number
  equals scoped truth, create_task+assignee without member.view refuses cleanly.
- **DoD:** live probes: "amar team e ke ke ase?", "Rakib kon team e?", "Sadia r koyta
  kaj cholche?" per role; eval PERFECT.

### P5 — Approvals tool (G5 — the office's newest workflow)
- Tool `get_my_approvals`: wraps `AssignmentRequestsService.list` boxes —
  `received` (I must decide), `sent` (I asked), `team` (targets in teams I head),
  each row: task name+link, who→whom, age, expires-in. Relationship-scoped in the
  service already; the tool adds no reach. Deciding stays in the UI — the bot explains
  Accept/Reject and links [Inbox → Requests](/inbox).
- Prompt: the approval-flow explainer already in the KB gets a data companion; the bot
  must distinguish "apnar kache pending" vs "apni pathiyechen" vs "apnar team er".
- **Tests:** `approvals-tool.test.ts` — target sees received, requester sees sent, head
  sees team box, an unrelated member sees empty (not error), expired requests excluded.
- **DoD:** live probe with a seeded pending request; eval PERFECT.

### P6 — Reports, review & SLA data (G6 — head/HR/admin surfaces)
- Tool `get_report_status`: latest weekly report per team the caller may read —
  requires `holds("report.view")` OR being that space's head (the service's own
  head-or-permission rule reused); returns week, ready/seen, headline counts, link.
- Tool `get_sla_breaches`: list (cap 10) of breached tasks THE CALLER CAN SEE — the
  same scoped query the counts tool already summarizes; names + how-late + links.
- Review verdicts on own tasks already ship in P3 rows (`review_status`); this phase
  adds the head-side question "amar team er koyta task review baki?" via the existing
  dept-review pending query behind `review.perform`/head — same explicit-gate pattern.
- **Tests:** `reports-sla-tools.test.ts` — member without report.view denied (named
  permission, doctrine 4), head of team A cannot read team B's report (ambiguous),
  SLA list matches the scoped count, review-pending gated.
- **DoD:** live probes as head + member + admin; eval PERFECT.

### P7 — Guidance polish (ask #2: "keu kisu na bujhle easily guide")
- `suggestions.ts`: starter questions become capability-aware using the same audience
  hooks (P7 precedent) — a member sees "ami ki ki task e assign asi?", a head sees the
  approvals/review questions, an admin sees the roster/report ones.
- KB Quick answers: one entry per new tool question, each with the fallback page link
  (so a degraded/503 assistant still leaves the user a path).
- `ASSISTANT_TEAM_NOTE.md` (Bangla) rewritten for the new reality: what you can ASK
  (data), what it can DO (create only), what it will refuse (permissions), one line on
  privacy ("bot apnar hoye dekhe — apni ja dekhte paren, tar baire kichu na").
- **Tests:** suggestions tests extended per audience; kb-coverage pins the new quick
  answers; route-parity green.
- **DoD:** widget shows role-correct starters live for 3 different roles.

### P8 — The grader learns the new surface (tests-first hardening)
- `assistant-eval.cjs` section C "PERMISSIONS" (graded, --assert): a dept-only member
  asks (a) own assigned tasks → expects real rows, (b) another team's tasks → expects
  the denial phrase and NO foreign names, (c) a member without report.view asks for the
  report → denial names the permission; plus 2 accuracy rows for P3 tools vs DB truth.
  Targets: denials 3/3, leaks 0, data rows correct.
- A tool-DEFINITION size guard (defs ride every request): jest pins
  `JSON.stringify(ASSISTANT_TOOL_DEFS).length` under a budget with the decision comment.
- Negative-path sweep: every tool called with garbage args (missing/wrong types) returns
  a readable error, never throws past the executor (extend the pattern the create tests
  use).
- **DoD:** eval PERFECT including section C, across 3 consecutive runs; jest all green.

### P9 — Ship gate
- Full per-role LIVE matrix (owner / admin / head / member / multi-team member /
  dept-only / guest): the question list from §4, every answer checked against the DB.
- Full `jest.assistant`, server tsc + build, client build (touched only if suggestions
  changed), BUILD_LOG final entry, memory update.
- Rollout note: server = `git pull` + `pm2 reload` (no DB change anywhere in this plan).
- **DoD:** matrix table in BUILD_LOG with zero open rows; eval PERFECT; committed +
  pushed.

---

## 3) Decision log — 🔒 **LOCKED at P0 (2026-08-13)**

The user invoked P0 without overrides, so the recommended defaults below are now the
agreed contract (same protocol as the first assistant plan's P0). D9–D11 were added **by
P0's code verification** — they are answers to questions the plan had left implicit.

| # | Decision | Locked value |
|---|----------|--------------|
| D1 | New tools are read-only; deciding/acting stays in the UI | **Yes** — `create_task` stays the only write |
| D2 | Caller-context format | One block after "Today is": `You are talking to <First Last> — role <Owner/Admin/Member/Guest>, teams: <names or "none">. They can: <compact capability list>. Tailor every answer to this person.` |
| D3 | Standard denial wording (tool `rbac.forbidden`) | «দুঃখিত — এটা দেখার জন্য আপনার যথেষ্ট permission নেই। আপনার Admin (বা আপনার টিমের Head) এই access দিতে পারেন।» + relevant settings/inbox link; object-level misses use the ambiguous «খুঁজে পাইনি বা আপনার দেখার অনুমতি নেই» |
| D4 | Row caps in tool results | 20 (my-tasks), 10 (rosters, SLA, approvals) — with a `more: true` flag the bot must mention |
| D5 | `person_workload` returns a COUNT, not the task list | **Count only** — a colleague's task LIST through someone else's chat is a privacy step too far for V1 |
| D6 | Size budgets | System message stays < 39k unless a phase writes a new decision; tool defs get their own pinned budget in P8 |
| D7 | Phase order | P1 (truth) before P2 (context) before data tools — accuracy first, then identity, then reach |
| D8 | No new DB objects | All reads use existing tables/queries + one new scoped my-tasks query — no migration in this plan |
| D9 | **Who builds the caller block** (P0 finding: `buildMessages` has no request context, and `AssistantService` has no `req`) | The **controller** builds it (it owns `req.auth` and can `await currentActor()`) and passes it as an argument; `buildMessages` stays pure and unit-testable. Built ONCE per request, never per tool round |
| D10 | Is the caller block persisted? | **No.** `ChatRepo` stores only the user text and the assistant reply; the system message never enters history. A later message re-derives it, so a permission change takes effect on the next question |
| D11 | Where team NAMES come from (P0 finding: `currentActor()` carries space **ids** only) | `SpacesRepo.listByWorkspace` (already `spaceScopeFilter`-ed) ∩ `UserRolesRepo.spaceIdsForUser` — two cheap scoped reads. **Not** `TeamMembershipService.directory()`: that is the whole org chart, unscoped by design, and far too heavy for every chat message |

---

## 4) The acceptance question set (used by P8 eval + P9 matrix)

Per role, in Bangla/Banglish, every one must be correct or correctly denied:
1. "ami ki ki task e assign asi?" · 2. "ajke/ei shoptahe amar ki ki due?" ·
3. "'X' task er obostha ki? checklist koto% hoise?" · 4. "amar team e ke ke ase? Head ke?" ·
5. "Rakib kon team e? or koyta kaj cholche?" · 6. "amar kache ki approval pending ase?" ·
7. "ami ki onno team er task dekhte pari?" (guidance + honest limits) ·
8. "ei shoptaher report ready hoise?" (head/HR vs member-denial) ·
9. "kono task SLA miss korse?" · 10. "amar ki ki korar onumoti ache?" ·
11. a dept-only user asking for another team's roster/tasks → denial, zero leaked names ·
12. "notun task kivabe banai?" / "password bodlai kivabe?" (regression: guidance intact)

---

## 5) P0 execution record — ✅ COMPLETE (2026-08-13)

### Baseline (every later phase diffs against these)

| measure | value | note |
|---|---|---|
| system message | **38,272 chars** | budget 39,000 → **728 chars of headroom** |
| tool definitions | **3,143 chars**, 4 tools | rides every request as `tools`, NOT inside the 39k |
| `jest.assistant` | **9 suites / 145 tests** | green |
| eval gate | **NOT reliably PERFECT** — see the defect below | links 13–14/15 · steps 11–12/12 · **Bangla 14/15 in 2 of 3 runs** · data 10/10 · fabricated 0 · forbidden 0 |

**Consequence for P1 and P2, stated now so neither phase is surprised:** the caller block
is capped at 400 chars, which leaves ~330 for anything P1 adds to the KB. If the nirbhul
audit needs more room, the budget moves to 39.5k **with a written decision in the test** —
compressing behaviour rules to dodge a number is the wrong trade (the same reasoning that
took it 38k → 39k for `create_task`).

### Design verified against the code (not assumed)

| claim the plan rests on | verdict |
|---|---|
| `currentActor()` reaches inside a tool and returns the caller's resolved grants | ✅ `rbac/context.ts` — ALS store installed by the global v1 chain; `ActorPermissions` carries `isOwner`, `legacyRole`, and `perms: Map<key, {all, spaceIds, own, ownSpaceIds}>` |
| A capability summary can be derived without new queries | ✅ `entryFor(actor, key)` (owner floor included) → the four reach flags |
| Team NAMES are available cheaply | ⚠️ **not** from the actor (ids only) → **D11**: two scoped reads |
| The denial payload can carry a real message + code | ✅ `denyMessage(key, reason)` + `permissionErrorCode(key)` + reasons `no_grant / out_of_scope / not_own`; `forbiddenFor` already packs permission+reason into `details` |
| `member.view` is the right gate for the people tool (P4) | ✅ `routes/teams.ts` gates `GET /teams` on exactly that — the tool mirrors the HTTP surface instead of inventing a rule |
| G7 is real (the directory is an existence oracle on the tool path) | ✅ `UsersRepo` contains **no** `listScopeFilter` / `spaceScopeFilter` / context import at all |
| `TeamMembershipService.directory()` is unscoped | ✅ workspace-wide by design (admin org chart) — so P4 must gate + filter, never pass it through |

### Shipped in P0
- `systemPrompt.ts` — the **P2 SPEC comment block**: the caller-block format with its
  exact sources, hard limits and privacy rule; the denial payload shape; and the
  anti-enumeration split (category denial vs ambiguous object miss). A comment, outside
  the template literal: **zero wire cost, zero behaviour change** (re-measured: still
  38,272).
- This file — decisions **locked**, D9/D10/D11 added from the verification above.

### 🐞 DEFECT-1 found while taking the baseline — **the bot mirrors Banglish** (hand to P1)

Running the gate three times showed the Bangla metric failing in **2 of 3 runs**, always on
the same question. Rather than shrug at "model variance" (this project has recorded five
wrong-measuring-stick incidents, so the metric is suspect first), the answer itself was
read. The metric was RIGHT and the bot was wrong:

> **Q** (romanized Bangla): *"ekjon ke shudhu Marketing space er access dite chai, kivabe?"*
> **A**: *"Marketing space-এ shudhu ekjon ke access dite hole, Admin বা Owner er dorkar
> hobe. Ekhane ki korben: 1. [Settings → Teams](/settings/teams) page-e jan…"*
> Bengali letters **3**, Latin **329** — **ratio 0.009**.

The bot answered in **romanized Banglish**, not Bangla script, mirroring the question's
romanization. Measured: that question flips **2 of 3 times** (ratios 0, 0.733, 0), while
other Banglish questions stay correct (0.677 / 0.790 / 0.985) — so it is question-specific
and reproducible, **not** temperature noise.

Why it matters more than the score: **this office writes in Banglish** (the user does, in
every message), so a large share of real questions arrive romanized. The prompt says
"reply in Bangla" but never says *Bangla SCRIPT, never romanized* — the rule has a hole,
and a Banglish wall of text is exactly the "confusing" experience ask #2 is meant to kill.

Also flagged from the same answer, for the P1 audit: the claim that access follows a
*"See spaces" option set to "Their spaces"* — unverified wording that may be a
fabrication, and the roster step reads garbled.

**Not fixed here by design** — a prompt/KB rule change is behaviour, which belongs to P1
(and the ⚠️ honest note: today's earlier "eval PERFECT" readings were partly luck; this is
the true starting line).

### Verified after the change
`jest.assistant` **9 suites / 145** ✅ · server `tsc --noEmit` clean ✅ · `npm run build`
clean ✅ · system message **unchanged at 38,272** ✅ (proof the spec comment costs nothing
on the wire) · eval: no metric moved because of P0 — the prompt string is byte-identical.

**Verdict: P0 COMPLETE — nothing behavioural changed; the three things P2/P3/P4 could have
gotten wrong (who builds the caller block, where team names come from, which gate the
people tool uses) are settled in code-verified writing; and the baseline is honest,
including a real defect the previous green runs had hidden. Ready for "AI deep phase 1
koren" — which now starts with DEFECT-1.**
