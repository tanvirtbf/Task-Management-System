# AI Assistant INSIGHTS PLAN — people & team analytics, permission-perfect

**Written 2026-08-19, against `main` @ `529d3ee`.** The ask (user, verbatim intent):
the bot must answer questions like —

> 1. *"@tanvir ei lok er hate ekhon ki kaj assign kora ase? tar kono due/pending kaj ase kina?"*
> 2. *"Marketing team er last 7 din e koyta task create kora hoise, ke ke assign chilo, overdue koyta ase?"*
> 3. *"@harun — ei chele tar last 1 mash er kajer update daw."*

— and **anyone may ask anything, but sees ONLY what their role permission reaches. If the
permission is missing, they cannot see it at all.** Zero bugs, best-possible UX, built in
small phases with time taken, one phase at a time.

**Working agreement for this plan:** phases ship ONE AT A TIME. Each phase ends with its own
gate green before the next begins. **If any pre-existing system issue is discovered while
building a phase, it is fixed (with its own test) BEFORE the phase continues** — that rule is
part of every phase's definition of done, not a footnote.

---

## 0) Baseline — what the pre-plan scan found (2026-08-19, all verified in code)

The foundation is already strong; this plan builds on verified facts, not hopes:

- **The permission engine is provable.** Three layers, traced in SQL this week: route-level
  `assistant.use`; **repo-level AsyncLocalStorage scoping** (`listScopeFilter` +
  `taskOwnEscape` — confirmed live in `SlaRepo`, `HomeRepo` ×5, `TasksRepo.findDetailInWorkspace`);
  per-tool asserts (`get_people` → `member.view`, etc.). Anti-enumeration doctrine:
  invisible and nonexistent answer identically. Denials are **data** (`denied(key)`), never
  throws — the executor's catch-all would otherwise flatten them into `tool_execution_failed`.
- **`get_people action=person_workload` already exists** — another person's open-task COUNT,
  scoped via `TasksRepo.countOpenAssignedVisible` (which applies `listScopeFilter`). Its
  result carries a self-describing `note` that tells the model exactly how to phrase 0 vs N
  (added + live-verified 2026-08-19). This is the *pattern* every new tool copies.
- **`SpacesRepo.listByWorkspace` is space-scope-filtered** (`spaceScopeFilter`) — a team the
  asker cannot see does not exist for them. Team-level anti-enumeration is inherited free.
- **⚠️ REUSE TRAP #1 (found in this scan):** `HomeRepo.myTasksByBucket` does **NOT** apply
  `listScopeFilter` — its `mine` condition is only workspace + assignee + not-archived. Safe
  today solely because the tool always passes `ctx.userId` (your own tasks are always yours).
  **Reusing it naively for another person would leak every space to an own-scoped asker.**
  The person-tasks query must be a scoped variant, never a parameter change.
- **⚠️ REUSE TRAP #2:** `resolvePerson` matches names via `UsersRepo.listByWorkspace q=` (LIKE
  over firstName/lastName/email) + exact-match/single-hit. `"@tanvir"` (with the `@`) matches
  NOTHING (emails contain `tanvir@`, never `@tanvir`). Mention-style handles need explicit
  support: strip a leading `@`, and exact-match against the email local-part.
- **Both prompt budgets are effectively FULL** (measured): system message **47,940 / 48,000**
  chars (~60 headroom); tool definitions **7,744 / 8,000** (256 headroom). Every phase that
  touches either MUST move the ceiling in `kb-coverage.test.ts` with the file's documented
  paper-trail comment convention — never squeeze correctness to dodge a budget.
- **No date-window primitives exist** in the repos (created-in-window / completed-in-window,
  per person or per space). They are new, built in the proven scoped-query style.
- The graders exist and are extendable: `assistant-eval.cjs` (quality vs live KPI truth),
  `assistant-role-matrix.cjs` (same question as every role, verdict vs the API's own truth),
  jest `tests/assistant/**` (14 suites / 227 — green this week), `route-parity` drift guard.
- Model = `gpt-4o-mini`: tool-routing needs explicit triggers in descriptions, and answer
  phrasing needs verdicts embedded in tool RESULTS (both lessons already paid for this week).

## 1) Doctrine — every phase obeys these

1. **Permission lives in SQL, never in prose.** Every read the new tools make goes through a
   repo method that applies `listScopeFilter(tasks.primaryListId, await taskOwnEscape())`.
   The model can phrase an answer wrong; it must never be ABLE to fetch beyond the asker.
   (`taskOwnEscape` is ALS-keyed to the ASKER — including it matches the UI exactly: you also
   see foreign-space tasks you are personally attached to.)
2. **The visible-zero rule.** A scoped asker's 0 is ambiguous (truly none OR outside their
   view). Every count/list result carries a `note` that dictates the honest phrasing — the
   `person_workload` pattern, verbatim.
3. **Anti-enumeration.** Unknown person → "no active member matching…" (roster is
   `member.view`-gated first). Invisible team → the same `not_found` as a nonexistent team.
   Never confirm existence of what the asker cannot reach.
4. **The server does the arithmetic.** Date windows arrive as `window_days` (integer, 1–92,
   server-clamped) — never model-computed date strings; "today" = the workspace's canonical
   clock (`todayInZone`, the F3/F5 doctrine). Counts/breakdowns are computed in SQL and
   returned as named fields; the model only narrates.
5. **Caps with honesty.** Lists cap (15 tasks / 8 assignee-breakdown rows) and every capped
   result says `more: true` — a truncation the reader can see is not a lie.
6. **Tools return data, never throw** (executor catch-all rule). Refusals = `denied(key)`.
7. **Found-issue protocol.** Any pre-existing bug encountered → fix + regression test +
   note in §6 of this file → then continue the phase. No "later".
8. **One phase per go.** Each phase ends: tsc clean · targeted jest green · phase gate green ·
   this file updated with an execution record. Commit per phase (convention: dist rebuilt
   in-commit when shipping).

## 2) The phases

### P0 — Decisions locked + measured baseline *(no product change)*
**Goal:** freeze the contract so later phases build the designed thing, and pin the numbers
every later diff is judged against.
**Steps:** run `assistant-eval.cjs --assert` + `assistant-role-matrix.cjs` on the live dev
stack and record verdicts here; record exact budget numbers; lock §3 decisions; write the §4
acceptance set (the user's three questions verbatim + role-variants).
**Gate:** baseline recorded in §5; both graders' current verdicts known (eval was PERFECT and
matrix ALL-PASS on 2026-08-19 — re-confirm on the day P0 runs).
**Files:** this file only.

### P1 — The scoped repo layer *(the correctness core — smallest possible surface)* — ✅ **COMPLETE 2026-08-19**

**Shipped:** `TasksRepo.personTasksVisible` (buckets open/overdue/due_soon/completed,
completed windowed on `completed_at`, `listScopeFilter + taskOwnEscape` in the WHERE,
myTasks ordering) and `TasksRepo.teamWindowStats` (createdCount + ≤10 sample +
assignee breakdown over the FULL created set + overdue-now + completed-in-window, all
behind the same visibility filter). New suite `tests/assistant/insights-repo.test.ts` —
**13 tests, all against SQL truth** via `getPolicy().principalFor` + `runWithPrincipal`:
unrestricted/space-scoped/own-scoped intersections, the own-escape co-assignment case,
archived exclusion, window edges (in/out/exact-boundary), ordering, limits, and the
own-scoped-outsider-gets-zeros defense. **Gate met:** full `jest.assistant` **15 suites /
240 tests green** (baseline 227 + 13) · tsc clean · server eslint total still exactly 70
(no new debt).

**Goal (as planned):** the two queries everything else rides on, each provably asker-scoped.
**Steps:**
1. `TasksRepo.personTasksVisible(targetUserId, workspaceId, bucket, today, {sinceYmd?, untilYmd?}, limit)`
   — a **scoped sibling** of `myTasksByBucket` (join assignees/status/list/space; same
   projection incl. `statusName/listName/spaceName/dueDate/reviewStatus/checklist`), plus
   `listScopeFilter + taskOwnEscape` in the WHERE (trap #1's fix), plus a
   `completed`-bucket variant windowed on `completedAt` (for "last 1 mash er kajer update").
   Buckets: `open | overdue | due_soon | completed`.
2. `TasksRepo.teamWindowStats(spaceId, workspaceId, sinceYmd, todayYmd)` — over **visible
   tasks only** (same filter): `createdCount` + up to 10 created rows
   `{id, name, createdByName?, assigneeIds}`, `assigneeBreakdown` (distinct assignee → count,
   top 8), `overdueNowCount` (+ top 5 names), `completedCount`.
   (Two SQL statements are fine; one method.)
**Tests (jest, `tests/assistant/` — the SQL-truth style):** for each of the three reach shapes
(`all` / `space` / `own`): person-tasks returns exactly the intersection rows; own-scope +
co-assigned foreign task appears (ownEscape); team stats count only visible tasks; windows
inclusive; archived excluded; closed-vs-open per `statusGroup ∉ CLOSED_GROUPS`.
**Gate:** new jest file green + `tsc` clean. **No tool exposure yet** — nothing user-visible
can break.

### P2 — `resolvePerson` learns mention handles *(tiny, isolated)* — ✅ **COMPLETE 2026-08-19**

**Shipped:** one leading `@` stripped before the search; an email-local-part **exact match**
now sits before the name ladder, so `"@arif"` resolves Arif Chowdhury even beside an Arifa
(previously ambiguous), while two people sharing a local-part across domains stay honestly
ambiguous. `@me` untouched (checked before stripping). Failure messages still echo exactly
what the user typed. Reaches every person-taking tool for free: `get_people` (find_person /
person_workload / team_roster) and `create_task` assignees. **5 new tests** in
`team-data-tools.test.ts` (handle-beats-ambiguity, @Full Name, unknown echo, local-part
collision, @me untouched). **Gate met:** full `jest.assistant` **15 suites / 245 tests
green** · tsc clean · eslint total still exactly 70.

**Goal (as planned):** `@tanvir`, `@harun` resolve exactly like the comment-mention tokens.
**Steps:** strip one leading `@` from `wanted`; add email-local-part **exact match** to the
match ladder (before the ambiguity failure); keep every existing behaviour (`@me`, full name,
surname fallback, single-hit, ambiguity candidates).
**Tests:** extend the existing tool tests: `@<email-local>` resolves; `@Full Name` resolves;
ambiguous stays ambiguous; unknown stays "no active member".
**Gate:** jest file green; `create_task`/`get_people` behaviour unchanged (their tests re-run).

### P3 — Tool `get_person_tasks` *(the "@tanvir er hate ki kaj" answer)* — ✅ **COMPLETE 2026-08-19**

**Shipped:** the 11th tool — `{person_name, bucket?: open|overdue|due_soon|completed,
window_days?}` → `member.view` assert → `resolvePerson` (@handles work, P2) →
`personTasksVisible` (P1's scoped SQL) → capped 15 rows + `more`, per-task
name/url/list/team/status/dueDate/priority/review (+`completedOn` in completed), and the
visible-zero `note`. Garbage bucket / window_days come back as **guidance** (never a silent
default, never a throw); `window_days` clamps 1–92, default 30, rolling window ending now;
"overdue" runs on the workspace clock via the new public `HomeService.todayFor`.

**Pulled forward from P5 (self-contradiction would have shipped otherwise):** the system-prompt
sentence claiming "no tool gives another person's task LIST" now routes to the new tool — and
SHRANK the system message 47,940 → **47,859** (headroom 60 → 141); `person_workload`'s
description cut to the quick count it is. Tool-def ceiling moved 8,000 → **9,000** with the
paper-trail comment (measured after: **8,422**).

**Gate met:** new `person-tasks-tool.test.ts` **10 tests** (denial shape, all/space-scoped row
sets, @handle, overdue, completed+window+clamp, visible-zero note, caps+more, unknown echo,
garbage guidance) + 4 new robustness GARBAGE cases (the completeness guard caught the missing
coverage exactly as designed) → full `jest.assistant` **16 suites / 259 green** · tsc clean ·
eslint total still exactly 70. Test-authoring note: `userWithPermissions` users need an explicit
`"assistant.use"` grant to pass the route gate.

**Goal (as planned):** LIST + counts of one person's work, asker-scoped, honestly phrased.
**Definition:** params `{person_name, bucket?: open|overdue|due_soon|completed,
window_days?: int}` (window only meaningful for `completed`; server clamps 1–92, default 30).
Executor: `member.view` assert (the `get_people` precedent) → `resolvePerson` →
`personTasksVisible` → result `{person, bucket, count, more, tasks:[{name, url:"/t/<id>",
status, list, team, dueDate, review}], note}` where `note` encodes doctrine #2 (0 = "outside
your view OR truly none — never say they have none"; N = "N that YOU can see").
Description carries the routing triggers: *"X er hate ki kaj / ki assign / due-pending kaj /
last N diner kajer update / X ke koto kaj diyeche — ALWAYS this for another person's task
LIST or history; get_my_tasks is the caller's OWN; person_workload stays the quick count."*
**Budget:** move the tool-def ceiling (measured, expect 8,000 → ~9,000) with the paper-trail
comment in `kb-coverage.test.ts`.
**Tests:** tool-level jest — denial without `member.view`; scoped member vs admin row sets
(SQL truth); `@handle` path; completed-window; caps + `more`; unknown person; the
`tool-roundtrip`/`tool-robustness` suites extended so bad args (`bucket:"kal"`,
`window_days:"7din"`) come back as guidance, never a throw.
**Gate:** full `jest.assistant` config green (all suites, not just new ones).

### P4 — Tool `get_team_stats` *(the "Marketing last 7 din" answer)* — ✅ **COMPLETE 2026-08-19**

**Shipped:** the 12th tool — `{team_name, window_days? (default 7, clamp 1–92)}` →
`member.view` assert (the breakdown names people; counts must not bypass the roster gate) →
team resolved ONLY through the scoped spaces list (exact match, then single-substring
forgiveness, several visible hits → candidates, zero → the ambiguous `space.not_found`) →
P1's `teamWindowStats` → created {count, ≤10 tasks w/ creator+url, byAssignee ≤8 names},
overdueNow {count, ≤5}, completedInWindow, and a note carrying BOTH doctrines: scoped
undercount honesty + "a 0 is data, never a permission problem".

**Gate met:** new `team-stats-tool.test.ts` **8 tests** — denial shape; seeded-truth numbers
(archived excluded, names hydrated, urls); own-team scoped member = same truth; **foreign
team ⇒ not_found with zero names in the payload; nonexistent team ⇒ byte-identical shape**;
empty team = honest zeros; substring forgiveness; garbage guidance — plus 3 robustness
GARBAGE cases. Full `jest.assistant` **17 suites / 270 green** · tsc clean · eslint still
exactly 70. Tool-def budget: description trimmed 73 chars first, then the ceiling moved
9,000 → **9,500** with the amended paper trail (measured after: **9,020**); system message
untouched at 47,859.

**Goal (as planned):** per-team window analytics, team-invisibility preserved.
**Definition:** params `{team_name, window_days?: int (default 7, clamp 1–92)}`. Executor:
resolve the team through **scoped** `SpacesRepo.listByWorkspace` + `exactMatch` (invisible ⇒
the ambiguous `space.not_found`, doctrine #3); then `teamWindowStats`; result
`{team, windowDays, created:{count, tasks:[…≤10], byAssignee:[{name,count}…≤8]},
overdueNow:{count, tasks:[…≤5]}, completedInWindow:{count}, note}` — the note states the
counts cover only what the ASKER can see. Assignee/creator ids hydrate to names via
`findManyByIdsInWorkspace` (never emails).
**Tests:** own-scoped member asking own team = real numbers; asking a foreign team =
`not_found` (and the ROSTER-less wording — no names leaked); admin = full numbers; window
edges; empty-window honesty ("0 created" ≠ permission problem — doctrine #2's sibling,
the reports-tool lesson).
**Gate:** full `jest.assistant` green + tool-def budget re-measured.

### P5 — Prompt routing + discoverability *(the UX phase)* — ✅ **COMPLETE 2026-08-19**

**Shipped:** the system prompt's "Which tool" line now routes both new families —
*another person's task list/pending/history → get_person_tasks · a team's
created/assigned/overdue in a window → get_team_stats* (system message 47,970 / 48,000,
headroom 30 — inside the guard, no ceiling move needed). Two starter chips in
`suggestions.ts`: the person question offered to everyone (names nobody, so the bot's own
"which person?" follow-up teaches the @name pattern) and the team-window question gated on
`isHead`. KB untouched — the plan's only-if-eval-shows-gaps rule; P6's eval decides.

**Gate met:** client vitest **49/49** (13 in the suggestions suite, +2) · client tsc/lint
clean · full `jest.assistant` **17 suites / 270 green** (kb-coverage's 48k assert and
route-parity both pass with the new prompt) · eslint total still exactly 70.

**Goal (as planned):** the model reliably picks the right tool, and users learn these
questions exist.
**Steps:** system-prompt "Which tool" line gains the two tools *(the person_workload division
of labour and the "no tool for lists" sentence were already fixed in P3 — this phase adds only
the team-stats routing)*; `suggestions.ts` chips + its vitest updated with one person-question
and one team-question example; KB gains 2–3 sentences ONLY if eval shows guidance gaps
(budget: move the system ceiling with paper trail only if actually needed — P3 left headroom
at 141).
**Tests:** `kb-coverage`/`route-parity` green; client vitest green; budget assertions updated.
**Gate:** jest.assistant + client vitest green.

### P6 — The graders learn the new surface *(tests-first hardening)* — ✅ **COMPLETE 2026-08-19**

**Shipped:** `assistant-role-matrix.cjs` gained two cells with per-asker API-swept truth
(the asker's own scoped `/spaces → /lists → /tasks` view, so every reach shape produces
its own expected value automatically): **person** ("<target> er hate ekhon ki kaj ache?
list dao" — task-link count must equal the swept truth, capped 15; truth 0 ⇒ ZERO links)
and **teamStat** ("Marketing team e last 7 dine koyta task create hoyeche?" — visible team
⇒ the swept number; invisible ⇒ REFUSED with zero exclusive-member names).
`assistant-eval.cjs` §B gained the same two questions with owner-swept truths (targets
now 11 of 12).

**Live results:** eval → **PERFECT** (both insights questions correct; the one absorbed
miss was the pre-existing "team er koto gulo" phrasing variance). Matrix → **ALL CELLS
PASS twice consecutively**; the person column reads exactly like the permission model:
owner/admin **3/3**, head & 2-team member **0/0 with zero links** (target's team outside
their reach — the honest can't-see answer), 1-team member (self) **3/3**; teamStat: all
visible roles matched the swept 0, the scoped outsider got `hidden OK` (refused, no leak).

**Grader gap found & fixed (§6):** both scripts' SAYS_NONE lacked **হয়নি** — the natural
Bangla zero for "koyta create hoyeche" — scoring a verified-correct answer as a miss;
joined in both, mirrored comments. eslint total still exactly 70.

**Goal (as planned):** regressions become impossible to miss.
**Steps:** `assistant-role-matrix.cjs` gains cells: `personTasks` ("<seeded member> er hate
ekhon ki kaj ache? list dao") verified against the API truth per role, and `teamStats`
("<own team> er last 7 dine koyta task create hoise?") — the own-scoped member's foreign-team
variant must come back refused/not-found with **zero leaked names** (the existing `leak`
cell's method). `assistant-eval.cjs` DATA_QUESTIONS gains person/team questions with truth
computed from the API (not hardcoded).
**Gate:** matrix ALL CELLS PASS · eval PERFECT — run twice to smoke out formatting variance
(the known gpt-4o-mini step/link flakiness is measured, not gate-breaking; content must be
100%).

### P7 — Live multi-role verification *(the user's questions, verbatim)* — ✅ **COMPLETE 2026-08-20**

**Shipped:** seeded 5 dated `INSIGHT *` tasks into Marketing/Influencer-Outreach (2 assigned
Sumaiya + 1 Nusrat + 1 unassigned + 1 completed→backdated 10 days via direct
`UPDATE tasks SET completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY)`), snapshotted
SQL ground truth (`E:/tmp/p7-truth.json`), then ran the §4 set live through the REAL route
as owner, Marketing head (Nusrat) and own-scoped outsider (Arif) via `E:/tmp/p7-accept.cjs`.

**Result: 17/17 verdicts PASS**, every number == SQL truth (truth columns now filled in §4):
owner's A1 linked exactly 8 tasks incl. both INSIGHT names + the overdue signal; Arif's A2/A4
leaked zero rows/names with honest phrasing; A3 matched created=5 · Sumaiya=3/Nusrat=1 ·
overdue=10 for both owner and head; head's A5 linked exactly the 3 completed-in-window tasks
incl. the backdated one; A6 garbage (@keu-na, 999 din) stayed graceful ×2 with the 92-day
clamp. Widget evidence: `E:/tmp/p7-A1-owner.png` (৮টি + links rendered), `p7-A4-arif.png`
(refusal, zero names), `p7-A3-head.png` (send+stream wiring). Seed cleaned after: 5 tasks +
4 assignees + 4 watchers + 11 activity + 6 notifications deleted, `INSIGHT%` count back to 0 —
demo baseline restored for P8's graders. No source changed in this phase.

**Goal (as planned):** prove the three headline questions with seeded ground truth, as three roles.
**Steps:** seed a dated task set (the FILTERTEST method — created/assigned/overdue/completed
across two teams, cleaned after); run the §4 acceptance set via live probes as owner, a head,
and an own-scoped member; verify every number against direct SQL; screenshot the chat panel
for the record. Any mismatch = a P1–P5 bug: fix, add the missing test, re-run.
**Gate:** acceptance table in §4 fully ✅ with DB-truth columns filled in.

### P8 — Ship gate — ✅ **COMPLETE 2026-08-20 — PLAN DONE, feature SHIPPED**

**Every gate green, measured on the cleaned demo baseline:**

| Gate | Result |
|---|---|
| `jest.assistant` (full) | **17 suites / 270 tests — all pass** |
| `jest.collab` (comments/mentions) | **5 suites / 59 tests — all pass** |
| client vitest | **7 files / 49 tests — all pass** |
| tsc server + client | **clean ×2** |
| eslint | server **exactly 70** · client **12** — the pre-existing baseline, untouched |
| `assistant-eval.cjs --assert` | run 1: steps 12/13 (the known model formatting flake, content 100%) · **run 2: VERDICT PERFECT** (links 16/16 · steps 13/13 · Bangla 16/16 · data 11/12 ≥ target · 0 fabricated · 0 leaked) — exit code read directly, not through a pipe |
| `assistant-role-matrix.cjs` | **ALL CELLS PASS** — person column reads like the permission model (owner/admin 3/3 · head & 2-team 0/0 zero-link honest · 1-team self 3/3), teamStat all-visible matched, scoped outsider `hidden OK` |
| dists | rebuilt from HEAD → **byte-identical** to what P1–P6 commits already carry (git diff empty — committed artifacts == source, proven) |
| docs | `ASSISTANT_TEAM_NOTE.md` gained **§৩ কারো কাজের খবর, টিমের হিসাব** (both question families, @-handle usage, window phrasing, the honest-undercount + can't-see-team caveats, Bangla); sections renumbered ১–৭ |
| deploy | `DEPLOY_PROMPT_2026-08-19.md` re-pinned to the final SHA + insights bullet (zero DB changes, zero env vars — ships inside the artifacts already in git) |

**Goal (as planned):** the same bar every assistant change has met.
**Steps (as planned):** full `jest.assistant` + collab suites · eval `--assert` PERFECT · matrix ALL PASS ·
tsc ×2 · dist rebuilt · commit/push (feature message + this plan's execution records) ·
`DEPLOY_PROMPT` re-pinned · memory updated. Docs: `ASSISTANT_TEAM_NOTE.md` gets the two new
question families (Bangla, the team-facing file).

## 3) Decision log — 🔒 locked 2026-08-19 (overridable only by the user)

| # | Decision | Why |
|---|---|---|
| D1 | Two new tools (`get_person_tasks`, `get_team_stats`), not a generic query tool | Permission provable per query shape; free-form = unprovable |
| D2 | `person_workload` STAYS (quick count); new tool owns lists/history | Zero regression risk to a live-verified behaviour |
| D3 | Person questions gate on `member.view` + SQL intersection with asker's `task.view` reach | Mirrors `get_people`/UI exactly |
| D4 | Team resolution through scoped spaces; invisible team = `not_found` | Anti-enumeration doctrine, already live for rosters |
| D5 | `taskOwnEscape` INCLUDED in the person/team queries | ALS = asker-keyed; matches what the asker's own UI shows |
| D6 | Windows as `window_days` int, server-computed on the workspace clock | Model date-math is the known weak spot |
| D7 | Caps 15/10/8/5 with `more:true` | Chat-sized answers; honesty about truncation |
| D8 | Budget ceilings MOVE (with kb-coverage paper trail), content never squeezed | The test file's own documented convention |
| D9 | No client code changes except `suggestions.ts` chips | The chat UI already renders everything needed |
| D10 | No DB schema change anywhere in this plan | Pure read-layer feature |

## 4) Acceptance set — ✅ **all truth columns filled & PASSED, P7 2026-08-20** (17/17 verdicts, `E:/tmp/p7-accept.cjs`)

| # | Question (as the user wrote it) | Asked as | Expected shape | DB truth (SQL snapshot) | Live answer | ✓ |
|---|---|---|---|---|---|---|
| A1 | "@sumaiya er hate ekhon ki kaj assign kora ase? due/pending kaj ase kina?" | owner | real list + overdue count, links | open=**8**, overdue=**7** | ৮টি + exactly 8 task links + overdue signal, INSIGHT alpha/beta named | ✅ |
| A2 | same | Arif (own-scoped, CS-only) | honest "outside your view" phrasing, zero fabricated rows | visible-to-Arif=**0** | 0 links, no counts invented, honest phrasing | ✅ |
| A3 | "Marketing team er last 7 din e koyta task create hoise, ke ke assign chilo, overdue koyta?" | owner **and** head (Nusrat) | counts + assignee breakdown + overdue, all == SQL | created=**5** · Sumaiya=**3**/Nusrat=**1** · overdue=**10** | both askers: 5 / Sumaiya 3 + Nusrat 1 / 10 | ✅ |
| A4 | same | Arif (not on Marketing) | not-found/denied, **zero team-member names leaked** | — (team invisible to asker) | refused, zero Marketing-exclusive names (screenshot) | ✅ |
| A5 | "@sumaiya er last 1 mash er kajer update daw" | head of Marketing (Nusrat) | completed-in-window + open + overdue summary | completed-in-30d=**3** (incl. backdated INSIGHT epsilon) | exactly 3 completed links incl. epsilon + open/overdue summary | ✅ |
| A6 | nonsense window/person ("@keu-na", "last 999 din") | owner | graceful guidance, no crash, clamp to 92 | n/a | graceful ×2, window clamped to 92, no crash | ✅ |

## 5) P0 execution record — ✅ COMPLETE 2026-08-19 (@ `529d3ee`, no code changed)

Every later phase diffs against these measured numbers:

| Baseline | Value |
|---|---|
| `assistant-eval.cjs --assert` | **VERDICT: PERFECT** — links 16/16 · steps 13/13 · Bangla 16/16 · data 10/10 · refusals 2/2 · fabricated routes 0 · leaked names 0 |
| `assistant-role-matrix.cjs` | run 1: 1 cell (member-2-teams `howto`, the measured link-formatting variance) · **run 2: ALL CELLS PASS** — content was correct both runs; the flake is formatting-only and known |
| jest `jest.assistant.config.cjs` | **14 suites / 227 tests — all pass** |
| system message (via `buildMessages`, on the wire) | **47,940 / 48,000 chars — headroom 60** |
| tool definitions (`JSON.stringify(ASSISTANT_TOOL_DEFS)`) | **7,744 / 8,000 chars — headroom 256** |
| tool count | **10** |

Decisions §3 (D1–D10) locked; acceptance set §4 written; found-issue log §6 opened with the
two pre-scanned traps. **Gate met — P1 may begin on the next go.**

## 6) Issues found along the way — (append-only during P1–P8)

*(Per doctrine #7: pre-existing bugs found while building get fixed + tested + logged here
before the phase continues. Two already found by the pre-plan scan and folded into the design
rather than left as bugs: the unscoped `myTasksByBucket` reuse trap and the `@handle`
resolution gap — see §0.)*

- **P6 (2026-08-19) — the graders' SAYS_NONE missed a real Bangla zero.** Both
  `assistant-eval.cjs` and `assistant-role-matrix.cjs` treated only নেই/নাই/শূন্য as
  "none", so "কোনো টাস্ক তৈরি **হয়নি**" — the natural (and live-verified CORRECT) answer to
  "koyta create hoyeche?" when the count is 0 — scored as a miss. `হয়নি` joined in both
  scripts. The measuring stick again: a metric that maligns a right answer is worse than
  no metric.
- **P1 (2026-08-19) — MySQL TIMESTAMP boundary rounding.** `TIMESTAMP` columns round
  sub-second values to the nearest second, so a row written EXACTLY on a window boundary
  with a wall-clock `Date` (carrying milliseconds) can land on either side — the
  window-exclusion test passed solo and failed in the full run. Not a product bug (real
  windows never race their own seed data), but a determinism rule for every future
  window test: **align the test's reference `now` to a whole second.** Fixed in
  `insights-repo.test.ts` with a comment carrying the rule.
