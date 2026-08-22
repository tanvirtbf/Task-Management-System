# ASSIGNED BY — who handed this work out

**Written 2026-08-22, against `main` @ `c357ccf`.** The ask (user, verbatim intent):

> A supply-chain team member gives a task to the software team. The software person may not
> actually do it — **but right now you cannot see who assigned it.** So every task needs an
> **Assigned By**. Whoever creates the task automatically becomes its Assigned By, and if someone
> wants, they can change it. **Every task must have it.**

**Working agreement for this plan:** phases ship **ONE AT A TIME**, on an explicit go. Each phase
ends with its own gate green before the next begins. **If a pre-existing system issue is found
while building a phase, it is fixed (with its own test) BEFORE the phase continues** — that rule is
part of every phase's definition of done, not a footnote.

---

## 0) Baseline — what the pre-plan scan found (2026-08-22, all verified in code and in the live DB)

This feature is far cheaper than it looks, because three things are already true:

- **⭐ The attribution data ALREADY EXISTS.** `task_assignees.assigned_by` is a real column, written
  on **every** assignment path (`TaskMembershipRepo:35` at create, `:199` on add-assignees), and it
  is **100% populated** in the live database — 46 of 46 rows, zero nulls. It is simply **never put
  on the wire and never shown**. The backfill therefore has real history to draw on, not guesses.
  Its `onDuplicateKeyUpdate` deliberately keeps the ORIGINAL assigner when someone is re-added —
  the same semantics this feature wants.
- **⭐ One serializer feeds every task surface.** `serializers/taskSerializer.ts → toWireTask(t, h)`
  is called from **8 services** — Tasks (×4), TaskWrite, Home, Search, Reviews, Engineering,
  TaskDependencies. A column on `tasks` reaches List, Board, Calendar, drawer, search, home agenda,
  dept queue, SLA queue and the dependency tree **through one line**. (The one exception:
  `assignmentRequestSerializer.toWireTaskSnapshot` builds its own smaller shape — P3 must not
  forget it.)
- **⭐ The client needs no mapper work.** The HTTP layer's camelCase interceptor turns `assigned_by`
  into `assignedBy`, and `mapTask` spreads `...base`, so the field arrives on the FE `Task` the
  moment the server emits it. Only the **type** has to learn about it.

Also established by the scan:

- **Every task creation path funnels through `TaskWriteService.create({ actorId, … })`** — the API,
  public **forms** (`actorId: form.createdBy`), the **recurrence-spawn** job
  (`actorId: template.createdBy`), and the assistant's `create_task`. There is exactly **one**
  `insert(tasks)` in the codebase (`TasksRepo:315`). So "default to the creator" is a one-place change.
- **`tasks` has `created_by`, and no `assigned_by`.** Nothing else on the table is close.
- **The assignment email already names the assigner** (`TaskEmailService` builds `assignerName` from
  the actor) — so the concept exists in notifications and only the record is missing.
- **Editing is already gated** by the own-scope rule (`403 task.forbidden` proved live: a member
  patching a teammate's task is refused) plus the head/admin allow-path (`useCanEditTask`, G4).
  No new permission key is needed.
- **The drawer already renders "Created by"** (`TaskDetailDrawer.tsx:681`) — there is a meta area to
  extend rather than invent.
- Baseline to hold: **eslint exactly 70 server + 12 client** errors (pre-existing), `db:setup`
  canonical **47 tables**, next upgrade number is **025**.
- ⚠️ **Trap (from the 08-22 scan):** the deploy prompt's canary (`GET /api/v1/tasks` → expect 401)
  **cannot fail** — that route does not exist and 404s either way. This feature's rollout must use
  a real canary (`/api/v1/auth/me` → 401, then an authenticated list read). See P8.
- ⚠️ **Trap:** dev mention/assignment emails go through **live Mailtrap** — never test delivery
  against `@beautybooth.com.bd` users.

---

## 1) Doctrine — the rules every phase obeys

1. **One phase per go.** Nothing starts without the user's word.
2. **Every task has an Assigned By, always.** No blank state anywhere in the UI: the wire falls back
   to `created_by` if the column is somehow null, so a task can never render an empty attribution.
3. **The record is an accountability surface, so every change is audited.** Changing Assigned By
   writes a `task_updated` activity row with before/after, exactly like the comment system's
   "(edited)" doctrine — a wrong change must be visible and attributable, not silent.
4. **Assignment ≠ attribution.** Adding or removing assignees later never rewrites Assigned By.
   Only an explicit edit changes it.
5. **No new permission key, no new table, no schema drift.** One column, one upgrade file, and the
   three-synchronized-edits rule (`schema.sql` + Drizzle + upgrade script) from
   `database/upgrades/README.md`.
6. **Scope discipline.** Reads first, writes second, extras last: nothing in P4 can change data,
   nothing in P6 is required for the feature to be usable.
7. **Found-issue protocol.** A pre-existing bug discovered mid-phase gets fixed + tested + logged in
   §6 before the phase continues.
8. **Backfill from truth, not convenience.** Existing tasks get the assigner history that already
   exists in `task_assignees`, and only fall back to `created_by` where there is none.

---

## 2) Phases

### P0 — Baseline, decisions, acceptance set
**Goal:** nothing can drift unnoticed later.
**Steps:** record the measured baseline (jest suite/test counts for tasks · forms · jobs · rbac ·
assistant, client vitest count, eslint 70/12, tsc ×2 clean, table count 47); lock the decisions in
§3; write the acceptance set in §4; open the issues log in §6.
**Gate:** §5 filled with real numbers. No code changes.

### P1 — The column and the backfill — ✅ **COMPLETE 2026-08-22**

**Shipped:** `database/upgrades/025_assigned_by.sql` (ALTER → backfill → FK, in that order so the
constraint validates final data), mirrored into `database/schema.sql` (column after `created_by`,
`fk_tasks_assigned_by` ON DELETE SET NULL, `idx_tasks_assigned_by`) and
`server/src/db/schema/tasks.ts` — the three synchronized edits, plus the README applied-state row.

**Applied to dev:** 47 tasks, **0 unattributed**, 0 values without a matching user, FK rule
`SET NULL`, index present — exactly what P0's read-only dry-run predicted.

**Parity proved, not assumed:** a scratch database built from the edited `schema.sql` through the
harness's own `cleanSql` came out **column-for-column and index-for-index identical** to the dev
database upgraded by `025`, still **47 tables / 5 views**. `db:setup` builds from the same file, so
fresh installs and all 31 per-suite test databases are covered by that one edit.

**Tests:** `tests/tasks/assigned-by.test.ts` — **9 new tests, all green**. They do not re-type the
backfill: the `UPDATE` is **extracted from the shipped upgrade script**, so what runs in the test is
the statement production will run, and moving it without re-reading the expectations fails the
build. Covered: the column reaches `TaskRow`; a real assigner who is *not* the creator survives;
the **earliest** assigner wins when work was handed on twice; `created_by` is the fallback both for
never-assigned tasks and for legacy assignee rows with a NULL assigner; nothing is left
unattributed (doctrine #2); a value already set is never overwritten (so re-running the script is
safe); and deleting the assigner NULLs the attribution instead of blocking the delete.

**Gate:** tasks suite **14 suites / 409 tests green** (P0's 13/400 + this file's 9), run as four
foreground chunks per P0's environment note · eslint still exactly **70** · tsc clean · canonical
count still **47**. The I-1 timeout fix was confirmed in passing: the test that used to fail took
**16.8s** in a three-file run (4.2s alone), which is why 30s was the wrong budget and 60s is right.

**Goal (as planned):** the data exists and is right, before anything reads it.
**Steps:** `database/upgrades/025_assigned_by.sql` — add `assigned_by VARCHAR(64) NULL` to `tasks`,
FK to `users(id)` `ON DELETE SET NULL` (a departed manager must not delete the task), plus an index
for the P6 filter. Backfill in the same script:

```sql
-- earliest real assigner wins; creator is the fallback
UPDATE tasks t
   SET t.assigned_by = COALESCE(
       (SELECT ta.assigned_by FROM task_assignees ta
         WHERE ta.task_id = t.id AND ta.assigned_by IS NOT NULL
         ORDER BY ta.assigned_at ASC, ta.user_id ASC LIMIT 1),
       t.created_by)
 WHERE t.assigned_by IS NULL;
```

Mirror the column into `database/schema.sql` (tasks §) and `server/src/db/schema/tasks.ts` — all
three edits in the same commit, per the README rule.
**Tests:** a repo test that reads the column; a backfill test that proves both branches (a task
whose assigner ≠ creator keeps the assigner; a task with no assignees falls back to the creator).
**Gate:** dev + test DBs at 025 · `db:setup` still canonical **47 tables** · tasks suite green ·
eslint still 70/12.

### P2 — The write path: every new task is attributed — ✅ **COMPLETE 2026-08-22**

**Shipped:** `assignedBy: input.actorId` beside `createdBy` in the task insert — which is the whole
change, because every route into task creation already carries the right actor: the API (the
logged-in person), a public form (`form.createdBy` — never the anonymous submitter), the
recurrence job (`template.createdBy`) and the assistant's `create_task` (the person asking).

**Correction to P0's scan:** there are **TWO** services that insert a task, not one. P0 read
"exactly one `insert(tasks)`" — true of the repo method, but `TemplateApplyService` calls it as
well as `TaskWriteService`. Applying a template is someone putting work into the world, so it sets
the actor too. Without this, template-created tasks would have been the one silently unattributed
kind. Logged as the reason P2 greps for callers rather than trusting a count.

**D6 needs no code.** `AssignmentRequestsService.accept` adds the assignee and never touches the
task row, so the decider can never become the attribution. The per-assignee `task_assignees.
assigned_by` records the approver (who executed it) while `tasks.assigned_by` keeps the requester
(who decided the work should go there) — both statements are true, and they answer different
questions.

**Tests — 4 new, 4 assertions added, each where its path actually runs:**

| Path | Where | What it pins |
|---|---|---|
| API create | `tasks/create.test.ts` | creator is recorded, and equals `created_by` at birth |
| Public form | `forms/public-submit.test.ts` | the form's **owner**, never the anonymous submitter (D8) |
| Recurrence job | `jobs/recurrence-spawn.test.ts` | each occurrence inherits the template's owner (D7) |
| Assistant | `assistant/create-task-tool.test.ts` | the **person** who asked — the bot is a tool, never the assigner |
| Template apply | `templates/apply.test.ts` | whoever applied it (the second insert path) |
| Adding assignees | `tasks/assignees.add.test.ts` | three real POSTs, including re-adding — attribution unmoved (D11) |
| Approval accept | `rbac/p8-approval.test.ts` | the **decider never** becomes the assigner; the requester stays (D6) |

**Gate:** tasks **14 suites / 411 tests** · forms **8 / 85** · jobs **7 / 54** · templates **6 /
123** · rbac **19 / 346** · assistant **17 / 270** — all green · eslint still exactly **70** · tsc
clean. Found and fixed on the way: **I-2** (§6), the forms suite's own version of the I-1 timeout.

**Goal (as planned):** from now on the column is always correct without anyone thinking about it.
**Steps:** `TaskWriteService.create` sets `assignedBy = actorId` — which automatically gives the
right answer for all four creation paths (API, public form → form owner, recurrence spawn →
template owner, assistant `create_task` → the asking user). Assignee add/remove paths explicitly do
**not** touch it. Cross-team assignment that goes through the approval gate keeps the **requester**
as Assigned By when the approval later lands (D6).
**Tests:** one per creation path (4) + "adding an assignee later leaves Assigned By alone" +
"approving a cross-team request does not make the approver the assigner".
**Gate:** jest `tasks` · `forms` · `jobs` · `assistant` suites green.

### P3 — The wire and the types — ✅ **COMPLETE 2026-08-22**

**Shipped:** `assigned_by: t.assignedBy ?? t.createdBy` in `toWireTask`, plus the field on `WireTask`
and on the client's `Task`. That is the whole change — the fallback lives at the **one** boundary
every task crosses instead of in seven surfaces that would each have to remember it, and the
camelCase interceptor means the client needed **no mapper work at all**, exactly as P0 predicted.
`assignmentRequestSerializer.toWireTaskSnapshot` was checked again and still needs nothing (the
approval card already renders "requested by X", who by D6 *is* the Assigned By).

**The parity guard already existed — twice — and both fired.** `get-by-id.test.ts` and
`list-by-list.test.ts` each assert `Object.keys(body).sort()` against an exact list, so adding a
field to the serializer **failed the suite until the key was declared**. That is precisely the
"can never silently disappear" property P3 was asked for, and it was already in the repo: no new
guard was invented, two were updated (47 → **48** wire fields, in the lists, the comments and the
test names).

**Tests:** the two key-set guards, plus two at the endpoint in `get-by-id.test.ts` — one proving
`assigned_by` is a genuinely different answer from `created_by`, one proving the NULL case (the
assigner left, the FK nulled it) still comes back as the creator rather than a blank.

**Gate:** tasks **14 suites / 413 tests** · home 23 · search 32 · eng 80 · task-dependencies 67 ·
dept-review 122 · assistant 270 — every service that feeds `toWireTask`, all green · client vitest
**49** · tsc clean **×2** · eslint still exactly **70 / 12**. Found and fixed on the way: **I-3**
(§6) — and this time the timeout defect was fixed for the whole suite rather than one more file.

**Goal (as planned):** the field reaches the browser everywhere, and can never silently disappear.
**Steps:** `toWireTask` emits `assigned_by: t.assignedBy ?? t.createdBy` (doctrine #2 fallback); the
client `Task` interface gains `assignedBy: string`. No mapper changes (see §0).
*Resolved in P0:* the second serializer, `assignmentRequestSerializer.toWireTaskSnapshot`, needs
**no change** — the approval card already renders "requested by &lt;name&gt;"
(`AssignmentRequestCard.tsx:164`), and by **D6** the requester *is* the Assigned By, so the field
would be a duplicate of what that card already shows.
**Tests:** a serializer unit test pinning the field and the fallback; a **wire-parity test** that
fails if `assigned_by` ever stops being emitted; client tsc.
**Gate:** server + client tsc clean · all task-reading suites green.

### P4 — Read it everywhere (no editing yet)
**Goal:** the question "who gave me this?" is answerable from any screen.
**Steps:** show Assigned By wherever the task's people are already shown —
- **Task drawer:** a meta line beside the existing "Created by" (`TaskDetailDrawer.tsx:681`).
- **List row / Board card / Calendar day panel / Space All-tasks browser:** a compact
  "by <name>" affordance next to the assignee stack (tooltip on hover where space is tight).
- **Dept review queue, SLA queue, search results:** same treatment.
A shared presentational component so all seven surfaces agree, and so the string is written once.
**Tests:** client vitest for the component (own name, someone else's name, fallback);
Playwright pass over List · Board · Calendar · drawer.
**Gate:** client vitest green · the four surfaces verified in a real browser.

### P5 — Change it (the editable half)
**Goal:** a wrong attribution can be corrected, and the correction is on the record.
**Steps:** `PATCH /tasks/:id` accepts `assigned_by`; the validator resolves it like an assignee
(must be an active user of the workspace **visible to the caller** — an invisible user is
`not_found`, never a hint); permission is the **existing task-edit gate** (creator/assignee via
own-scope, plus the head/admin allow-path) — no new key; the change writes a `task_updated`
activity row carrying before/after so the drawer's activity feed shows it. UI: an inline editor in
the drawer modeled on `InlineAssigneeEdit`. Bulk edit gets it **only if** the bulk path already
routes through the same validator; otherwise it is explicitly deferred and logged in §6.
**Tests:** allow/deny matrix (creator ✅, assignee ✅, head ✅, admin ✅, unrelated member ❌,
outsider ❌ as `not_found`), invalid/invisible user id, activity row written with both values.
**Gate:** jest `tasks` + `rbac` green · live check as three roles.

### P6 — Filter and assistant *(the multipliers)*
**Goal:** "who gives me work" becomes answerable in aggregate, not one task at a time.
**Steps:** add **Assigned by** to the shared `taskFilters.ts` model + `TaskFilterPopover` — all four
surfaces inherit it for free (the same shape the person filter already uses). Assistant:
`get_task_details` returns who assigned it, and `get_person_tasks` learns the direction
("**X ke ke kaj diyeche**" / "ami kake ki diyechi") — the tool description already hints at this
phrasing. Watch the pinned budgets and move a ceiling only with the kb-coverage paper trail.
⚠️ *Measured in P0:* the system message has **~30 characters of headroom** (47,970 of 48,000) and
the tool defs about **480** (9,020 of 9,500). So P6 cannot add prose for free — it must either
delete real duplication first (what four earlier phases did) or move the ceiling with a written
reason, exactly as `kb-coverage.test.ts` documents for every previous raise.
**Tests:** filter unit matrix; `kb-coverage` + `route-parity`; the two graders.
**Gate:** client vitest green · `assistant-eval.cjs --assert` PERFECT · `assistant-role-matrix.cjs`
ALL CELLS PASS (run them **sequentially, never in parallel**, and read exit codes **unpiped**).

### P7 — Live multi-role verification *(the user's scenario, verbatim)*
**Goal:** prove the actual complaint is solved.
**Steps:** seed the exact story — a **supply-chain member creates a task and assigns it to a
software-team member**, cross-team so it travels through the approval gate. Then verify live, as
four people (the assigner, the assignee, a head, an unrelated member): the assignee sees who gave
them the work on every surface; the count/name matches direct SQL; an edit by the head re-attributes
it and shows in the activity feed; an unrelated member still cannot see the task at all. Screenshot
each. Any mismatch is a P1–P5 bug: fix, add the missing test, re-run.
**Gate:** the §4 acceptance table fully ✅ with DB-truth columns filled in.

### P8 — Ship gate and rollout
**Goal:** the same bar every change here has met, and a deploy that cannot lie.
**Steps:** full jest battery (tasks · forms · jobs · rbac · assistant · collab) · client vitest ·
tsc ×2 · eslint still exactly 70/12 · dists rebuilt and committed · commit/push with this plan's
execution records · **`DEPLOY_PROMPT` updated**: upgrade **025 runs BEFORE the code** (additive, old
code ignores it — same ordering rule as 023/024) **and the broken canary is replaced** with
`/api/v1/auth/me` → 401 plus an authenticated list read. Docs: `TEAM_GUIDE.md` gets a short Bangla
note on what Assigned By means and who may change it.
**Gate:** every gate green; the deploy prompt re-pinned to the final SHA.

---

## 3) Decision log — 🔒 locked 2026-08-22 (overridable only by the user)

| # | Decision | Why |
|---|---|---|
| D1 | A real `tasks.assigned_by` column — **not** derived from `task_assignees` | The ask is one-per-task and editable; a column rides the single serializer to all 8 surfaces, while a derived per-assignee value cannot be edited coherently and does not exist for unassigned tasks |
| D2 | Backfill = earliest `task_assignees.assigned_by`, else `created_by` | Real history already exists and is 100% populated; today the two agree on all 46 rows, so the backfill is provably safe |
| D3 | Column is NULL-able; the **wire** falls back to `created_by` | No data-migration lock, and doctrine #2 (never a blank attribution) is guaranteed at the boundary rather than hoped for |
| D4 | Editable by whoever may edit the task — **no new permission key** | The 56-perm catalog stays fixed; the own-scope + head/admin gate is already proved working live |
| D5 | Every change writes a `task_updated` activity row | It is an accountability field; a silent rewrite would defeat the entire point |
| D6 | Approval-gated cross-team assignment keeps the **requester** as Assigned By | The requester handed the work out; the approver only allowed it |
| D7 | A recurrence copy inherits the template's Assigned By | Matches the job's existing `actorId: template.createdBy` |
| D8 | A form-created task is assigned by the **form owner**, never the anonymous submitter | Same as today's `actorId`, and the submitter is not a workspace identity |
| D9 | Wire name `assigned_by` → arrives as `assignedBy` via the interceptor | Zero mapper work; matches every other field's convention |
| D10 | The **Assigned by filter** ships in P6, not earlier | The feature is complete without it; it is a multiplier, and keeping it separate keeps P1–P5 small |
| D11 | Adding/removing assignees never rewrites Assigned By | Mirrors the existing `onDuplicateKeyUpdate` semantics that already preserve the original assigner |

---

## 4) Acceptance set (P7 fills the truth columns)

| # | Scenario | Checked as | Expected |
|---|---|---|---|
| A1 | Supply-chain member creates a task for a software-team member | the assignee | sees **"Assigned by <supply-chain member>"** on drawer, List, Board and Calendar |
| A2 | Same task | direct SQL | `tasks.assigned_by` = the creator's id; the activity feed has exactly one `task_created` |
| A3 | Cross-team assignment approved later by an admin | the assignee | Assigned By is still the **requester**, not the approver |
| A4 | Head corrects a wrong attribution | head, then anyone | new name everywhere **and** a `task_updated` activity row showing before → after |
| A5 | Unrelated member (another department) | outsider | task is `404` as before — the new field leaks nothing |
| A6 | A pre-existing task from before this feature | anyone | shows an Assigned By (backfilled), never blank |
| A7 | Add a second assignee a day later | anyone | Assigned By unchanged |
| A8 | Filter "Assigned by = X" on a list (P6) | member | exactly the tasks SQL says X handed out |

---

## 5) P0 execution record — ✅ **COMPLETE 2026-08-22** (@ `c357ccf`, no product code changed)

Every later phase diffs against these measured numbers.

| Baseline | Value |
|---|---|
| jest `tasks` | **13 suites / 400 tests** — 399 green + **1 timing-fragile test found, root-caused and fixed** (see §6 · I-1) |
| jest `forms` | **8 suites / 85 tests** — all green (clean re-run, real exit 0) |
| jest `rbac` | **19 suites / 345 tests** — all green |
| jest `jobs` | **7 suites / 54 tests** — all green |
| jest `assistant` | **17 suites / 270 tests** — all green (budget assertions included) |
| client vitest | **7 files / 49 tests** — all green |
| eslint | server **exactly 70 errors**, client **12 errors + 4 warnings** — the pre-existing baseline |
| tsc | server **clean**, client **clean** |
| canonical tables | `database/schema.sql` **47** · live dev DB **47 tables / 5 views** |
| assistant budgets | system message **47,970 / 48,000** (≈30 chars headroom) · tool defs **9,020 / 9,500** (≈480) |
| `tasks.assigned_by` | **does not exist yet** (expected pre-P1) |
| `task_assignees.assigned_by` | **46 / 46 populated, zero nulls** |

**Three P1/P3 assumptions proved rather than assumed:**

1. **The backfill query is correct and safe.** Run as a read-only `SELECT` against the live dev DB
   (nothing written): of 47 tasks, **0 would end up NULL** (doctrine #2 holds), **46** take their
   value from a real assigner and **1** falls back to `created_by` (the one task with no assignees),
   and **0 rows** would reference a missing user — so the new foreign key will hold.
2. **The column reaches the type system for free.** `Task = typeof tasks.$inferSelect`
   (`db/schema/tasks.ts:467`), so adding the column to the Drizzle table puts `assignedBy` on
   `TaskRow` and the serializer typechecks.
3. **Every test database is built straight from `database/schema.sql`**
   (`tests/test-utils/db.ts:7,86` → `provisionTestDb`). So the schema.sql edit — one of P1's three
   synchronized edits — automatically gives **all 31 per-suite test databases** the new column. No
   per-suite migration work exists.

Decisions §3 (D1–D11) locked · acceptance set §4 written · issues log §6 opened.
**Gate met — P1 may begin on the next go.**

---

## 6) Issues found along the way — *(append-only during P1–P8)*

*(Per doctrine #7: pre-existing bugs found while building get fixed + tested + logged here before
the phase continues. Two are already known from the 2026-08-22 scan and are folded into the plan
rather than left as surprises: the **broken deploy canary** — handled in P8 — and the fact that
`task_assignees.assigned_by` was carrying good data nobody could see, which is what makes P1's
backfill honest.)*

- **I-1 · P0 (2026-08-22) — the tasks suite was not deterministically green, in exactly the file
  this feature will touch.** `tests/tasks/assignees.add.test.ts` failed **both** full runs of the
  day — once with three other suites running concurrently, once in a six-file batch with nothing
  else running — always on its **first** test ("204 for a single user_id"), always as
  `Exceeded timeout of 30000 ms`, never as a wrong answer.
  *Root cause:* the file pins `jest.setTimeout(30000)`, and per-test cost roughly **doubles** as a
  13-file `--runInBand` run accumulates (`resetTestDb` truncates 47 tables between tests). The
  first test additionally pays the file's cold start, so the one test with warm-up inside its
  budget is the one that blows it. Measured: **4.2s** running the file alone (60/60 green) and
  **4.8s** beside one sibling — against a 30s ceiling that held for every other test in the file
  (all ~1.5–2.2s).
  *Fix:* raised that file to `jest.setTimeout(60_000)` with the measurements written into the
  comment. 60s is not a new number in this repo — **8 other suites already use it** for the same
  reason, against 53 on 30s.
  *Verification:* the file is green alone (60/60) and paired (115/115). Full 13-file confirmation
  is **deferred to P1's gate**, which runs this suite anyway — see the environment note below.
  *Why it mattered enough to stop for:* P2 and P5 change assignment write paths. Without a
  deterministic green baseline here there would be nothing honest to compare against, and the very
  first "did I break assignment?" question would have had no trustworthy answer.
- **I-2 · P2 (2026-08-22) — the same defect as I-1, in the forms suite.**
  `forms/public-submit.test.ts` failed on its **first** test ("missing ENCRYPTION_KEY → clean 503")
  with `Exceeded timeout of 30000 ms` — the identical signature: never a wrong answer, always the
  one test that pays the file's cold start inside its own budget. This suite's cold start is
  heavier than most (a seeded form, an encrypted submission and a real task write); its siblings
  finish in ~1.7s and the test itself takes **4.7s** once warm. This is also, finally, the identity
  of the unexplained forms failure P0 recorded and could not name.
  *Fix:* `tests/test-utils/setup-each-forms.ts` 30s → 60s — the suite-wide setting, since the
  files themselves declare nothing. Same precedent as I-1: **8 of the 30 setup-each files already
  use 60s** (assistant, home, jobs, on-call, search, sprints, sse, templates). Forms suite now
  8 suites / 85 tests green, the offending test at 4.67s.
  *Pattern worth carrying forward:* a 30s budget plus a file's first test is this repo's fragile
  combination. When a later phase sees a lone timeout on a first test, this is what it is.
- **I-3 · P3 (2026-08-22) — third instance, so it stopped being a file's problem.**
  `tasks/get-by-id.test.ts` failed on its **first** test at 30s. Same signature as I-1 and I-2:
  never a wrong answer, always the first test in a file, always a test that runs in 1.5–5s once
  warm. Three phases had now each lost a run to it, and patching one file at a time was simply
  losing to whichever file came next.
  *Fix:* the **whole tasks suite** moved at once — `setup-each-tasks.ts` **and** all 13 of its test
  files (each declares its own budget, which would otherwise win) from 30s to **60s**, the value 8
  other setup-each files already use. `setup-each-tasks` is shared only with `jest.tasks10`, so the
  blast radius is exactly the suites intended.
  *What it costs:* nothing when tests pass — a timeout only bounds failure. What it buys is that
  P4–P8 can trust a red result to mean "you broke something".
- **Environment note (2026-08-22):** long-running background commands in this session are being
  killed after a few minutes regardless of whether they emit output, while foreground calls are
  capped at 10 minutes. The tasks suite needs ~29 minutes. Later phases should therefore run heavy
  suites in **foreground chunks** (3–4 test files each) rather than one background run, and must
  never read a suite's verdict through a `| tail` pipe — that masks the exit code, which is how
  both of today's failures nearly went unnoticed.

---

## 7) Explicitly NOT in this plan

- No per-assignee attribution UI ("who added *each* person") — the column keeps that history, the
  interface stays one-per-task as asked.
- No new permission key and no roles-UI change.
- No change to how assignment approval works — only to who is recorded as the assigner.
- No notification changes: the assignment email already names the assigner correctly, and a later
  *edit* of Assigned By deliberately fires nothing (it is a correction, not a new hand-off).
