# DEADLINE TIME PLAN — hourly deadlines, live countdown, honest lateness

**Written 2026-09-08, after a full scan of the running system.** Anchor `de941a8` (production).

## What the user asked for

1. **Start date and due date carry an hour and minute**, picked with AM/PM — so work can be
   handed out with a 1-hour or 3-hour deadline, not just "sometime on Friday".
2. **A short line under the task name** saying how long is left: *"only 17 hours left"*,
   *"2 days 13 hours left"*.
3. **After the deadline passes, the line changes** — and when the task is finished late, it says
   how late: *"completed 5 hours after the deadline"*.
4. **The activity log stops saying "2d ago" and says "24 Aug, 10.24 PM"** instead.

> The user's own reason, in their words: *"akhn theke keu kauke task assign korle hourly deadline
> dite pare"* — so that assigning work can carry an hourly deadline. Every decision below is
> checked against that sentence, because it is the thing that makes the feature worth building.

---

## §A — What the scan found

### The three columns this turns on

```
tasks.start_date                 DATE        ← no time. Add one.
tasks.due_date                   DATE        ← no time. Add one.
tasks.completed_at               TIMESTAMP   ← already an instant; this is what "late" measures against
```

And three more that matter to the design:

```
tasks.recurrence_time            TIME        ← THE PRECEDENT for storing a wall-clock time
tasks.sla_due_at                 TIMESTAMP   ← an instant-typed deadline that ALREADY EXISTS
workspaces.timezone              VARCHAR     ← P12 made "today" per-workspace
```

Three indexes contain `due_date`: `idx_tasks_list_active`, `idx_tasks_overdue_scan`,
`idx_tasks_recurrence`.

### ⭐ Two hard parts are already written

This is the finding that changes the size of the job.

**1. The countdown exists.** `client/src/components/task/SLABadge.tsx` already renders exactly the
shape the user described:

```ts
if (d > 0) text = `${d}d ${h % 24}h`;      // "2d 13h"
else if (h > 0) text = `${h}h ${m}m`;      // "17h 30m"
else text = `${m}m`;
return { text: breached ? `SLA breached ${text} ago` : `SLA in ${text}`, breached };
```

…plus an "SLA met" state when `completedAt <= target`. That is requirement 2 and most of
requirement 3, working in production today — against `sla_due_at` instead of the deadline.
**We generalise it; we do not invent it.**

**2. The AM/PM picker exists.** `RecurrenceConfig.tsx` already uses
`<TimePicker format="h:mm A" />` and stores `HH:mm`. That is requirement 1's input control,
already styled and already shipping.

### What must change

| layer | sites | notes |
|---|---|---|
| server source | **38 files** touch `due_date`/`start_date` | not all in scope — sprints and assignment-requests have their OWN dates |
| client source | **25 files** read them; **5** hold pickers | |
| `timeAgo` | **3 identical copies** — `TaskActivitySection`, `CommentsSection`, `RecentActivityCard` | requirement 4 must not become a fourth copy |
| assistant | `dateOnly()` strips the time in **6 places** in `tools.ts` | a deliberate decision, not an oversight |
| tests | **26 server files**, 2 client, 5 e2e reference due dates | |

---

## §B — The decisions this rests on

These are stated up front because getting them wrong is how this feature ships a bug.

### B1 — ⛔ A due date with NO time means the END of that day

**This is the most important line in the plan.**

Today, "overdue" means `due_date < today` — so a task due today is *never* overdue during today.
If a time-less due date were treated as `00:00`, then the moment this ships **every existing task
due today becomes overdue at once**, across the whole company, on data nobody touched.

So a NULL `due_time` resolves to **23:59:59 in the workspace's timezone**. That reproduces today's
behaviour exactly, which means the migration is invisible to every existing task — and that is the
property that makes this safe to deploy.

`start_time` NULL resolves to `00:00:00` for the same reason: a start date with no time has always
meant "from the beginning of that day".

### B2 — A deadline with a time is an INSTANT, and the timezone is the WORKSPACE's

`due_date` today is deliberately timezone-free — `toWireDate` builds it from UTC components
*precisely so* it carries none. Adding a time ends that: "5 September 5:00 PM" is meaningless
until you say whose 5 PM.

It is the **workspace's**, following the rule P12 established for "today"
(`todayInZone(workspaces.timezone)`) and the F5 rule the overdue and recurrence jobs already use.
Not the browser's, or a task due at 5 PM would be a different moment for a colleague on a trip.

⚠️ **This lands exactly on the code P13 fixed a timezone bug in.** The due-date chip was reading a
day early west of UTC for months, invisible behind the office's UTC+6. Every phase below carries a
timezone test at four zones for that reason.

### B3 — Store a TIME column, do NOT migrate DATE → DATETIME

| | approach | consequence |
|---|---|---|
| ❌ | `ALTER … due_date DATETIME` | rebuilds 3 indexes on a live table, and rewrites the meaning of every existing row at once |
| ✅ | add nullable `start_time` / `due_time` **TIME** | old rows keep `NULL`, B1 makes NULL mean what it always meant, nothing existing moves |

The second is also the shape `recurrence_time` already uses, so it is the pattern this codebase
has already tested in production.

### B4 — Two deadline concepts must not become confusing

`sla_due_at` already exists and already has a badge. After this work a task can have both an SLA
target and a deadline. They are different things — SLA is a response commitment, the deadline is
when the work is due — and the UI must not show two similar-looking countdowns without saying
which is which. Phase 5 owns this.

### B5 — ✅ DECIDED 2026-09-08: the time picker is ALWAYS VISIBLE

The user chose the always-on control over an opt-in "add time" affordance. So every date field
carries an hour/minute box beside it, whether or not the task needs one.

Two consequences Phase 3 owns, because the plan should say what a decision costs:

- **Horizontal space.** The inline date editor sits in a table row and on a mobile card. A
  permanent second control has to fit there without pushing the assignee or status off the
  row — P11's mobile metric guard is the check that catches it if it does not.
- **Empty ≠ midnight.** An always-visible box invites the reading "it is showing blank, so the
  time is 00:00". It is not: blank means end of day (**B1**). The control must say so —
  a placeholder reading `end of day` rather than `--:--`.

---

## §C — The phases

Each phase ends green on `npm run test:all` and is committed separately. One phase per go.

### P0 — Pin today's behaviour before changing it

*Nothing is built. This phase makes the later phases provable.*

1. Write B1/B2 down as an executable invariant: a characterisation test that captures what
   "overdue", "due today" and the due-date chip do **right now**, at four timezones
   (Dhaka / UTC / New York / Midway).
2. Confirm the 3 duplicated `timeAgo` copies are byte-identical, so Phase 6 can consolidate them
   without behaviour change.
3. Record the current index plans for the three `due_date` indexes against a seeded fixture
   (`scripts/scale-seed.cjs` from P13) — so Phase 1 can prove it did not regress a query plan.

**Exit:** the characterisation tests pass on today's code, and each is proven able to fail.

**✅ P0 DONE — 2026-09-08.**

*Nothing was built. Today's behaviour is now written down in a form that can fail.*

**1. The B1 invariant is pinned** — `client/src/components/ui/DueDateBadge.test.tsx`, 6 tests.
The load-bearing one: **a task due today reads "Today" at 00:05 AND at 23:59**, never overdue.
That is the assertion a null `due_time` read as midnight would break, and it is asserted at both
ends of the day precisely because the midnight reading only shows up at one of them. The rest
record the current vocabulary — Yesterday/Tomorrow/weekday/`May 2`/em-dash — and the colour each
state uses, so Phase 4 replacing this badge is a deliberate swap rather than a silent one.

Repeated at four timezones (Dhaka / UTC / New York / Midway). **Proved able to fail:** reverting
P13's `parseWireDate` back to `new Date(dueDate)` turns both timezone tests red, and only those
two — which is also a clean re-demonstration that the P13 fix is what is holding them up.

**2. The `timeAgo` duplication is pinned** — `client/src/lib/time-rendering.test.ts`, 4 tests.

⚠️ **The plan was wrong here and is corrected.** §A said the three copies were "byte-identical".
They are not: `RecentActivityCard` assigns `const d = …` where the other two inline the same
expression. A string comparison read that as a drift. But text was never what Phase 6 depends
on — so the test now **compiles and runs all three** against a row of inputs spanning the
just-now, minute, hour and day boundaries, and asserts they agree on every one. That is the
actual precondition for replacing three functions with one.

**3. Query-plan baseline recorded**, against a 5,047-task / 12,410-comment fixture built with
P13's `scripts/scale-seed.cjs` (`EXPLAIN` on the dev database's 47 tasks proves nothing):

```
overdue scan          type=ref  key=uq_tasks_custom_id      rows=2373  Using where
list read + order by  type=ref  key=idx_tasks_list_active   rows=270   Using index; Using filesort
due-today bucket      type=ref  key=idx_tasks_overdue_scan  rows=1     Using index condition
```

Two things worth carrying forward. The overdue scan does **not** use `idx_tasks_overdue_scan` —
it takes the workspace prefix of the unique `custom_id` index and filters 2,373 rows. And the
list read is already paying a **filesort** to order by `due_date`. Neither is a defect today,
but Phase 1 adds a column to exactly these queries, so both numbers are the ones to re-measure.

**Gate:** client **162 tests / 16 files, all green** (was 152 — P0 added 10). eslint 0/0,
`tsc -b` clean. No source file changed, so the server suite is untouched by construction.


### P1 — Storage and the wire

1. `database/upgrades/027_task_deadline_time.sql` — two nullable `TIME` columns,
   information_schema-gated. No backfill (B1 makes NULL correct).
2. Drizzle schema + `database/schema.sql` + the index-parity test from P13 stays green.
3. Serializer: `due_time` / `start_time` as `"HH:MM"` or `null`.
4. Validators: accept `HH:MM` (24h on the wire; the picker does AM/PM in the UI), reject
   a time without a date.

**Exit:** round-trip test — create with a time, read it back identical, at four timezones. Every
existing task still serialises exactly as before (`due_time: null`).

**✅ P1 DONE — 2026-09-08.**

`upgrades/027` adds `tasks.start_time` and `tasks.due_time` as nullable `TIME` columns —
appended at the end of the table so InnoDB can add them instantly, information_schema-gated,
**no backfill**. Applied to dev, verified idempotent (a second run exits 0 and changes nothing)
and verified inert: `SELECT COUNT(*) FROM tasks WHERE due_time IS NOT NULL OR start_time IS NOT
NULL` returns **0**. Schema parity **22/22** — `schema.sql`, the Drizzle table and the live
database all agree, including P13's index-parity rule.

The wire carries `start_time` / `due_time` as `"HH:MM"` or `null`, following the shape
`recurrence_time` set in upgrades/024. Validation is `HH:MM` 24-hour in all **three** schemas
that accept these fields — create, update and the bulk patch (the first attempt patched two and
the refusal-on-wrong-match-count is what caught the third). The client `Task` type gained the
two fields; no mapper work, because the HTTP layer camelises both directions already.

### ⛔ The guard the time column quietly broke — and what my first fix got wrong

`start_date <= due_date` was enforced by a lexical compare and by `ck_tasks_dates`. Neither can
see a time, so **`start 5 Sep 17:00, due 5 Sep 09:00` sailed through both** — the dates are
equal. The guard now compares `(date, time)` pairs.

Writing it, I got it wrong twice in one function, and the tests caught both:

1. **I dropped the `startDate && dueDate &&` precondition.** With it gone, a task carrying only
   a start date compared `"2026-09-05T00:00" > ""` — true — and setting a start date with no
   due date became a 422.
2. **I wrote a comment saying the defaults were "deliberately ASYMMETRIC" and then defaulted
   both to `00:00`.** So `start 5 Sep 17:00, due 5 Sep` — an afternoon start on a same-day
   deadline, an entirely ordinary thing to want — was refused. The test asserting exactly that
   is what went red.

Both are fixed in `startsAfterDue`, which now compares only when both dates exist and defaults a
missing start time to `00:00` and a missing due time to `23:59` — plan §B1's end-of-day rule,
applied to ordering. The comment now describes the code.

### The overdue claim re-arms on a TIME change too

`overdue_notified_at` is the once-per-deadline claim from upgrades/014, and changing the *date*
has always cleared it. Moving only the *time* moves the deadline just as truly — without this,
pulling a deadline from 5 PM to 10 AM would never alert, because the claim for that date was
already spent. Cleared on `dueTime` in both the single PATCH and the bulk path, with a test that
stamps the claim and watches it go back to null.

### Tests

`tests/tasks/deadline-time.test.ts` — **10**, covering the round trip (wire *and* the stored
`HH:MM:SS`), `null` staying `null` rather than becoming midnight, `00:00` and `23:59` remaining
distinct from `null`, five malformed inputs refused at 422 (including `"5:00 PM"`, which is what
an AM/PM picker would send if P3 forgets to convert), the ordering cases above, the re-arm, and
the same `HH:MM` served under four process timezones.

That last one is deliberate: a `TIME` is a wall-clock reading with no zone of its own, so it must
not move with the server's. P13 found a *date* reading a day early west of UTC; this is the same
trap one column over, pinned before anything starts comparing these values.

**Gate:** schema **22/22** · tasks **433/433** · tasks10 **433/433** (both were 431/433 until the wire-contract lists were updated — see below) · assistant 289 · forms 92 · home 33 · jobs 148 · listsread 156 · templates 125. eslint 0/0 and `tsc --noEmit` clean on both packages. Client `tsc -b` clean.

⚠️ **A contract test caught the change, exactly as it should have.** `list-by-list` and `get-by-id` each pin the task payload as *"exactly the 48 wire fields"*. Adding two made it 50, and both went red. That is the test working — the fix was to add `start_time`/`due_time` to the pinned lists and rename the count, not to loosen the assertion.

**Not done here, on purpose:** nothing *compares* a deadline yet. The resolver that turns
`(date, time, workspace timezone)` into an instant is P2, and until it exists the overdue job,
Home's tiles and the badge all behave exactly as they did — which is why this phase is safe to
ship on its own.


### P2 — ONE deadline resolver, server-side

*The load-bearing phase. Everything after it reads this one function.*

1. `deadlineInstant(dueDate, dueTime, workspaceTimezone) → Date | null`, applying B1's
   end-of-day rule, next to `todayInZone` in `utils/dhakaTime.ts`.
2. Route the overdue-alert job, Home's `dueToday`/`overdue`, and the review queue through it —
   **no second implementation anywhere.** A grep-based test enforces that, the way P13's
   `write-paths-recompute` test enforces the checklist rollup.
3. Prove the boundary: a task due 23:00 with no time is NOT overdue at 22:00; one due 09:00 IS
   overdue at 10:00; both at four zones.

**Exit:** the overdue job's behaviour is unchanged for every time-less task (the whole existing
dataset), and correct for a timed one.

**✅ P2 DONE — 2026-09-09.**

There is now exactly one deadline rule and it lives in **`server/src/utils/deadline.ts`**.
**22 call sites across 8 files** read it; nothing decides overdue for itself any more.

### ⚠️ I did NOT build what step 1 above describes, and the difference matters

The plan said `deadlineInstant(dueDate, dueTime, tz) → Date | null`, in `utils/dhakaTime.ts`.
A `Date` is the obvious shape and it is the wrong one. MySQL cannot compare a JS `Date` against
`due_date` + `due_time` without constructing one **per row**, which throws away the index on
`due_date` — and the overdue-alert job scans the whole task table on a `*/10` cron. P13 measured
that path deliberately; handing it a full scan would undo that.

What exists instead resolves the zone **once, in Node**, into two plain strings:

```ts
interface WorkspaceNow { today: string; /* YYYY-MM-DD */ clock: string; /* HH:MM */ }
```

and then compares calendar-day to calendar-day and clock to clock. `due_date` stays sargable,
and the database does no timezone arithmetic at all. It also went in a **new file** rather than
into `dhakaTime.ts`: that module holds the zone *primitives* (`todayInZone`, `clockInZone`), and
the deadline *rule* is a different thing that deserves a place where it can be found.

### The rule is written TWICE, on purpose, with a proof that both agree

The judgement is made in two irreconcilable places: repositories decide it inside a `WHERE` over
thousands of rows, services and jobs decide it for one task already in memory. So there is a JS
predicate *and* a SQL fragment — in the same file, and
`tests/tasks/deadline-resolver.test.ts` runs both across **4 dates × 6 times = 24 real rows** and
fails the moment they disagree. Two implementations in one file with a proof they match is
honest; two in two files is the bug this module exists to prevent.

### The property the whole migration rests on

For a task with **no** `due_time` — which is every task that exists today — the new rule must
return exactly what `due_date < today` returned. If that were ever false, shipping 027 would
silently re-judge the entire production dataset. It is asserted **against the old expression
itself**, not against my opinion of it, in both forms:

- a time-less task due today is not late at `00:01`, `09:00`, `14:30`, `23:58` or `23:59`;
- the SQL reproduces `legacyOverdue(date)` for every time-less row.

A timed task is late **from its minute onward and not before** (`16:59` no, `17:00` yes,
`17:01` yes), and a time on a past day is late whatever the clock says.

### `due_soon` and `overdue` were about to start double-counting

Before 027 the Home buckets were disjoint by construction (`< today` vs `>= today`). Add a time
and they stop being: a task due **today at 09:00** is overdue at 10:00 **and** still inside the
seven-day window. It would have appeared in both tiles, and the second one anybody noticed would
have been called a caching bug. `due_soon` now also carries `NOT sqlDeadlinePassed(now)` in both
`HomeRepo.myTasksByBucket` and its twin in `TasksRepo` (the assistant's), which HomeRepo's own
comment already said must never disagree with it. For a time-less task this changes nothing —
such a task is never late on its own day — which is why the existing tests stayed green.

### How the call sites were found — by the compiler, not by grep

Every signature changed from `today: string` to `now: WorkspaceNow` rather than gaining an
optional second argument. A bare `string` would have let every existing caller keep compiling
while quietly meaning something new. Changing the *type* made `tsc` list them, including **17 in
test files** I would not have thought to look at — `tests/assistant/insights-repo.test.ts` (15),
`tests/dept-review/report-stats.test.ts` and `tests/rbac/principals.test.ts`. None of their
assertions changed, and that is the point: no fixture in any of them sets a due time, so the
reduction to the old rule holds.

### The guard that keeps it one rule

`tests/tasks/deadline-single-rule.test.ts` (5) scans every `.ts` under `src/` for the two shapes
that ARE a deadline judgement — `${tasks.dueDate} <` (strict) and `${tasks.dueDate} = ${…today}`
— and fails on any outside the resolver. It deliberately does **not** match `>=` / `<=` date
*windows*: the seven-day look-ahead, an agenda for a requested day, and the caller's
`dueAfter`/`dueBefore` filter are ranges over a calendar, not verdicts about lateness, and they
stay date-only. **Seven such windows remain and all seven are correct.**

Like P13's `write-paths-recompute`, it was **proved able to fire, against the real tree** — the
old ``sql`${tasks.dueDate} < ${today}` `` line was reinstated in `ReviewsRepo.ts` and the guard
reported `repositories/ReviewsRepo.ts:1 overdue` before the file was restored. It also asserts
the resolver is actually *used* by all three repositories and the job, since deleting every call
site would otherwise satisfy it.

### ⛔ A correction: the `CAST` is deliberate but NOT load-bearing

The SQL compares `due_time <= CAST(? AS TIME)`. I wrote a comment claiming the cast was what
kept `'17:00:00' <= '17:00'` from being false, then mutation-tested it: **removing the cast
failed nothing.** `due_time` is a `TIME` column, so MySQL coerces the string operand rather than
degrading the column to text. The comment now says what is true — the cast is an explicit
statement that this is a time comparison, and insurance for the day the left side stops being a
bare column (a `COALESCE(due_time, '…')` *would* make it a string compare, where the longer
string wins on the shared prefix). The JS side has no such protection, so `hhmm()` trims both
operands there, with a test for the stored-`HH:MM:SS` versus wire-`HH:MM` case.

### What was routed

`TasksRepo` (`findOverdueUnnotified`, `personTasksVisible`, `teamWindowStats`, the my-work
buckets), `HomeRepo` (`dueTodaySeries`, `overdueSeries`, `myTasksByBucket`), `ReviewsRepo`
(`bucketPredicate`, `memberSummary`, `summaryTotals`, `queuePage`, `queueCount`),
`jobs/overdueAlert.ts`, `HomeService`, `ReviewsService`, `ReportStatsService`, `ReportsService`
and `assistant/tools.ts`.

The company-versus-workspace split P12 established is preserved and now named: reviews and the
assistant resolve `workspaces.timezone`; the Monday 09:00 HR report and the on-call roster call
`companyNow()`, which is Asia/Dhaka deliberately and says so at the call site — an unexplained
literal zone is exactly what a later "consistency" refactor deletes.

**Gate:** tasks **450/450** · tasks10 **450/450** (both 433 before P2: +12 resolver, +5 guard) ·
home 33 · assistant 289 · deptreview 122 · jobs 148 · rbac 367 — **7 modules, 1,859 passed, 0
failed.** `tsc --noEmit` clean on `src` and on `tsconfig.tests.json`; eslint 0/0 across `src` and
`tests`.

**Not done here, on purpose:** nothing *displays* any of this yet. `DueDateBadge` still renders
exactly what P0 pinned, no countdown exists, and no picker can set a time — P3 and P4. The
server now judges a timed deadline correctly and a time-less one identically to before, which is
what makes this phase safe to ship alone.



### P3 — The pickers (input)

1. `TimePicker format="h:mm A"` beside the date in: `CreateTaskModal`, `InlineDateEdit`,
   `TaskPropertiesPanel` / `TaskDetailDrawer`, `BulkActionToolbar`.
2. Implements the B5 decision (opt-in vs always shown).
3. Clearing the date clears the time; setting a time without a date is refused in the UI, not
   only by the validator.

**Exit:** e2e — set "5 Sept, 5:00 PM" on a task, reload, it still reads 5:00 PM. Mobile too:
the picker must be usable on a phone (P11's lesson — the form builder was drag-only and unusable
on touch).

**✅ P3 DONE — 2026-09-09.**

Every date field now carries an hour-and-minute box, picked in AM/PM, per decision §B5. One
control — `client/src/components/ui/TimeOfDayPicker.tsx` — serves all of them, so the rules about
what blank means and what goes on the wire are stated once.

### ⛔ The plan assumed a validator that did not exist

Step 3 above reads "setting a time without a date is refused in the UI, **not only by the
validator**". There was no validator. P1 added the two columns and checked each one's *format*;
nothing tied a time to its date on any of the three write paths, so `{ due_date: null }` left
`due_time` behind.

That is not a wrong-answer bug — `deadlinePassed` already returns "not late" for a task with no
due date, whatever its time. It is a data bug with a user-facing shape: set "5 Sep, 5:00 PM",
clear the date, give it a new date next week, and the task silently carries 5:00 PM onto a
deadline nobody put a time on. A badge with no date renders nothing, so the person setting the
new date could neither see the old time nor guess it was there.

Held on the **server**, not in the pickers, because the pickers are not the only writer: the
public form submit path skips the HTTP task validator entirely, the bulk patch is its own schema,
and the assistant creates tasks through the same service. Two halves:

- **Clearing a date clears its time.** Silently, because that is what "clear the due date" means;
  refusing instead would turn the clear button into a 422 on any task that happens to carry a
  time.
- **A time with no resulting date is a 422** (`task.time_without_date`). The check reads the
  RESULTING state, not the payload — a patch carrying only `due_time` is right on a task that has
  a due date and wrong on one that does not, and the two requests are identical.

`tests/tasks/deadline-time-orphan.test.ts` (**13**) was written first and run red: **8 of 11
failed**, and the 3 that passed were exactly the "leave it alone" cases that should already have
worked.

### ⛔ Two more places the bulk path was dead

Chasing one of those red tests found that `due_time` could never reach the bulk endpoint at all:

1. `TaskWriteController.bulk` gates the patch against a hand-written `KNOWN` set, and P1 never
   added the two columns to it — so the request was refused as an *unknown key*.
2. Past that gate, the same method maps the patch field by field into the service call, and the
   two columns were not in the mapper either — so they arrived as `undefined`.

P1's record claims validation was added to "all three schemas that accept these fields". The
schema entry was added; the endpoint behind it refused the field. **A validator for a field the
controller drops is worse than neither**, because it reads as coverage. Both are fixed, with the
bulk cases in the same test file.

### ⛔ And a UI assumption that was wrong — measured, not reasoned

§B5's cost, which the plan named, is horizontal space: the inline editor sits in a table row and
on a mobile card, and a permanent second control would push the assignee off the end (P11's
metric guard). So the time rides in the calendar dropdown's own footer — no wider row, and the
control is there the instant the date is.

That only works if the dropdown survives picking a date. **It does not.** antd closes the panel
on select, taking the footer with it, so setting a time on the date you just picked would have
needed a second trip through the editor — the exact opposite of what §B5 asked for. The docs read
as though a controlled `open` prevents this. `InlineDateEdit.test.tsx` has the case that proves
otherwise; it was written before the fix and failed. The fix holds the panel open for the one
close that follows a selection, and lets Escape and click-outside through.

### The two things the picker must get right

- **What it SENDS is not what it SHOWS.** Display is `h:mm A`; the wire is 24-hour `HH:MM`.
  `"5:00 PM"` is one of the malformed values P1 pinned as refused, written down precisely because
  an AM/PM picker is the most likely thing to send it. Mutation-tested: making `onChange` emit the
  display string turns that test red.
- **Blank means end of day, not midnight.** An always-visible empty box invites exactly one wrong
  reading. The placeholder says the rule — `End of day` for a due time, `Start of day` for a start
  time — rather than showing `--:--`.

`taskToWire` is the one choke point every write passes through (create, update *and* bulk), so it
trims the `HH:MM:SS` a TIME column hands back down to `HH:MM` — the same trap `recurrence_time`
hit in upgrades/024, now on its second and third column — and drops a time whose date is being
cleared, so the client never sends a request it knows the server will refuse.

### Surfaces

`InlineDateEdit` covers three of the five named places (the list row, and both ends of the range
in `TaskPropertiesPanel`, which is what `TaskDetailDrawer` renders). `CreateTaskModal` gets the
pair side by side, where there is room. `BulkActionToolbar` stages the time and applies it
*together* with the date — one uniform patch lands on many rows with different dates, and sending
the time only alongside a date makes the server's fail-atomic refusal unreachable from the
toolbar.

`DueDateBadge` gained a `dueTime` so a picked time can be *seen* — without it P3 has no exit
criterion. It is deliberately the smallest possible display change: **the colour still comes from
the date alone.** A task due today at 09:00 is late at 10:00 and this badge does not say so yet;
that is P4's job, and a second, weaker lateness rule living here would be harder to remove than to
never write. A time-less badge renders exactly what P0 pinned.

### Tests

Server `tests/tasks/deadline-time-orphan.test.ts` (**13**). Client
`TimeOfDayPicker.test.tsx` (**10**) and `InlineDateEdit.test.tsx` (**6**), plus **7** added to
`mappers.test.ts`. Three were mutation-proven able to fail: the 24-hour emission, the
clear-the-time-with-the-date rule, and the panel-stays-open fix.

**Not done here, on purpose:** no countdown, no lateness wording, no ticking — P4. And the
Playwright leg of this phase's exit criterion has not been run: it is opt-in, writes to the DEV
database and sends real mail through a live Mailtrap host, so it is the user's call, not a thing
to fire off at the end of a phase.

**Gate: the FULL server suite, because this phase changed the shared write path** — create, the
single PATCH and the bulk patch are used by nearly every module, so a partial run would have
proved little. **37 modules · 6,041 passed · 0 failed**, run in foreground chunks (KI: never as a
child of the agent session). Client **185 tests / 18 files**, up from 162 after P0. (An earlier draft of this record said 179/17 — that was a run taken before `InlineDateEdit.test.tsx` was added.) eslint 0/0 and
`tsc` clean on both packages.

⚠️ Client eslint caught `formatTimeOfDay` being exported from a component file
(`react-refresh/only-export-components`). It moved to `lib/date-utils.ts`, which is where someone
would look for it anyway — and where its one real trap is written down: a time of day carries no
date and therefore no timezone, so it must not go through `Date`. The near-miss
``new Date(`1970-01-01T${t}`) `` parses in local time and shifts.

### P4 — The countdown and lateness (display)

1. `DeadlineBadge`, generalised from `SLABadge` — same maths, deadline wording:
   *"17h left"* · *"2d 13h left"* · *"5h late"*.
2. Finished-late state from `completed_at` vs the deadline instant: *"done 5h after the deadline"*.
   Finished on time says so.
3. Slots: under the task name in `TaskRow`, `BoardCard`, `MobileTaskCard`, and in
   `TaskDetailDrawer`. `TaskRow` already has a meta line there (comment/attachment counts).
4. ⚠️ **Ticking.** `SLABadge` computes `now` at render, so it never updates on a page left open.
   For "17h left" that is fine; for "4m left" it is wrong. Decide an interval (a shared 60s tick
   is enough) and make it one timer, not one per row — a 500-task list must not mount 500 timers.

**Exit:** a rendering test at four timezones for each state (upcoming / due soon / overdue /
done on time / done late), and a virtualised-list check that the timer count stays O(1).

**✅ P4 DONE — 2026-09-09.**

The line the feature was asked for now sits under the task name: **"17h left"**, **"2d 13h left"**,
**"5h late"**, **"done 5h late"**. It is on `TaskRow`, `BoardCard`, `MobileTaskCard` and
`TaskDetailDrawer`, and it ticks.

### The hard part was NOT the wording

P2 deliberately refused to build a deadline *instant* on the server: comparing calendar-day to
calendar-day and clock to clock is what keeps `due_date` usable by its index in a `WHERE` over
thousands of rows. But "17 hours left" is arithmetic on instants and cannot be done any other way,
so the client has to build the very thing the server declined to.

**Two shapes computing one rule is how a screen ends up saying "3h left" about a task the server
has already filed under Overdue.** So `lib/deadline.test.ts` transcribes the server's rule — the
literal string comparison from `server/src/utils/deadline.ts` — and checks the two give the same
late/not-late answer across **4 zones × 9 times of day × 3 dates × 5 due times = 540 comparisons**,
with a vacuity guard proving the matrix exercised both answers. If the server's rule ever moves,
this goes red.

### ⛔ A time-less deadline is midnight of the NEXT day

Written down because it reads like a mistake. §B1 says a date with no time runs through the END of
its day, and the server implements that as `due_date < today` — so a time-less task due today is
not late at 23:59:59 and becomes late as the next day begins. Midnight-tomorrow is that same
boundary expressed as an instant, and it is what makes the countdown agree with the bucket the task
is actually in.

Mutation-tested: changing it to midnight of its own day breaks **36 of the 540** comparisons plus
three explicit cases. Reading a null time as midnight is the single change that would turn every
task due today overdue at once, and it is now three separate tests away from happening.

### ⚠️ One clock for the page, not one per row

`SLABadge` computes `now` at render, so a page left open never updates — it said "2h left" at lunch
and still says it at six. Survivable for a day-scale number; wrong for the hourly deadlines this
whole feature exists to hand out.

The obvious fix is a `setInterval` in the badge, and it is the wrong one: that is **one timer per
row**, on a list P13 measured at 22,826 DOM nodes before virtualisation. `lib/now-tick.ts` is a
single shared store read through `useSyncExternalStore` — the interval starts on the first
subscriber and is cleared on the last, so a screen with no deadlines runs no timer at all.

`now-tick.test.tsx` asserts the count directly: **500 consumers, 1 interval**. Mutation-tested by
reverting the store to a timer-per-subscriber, which turns three tests red with
`{ listeners: 500, timers: 500 }`. Virtualised scrolling is covered too — unmounting 45 of 50 rows
keeps the clock for the 5 that remain.

The snapshot is a stable number rather than a live `Date.now()` read, because
`useSyncExternalStore` compares snapshots by identity and a fresh value on every check would loop.

### ⛔ The test that "proved" a bug that did not exist

The first draft of `DeadlineBadge.test.tsx` rendered the same case in four zones inside one loop
and reported a **ten-hour error in New York**. There was no error. The loop never unmounted between
iterations, so the second badge subscribed to a clock that was already running and correctly
inherited the first zone's `now` — which is precisely the behaviour `now-tick.ts` exists to
provide. `cleanup()` now runs at the top of the render helper, with the reason written above it.

Worth keeping as a shape, not just a fact: **a shared-state module makes tests order-dependent in a
way component tests usually are not**, and the failure looked exactly like a timezone bug in the
code under test.

### What it shows

Five states, each asserted in four timezones with a clock set the same distance from the deadline
in each, so a zone bug appears as a different answer rather than a different fixture: `upcoming`
(quiet), `soon` (the last 24 hours, warned), `late` (danger), `done_on_time`, `done_late`. A
finished task states a fact and stops counting — moving the clock 30 days does not change "done 5h
late". Finishing *exactly* on the deadline instant counts as late, matching the server's `<=`.

The zone comes from `useWorkspace()` rather than a prop. Threading it through five call sites would
mean one of them eventually not doing so, and that failure is silent and off by hours. The badge
also carries `dueTime` into `DueDateBadge` on all three cards, so the chip does not say "Sep 5"
while the line beneath it counts down to 5 PM.

**Gate:** client **218 tests / 21 files**, up from 185 after P3. eslint 0/0 and `tsc -b` clean.
**No server file changed**, so the server suite is untouched by construction — verified against
`git status`, not assumed.

**Not done here, on purpose:** the deadline badge and the SLA badge can now both appear on one card
and neither says which is which. That is P5, and it is the next thing.

### P5 — Telling the two deadlines apart (B4)

1. Label the SLA badge and the deadline badge distinctly wherever both can appear.
2. Decide precedence in cramped surfaces (mobile card, board card): which one wins the single
   slot, and why.

**Exit:** a screen showing both is legible, and the mobile card does not overflow (P11's
metric guard covers this).

### P6 — Absolute activity timestamps

1. Delete the three copied `timeAgo` functions; one shared helper in `lib/date-utils.ts`.
2. Render **"24 Aug, 10.24 PM"** in `TaskActivitySection`, `CommentsSection`,
   `RecentActivityCard`, and the inbox.
3. ✅ **DECIDED 2026-09-08: hybrid.** Under an hour stays relative (`just now`, `12m ago`);
   an hour or older becomes absolute (`24 Aug, 10.24 PM`). The user chose this over
   absolute-always, and it is the better reading: a timestamp on something 20 seconds old is
   noise, while "13d ago" on something a fortnight old is the thing that loses information.
   The cutover hour is a constant, tested at both sides of the boundary.
4. These are TIMESTAMPs (real instants), so they render in the **viewer's** local zone — unlike
   the deadline, which is the workspace's. That difference is deliberate and must be commented
   where it appears, or someone will "fix" it later.

**Exit:** no `timeAgo` definition remains outside the shared helper (grep-enforced), and the
format is pinned at four timezones.

### P7 — The semantics sweep

*Everything that reads a due date and has not been touched yet.*

1. `taskFilters.ts` date windows, `CalendarView` bucketing, `SpaceTasksBrowser`, sorting.
2. The assistant's `dateOnly()` in 6 places — decide whether it reports times, and update the
   KB + `assistant-eval` if so.
3. The overdue e-mail wording (`dueYmd`) and the push notification.
4. Recurrence: does a recurring task inherit the parent's time? (It has `recurrence_time`
   already — these two must not fight.)

**Exit:** the full gate green, plus the P13 probes — `nplus1-probe`, and `scale-probe` showing
no new full scan on a hot path from the changed queries.

### P8 — Ship

1. Rebuild both dists, verify by LOADING the bundle (P14's rule), regenerate the deploy prompt.
2. `027` on production after a backup, in the order P14 proved: pull → SQL → restart.
3. Post-deploy: confirm an existing time-less task still shows exactly what it showed before.

**Exit:** live, and the "nothing changed for old tasks" check passes on production data.

---

## §D — Risk register

| # | risk | why it bites | mitigation |
|---|---|---|---|
| R1 | Existing tasks become overdue at once | a NULL time read as 00:00 | **B1** — NULL means end of day. Pinned by P0's characterisation tests |
| R2 | A deadline reads an hour/day wrong outside Dhaka | the exact class P13 fixed; UTC+6 hides it | every phase tests at 4 zones, incl. two west of UTC |
| R3 | Two implementations of "is it overdue" drift apart | there are already 4 readers of `due_date` | **P2** — one resolver, grep-enforced |
| R4 | Countdown goes stale on an open page | `SLABadge` never re-renders | P4's shared tick |
| R5 | 500 timers on a 500-task list | one timer per badge | P4 — one tick, shared |
| R6 | Users confuse SLA with deadline | both are countdowns | **P5** |
| R7 | `timeAgo` becomes a 4th copy | it is already 3 | **P6** consolidates first, then changes |
| R8 | A query plan regresses | 3 indexes contain `due_date` | P0 records plans; P7 re-measures with `scale-probe` |

---

## §E — Honest sizing

**Medium. Not hard, but not one sitting.** The reason it is not hard is §A's finding: the
countdown maths and the AM/PM picker both already exist and ship today — this is mostly
generalising `SLABadge` and threading one resolver through the readers.

The reason it is not small is B1 and B2: a deadline with a time stops being a calendar day and
becomes an instant, and every place that compares one has to agree about whose clock it is. That
is four server readers, six client readers, and an assistant that currently strips the time on
purpose.

**Phases 0, 1, 2 are the ones that must be right.** If they are, 3–7 are mechanical.

**Execution record:** *(empty — nothing built yet)*
