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

### B5 — Open question for the user (needed before Phase 3)

**Should the time picker be always visible, or opt-in?** Most tasks will not want an hour. A
required time field on every task is a tax on the common case. Proposal: the date picker gains an
"add time" affordance, and once a time is set it shows inline. **Decide before Phase 3.**

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

### P1 — Storage and the wire

1. `database/upgrades/027_task_deadline_time.sql` — two nullable `TIME` columns,
   information_schema-gated. No backfill (B1 makes NULL correct).
2. Drizzle schema + `database/schema.sql` + the index-parity test from P13 stays green.
3. Serializer: `due_time` / `start_time` as `"HH:MM"` or `null`.
4. Validators: accept `HH:MM` (24h on the wire; the picker does AM/PM in the UI), reject
   a time without a date.

**Exit:** round-trip test — create with a time, read it back identical, at four timezones. Every
existing task still serialises exactly as before (`due_time: null`).

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

### P3 — The pickers (input)

1. `TimePicker format="h:mm A"` beside the date in: `CreateTaskModal`, `InlineDateEdit`,
   `TaskPropertiesPanel` / `TaskDetailDrawer`, `BulkActionToolbar`.
2. Implements the B5 decision (opt-in vs always shown).
3. Clearing the date clears the time; setting a time without a date is refused in the UI, not
   only by the validator.

**Exit:** e2e — set "5 Sept, 5:00 PM" on a task, reload, it still reads 5:00 PM. Mobile too:
the picker must be usable on a phone (P11's lesson — the form builder was drag-only and unusable
on touch).

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
3. Decide whether very recent entries keep "just now" — an absolute timestamp for something
   that happened 20 seconds ago reads oddly. Proposal: absolute always, with the relative form
   in the tooltip.
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
