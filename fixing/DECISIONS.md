# Decisions

Every DECISION raised by `FIXING_MASTER_PLAN.md`, the options, and the user's answer.
**A phase marked DECISION does not proceed until its row here is answered.**

| # | Phase | Decision | Options | Answer | Date |
|---|---|---|---|---|---|
| D1 | F1 | Is production serving real users? | yes → backfill · no → zero migration | **NO — not in use yet. Zero data migration needed.** | 2026-07-30 |
| D2 | F1 | Canonical clock | store UTC · store Dhaka | **Dhaka is the business clock** — but F3 **revised the implementation to store UTC** (`DB_TIMEZONE=+00:00`) and apply Dhaka above it. See below. | 2026-07-30, revised 2026-08-03 |
| D3 | F6 | RBAC posture | (a) gate all 21 · (b) delete all 21 · (c) split | **(a) GATE ALL 21 — the catalog stays at 56 and every toggle becomes real.** | 2026-07-30 |
| D4 | F10 | Role-change latency | shorter token TTL · per-request live check · accept 15 min | **LIVE CHECK — service gates read the live role, not the JWT claim. Demotions bite on the next request; TTL unchanged.** | 2026-08-04 |
| D5 | F12 | New password rule for existing users | force at next login · new passwords only | **NEW PASSWORDS ONLY** — decided by default; D1 dissolved the question | 2026-08-05 |
| D6 | F19 | 7 producerless notification types | build each producer · remove the type | **BUILD 2 (`comment`, `status_change`), REMOVE 5** | 2026-08-06 |
| D7 | F19 | Do preferences suppress, or is the screen hidden? | suppress for real · hide the screen | **SUPPRESS FOR REAL** — enforced at the `createMany` chokepoint | 2026-08-06 |
| D8 | F19 | The `email_enabled` per-type toggle | wire the channel · drop the toggle | **DROP THE TOGGLE** — the channel never existed | 2026-08-06 |
| D9 | F20 | Search engine | real FULLTEXT indexes · LIKE with better ordering | **BETTER LIKE** — zero schema change | 2026-08-06 |
| D10 | F23 | Collection envelopes | fix now (breaking) · document only | **DOCS-ONLY** + align the one true mismatch | 2026-08-06 |
| D11 | F27 | Name uniqueness | create-only · create **and** rename | **CREATE AND RENAME** — spaces, lists, roles | 2026-08-06 |
| D12 | F28 | The build-or-remove batch — seven items | per item, see **D12.1 – D12.7** | **all seven answered** | 2026-08-06 |

**Answer D1, D2 and D3 before F1 starts.** The rest can be answered at their own phase.

> **A note on the numbering.** Rows D7–D12 above were renumbered at the F28 close-out. D7 of the
> original plan bundled two independent questions — "do preferences suppress?" and "what happens to
> the email toggle?" — and F19 answered them separately, which consumed D8 and shifted every later
> row by one. The body sections below, `FIX-LOG.md`, `STATUS.md` and the results files all use the
> shifted numbering, so **the shifted numbering is canonical** and the table is what moved to match
> it. D12 kept its number because `results/F04.md` and the plan already cite it as the F28 batch;
> its seven answers are therefore **D12.1 – D12.7** rather than D12–D18.
>
> The original D12 row also listed **SSE** as a build-or-remove item. No SSE issue was ever filed —
> the only reference in `testing/ISSUES.md` is a note that the SSE registry is in-process, which is
> a scaling observation, not a decision. Dropped from the batch rather than invented into one.

---

## D1 — answered: production is NOT in use

Consequence: **Block A needs no backfill script.** The only timestamp data that exists is the local
demo seed, which is disposable. F3 (the highest-risk phase in the plan) drops from 🔴 to 🟡 — it
becomes a pure code change with a re-seed, not a data migration.

## D2 — answered: Dhaka is the business clock
### ⚠️ REVISED BY F3 (2026-08-03): storage is **UTC**; Dhaka is applied above it

**The decision stands, the implementation changed.** The intent — "this is a Dhaka company, the
system should behave on Dhaka's calendar" — is fully honoured. What F3 changed is *where* the zone is
applied: not in the MySQL session, but at the display and business-day layers.

**Why the original settings were unimplementable.** F1's probe showed that Drizzle's mysql `timestamp`
mapper hardcodes `+0000` in **both** directions (`mapFromDriverValue: new Date(value + "+0000")`).
A Dhaka session is therefore wrong *by construction*, no matter what the application does. The row
below that read "Drizzle TIMESTAMP handling must stop reinterpreting as UTC" was the whole problem:
making it stop would have meant a custom column type threaded through ~15 files. Pinning the session
to UTC instead makes the driver's existing assumption *true*, and took one line.

| where | ~~as decided 2026-07-30~~ | **as shipped in F3** |
|---|---|---|
| MySQL session `time_zone` | ~~`+06:00`~~ | **`+00:00`** (`DB_TIMEZONE`, dev *and* prod) |
| mysql2 driver `timezone` | ~~`+06:00`~~ | **`+00:00`** — same value, same place in `db/client.ts` |
| Drizzle TIMESTAMP handling | ~~must stop reinterpreting as UTC~~ | **unchanged** — its assumption is now correct |
| process `TZ` | `Asia/Dhaka` (pm2) | unchanged, but nothing may *depend* on it |
| SQL "now" | ~~`NOW()`, never `UTC_TIMESTAMP()`~~ | **`UTC_TIMESTAMP()`** — identical under a UTC session, and correct under any other |
| SQL "today" (business day) | ~~`CURDATE()` is fine~~ | **never `CURDATE()`** — bind `dhakaToday()`; these are Dhaka business days |
| DATE columns | ~~`dateStrings: true`~~ | **not** `dateStrings` — write and read both at UTC midnight |

**What the user sees is unchanged.** The API emits ISO-8601 `…Z` and the client renders local time;
"today", on-call weeks and due-date buckets are all computed on the Dhaka calendar via
`utils/dhakaTime.ts`. Storage clock and display clock are separate questions and only the first moved.

**The trade-off, restated.** The original entry accepted that a future second timezone would force a
migration. That cost is now gone — UTC storage is timezone-neutral. The cost we took instead is
smaller and purely human: a raw `SELECT` shows UTC, six hours off the wall clock, which *looks* like
the bug that was just fixed. Mitigated by documentation rather than configuration — **`SET
time_zone='+00:00'` before reading timestamps by hand** — in `server/.env`, `.env.example`,
`fixing/results/F03.md` and `fixing/STATUS.md`.


## D4 — answered: live check (2026-08-04)

The access token froze a `role` claim for up to 15 minutes and eight service gates trusted it.
**Chosen: the live check.** `liveLegacyRole()` reads the actor the RBAC resolver already resolves
on every authenticated request (version-stamped cache), so the fresh role costs nothing extra, and
a demotion takes effect on the NEXT request instead of after ≤15 minutes.

Rejected: **shorter TTL** — it would only shrink the window (never close it) and triples refresh
traffic, which is the very growth ISS-017 was filed about. **Accept 15 min** — the window is small
but a demotion is exactly the moment it matters.

**Scope of the answer:** this fixes WHICH ROLE a still-valid token claims (ISS-021). It does not
change whether a logged-out or deactivated user's token still authenticates — that ≤15-minute
bound (ISS-018) stays the documented auth-layer decision, re-measured in F10.

## D3.1 — settled in F6 (2026-08-04): COMPOSE, not replace

The plan delegated this sub-decision to F6 with a recommendation, and F6 adopted it with one
refinement. For the six service-shaped checks (`task.delete_hard`, `comment.delete_any`,
`attachment.delete_any`, `member.edit_profile`, `report.view`, `space.head_assign`):
feature-logic branches (self / author / uploader / department-head) stay untouched; the
admin/owner branch becomes `legacyAdmin && holds(key)`. Seeded roles behave exactly as today;
un-ticking a toggle takes real effect; granting to a non-admin custom role does nothing —
**compose cannot widen access**. The refinement: `report.view` must NOT be a route gate or
every department head (legacy member) loses dept-review. Full reasoning:
`fixing/evidence/F06/ROUTE_PERMISSION_MAP.md` §2. Reversible before F7 runs.

## D3 — answered: gate all 21

The catalog stays at **56 permissions and every one of them is enforced**. Nothing is removed from
the admin UI; instead the UI becomes truthful.

**Why this is now the right call.** When the plan was written I recommended the split (c), because
gating 21 permissions at once would change ~100 people's effective access on deploy day. **D1
removed that objection** — production is not live, so the only accounts affected are the 15 demo
users. The seeded roles can be tuned before anyone depends on them.

**What F7 therefore has to do — two sides, not one:**

| side | work |
|---|---|
| **routes** | `requirePermission` on ~60 currently ungated routes. `tasks.ts` alone has 18 routes and 0 gates; then `checklists.ts` (9), `attachments.ts` (6), `comments.ts` (4), `taskDependencies.ts` (3), `workspaceActivity.ts` (2), `engineering.ts` (4), `search.ts`, `home.ts`, `me.ts` |
| **seeded roles** | the 4 seeded roles were built to reproduce pre-RBAC behaviour EXACTLY while dormant. Gating 21 more permissions means those roles must now GRANT them in the same pattern the legacy roles allowed — otherwise the gates bite and people cannot work. |

**The acceptance test is behavioural, not structural:** the P5 enforcement probe must report **0 of
56 unenforced**, AND the P39 day-in-the-life must still score **22/22**. The second one is what
proves nobody lost a job function.

**One sub-question F6 must settle (not a blocker now).** ISS-024 records that `task.delete_hard` and
`comment.delete_any` are decided **only** by the legacy `users.role` column — raising or lowering the
RBAC grant changes nothing today. So F6 must choose: does RBAC **replace** the legacy check, or
**compose** with it (both must pass)? Recommendation: **compose** — legacy role as a floor, RBAC as
the fine-grained layer on top. It is the smaller change and it cannot accidentally widen access.

---

## D5 — the new password policy and existing users (F12, 2026-08-05)

**The question the plan asked:** does the new password rule apply to existing users at next login,
or only to new passwords? ~100 accounts are currently seeded with one shared password.

**ANSWERED BY DEFAULT — "new passwords only", no forced reset.** Not put to the user, because **D1
had already dissolved the question**: production is not live, so the ~100 accounts this decision was
written about do not exist. The only accounts in existence are 15 seeded demo users, and the seeded
credential `Owner@12345` satisfies the new policy anyway (11 characters, four character classes).

**What "force at next login" would have cost, for a population of zero:** a schema column
(`password_changed_at`, or a `must_change_password` flag) shipped through `schema.sql` + Drizzle +
an upgrade script per rule X4, a branch in the login flow, and a client screen to change a password
before proceeding. That is a feature, and rule X5 says F12 fixes the defect rather than the
neighbourhood.

**This is reversible and it is still the user's call.** If real accounts are created on weak
passwords before go-live, forced rotation becomes a small, separate piece of work — and the right
moment to do it is when there are real users to rotate, not now. Flagged here rather than buried in
the results file so it is easy to revisit.

**What DID ship for existing users:** nothing changes until someone sets a password. The moment they
do — via reset, change, or accepting an invitation — the new policy applies. All three surfaces share
one module, so there is no path that quietly keeps the old rule.

---

## D6–D10 — Block E decisions (F19/F20/F23, asked + answered 2026-08-06)

All four were put to the user in one batch before Block E began; all four answers were the
recommended option.

**D6 (F19) — the 7 producerless notification types: BUILD 2, REMOVE 5.**
`comment` and `status_change` get real producers — they are what a task manager is expected to do,
and both have an obvious trigger already in the code path. The other five leave the enum and the
settings UI: `due_soon`/`overdue` need a scheduled job that does not exist (and the user explicitly
deferred due/overdue delivery at the Phase-38 gate — building it now would reverse that decision
inside a fixing phase), and `pr_review`/`automation_failed`/`incident_alert` have no triggering
surface at all (no review-request flow, no automations, no incident pipeline). Removing a declared
type is honest; keeping a toggle for a thing that can never happen is the lie ISS-072 documents.

**D7+D8 (F19) — preferences become REAL for in-app; the email toggle is REMOVED.**
`notification_preferences` will actually suppress delivery (checked at produce time). The
`email_enabled` toggle goes away everywhere it appears: MailService sends exactly two
transactional mails (password reset, invitation) and nothing else — a per-type email channel is a
feature (templates, digests, rate limits), not a fix.

**D9 (F20) — better LIKE, not FULLTEXT.**
Description joins the predicate, `%`/`_` are escaped, a minimum length lands, and ordering becomes
relevance-shaped (exact custom_id, exact name, prefix, substring; recency as tiebreak). Zero schema
change. FULLTEXT stays on the table for a future scale problem — the DB has no FULLTEXT index today
and search is already the slowest endpoint; adding index-build + tokenizer tuning inside a fixing
phase is risk without a demonstrated need at ~5k tasks.

**D10 (F23) — envelope: DOCS-ONLY, plus the one true mismatch.**
The four response shapes become documented exceptions in API_DESIGN §1; only `/activity/recent` —
where spec and code genuinely contradict each other — gets aligned. Re-shaping `/forms`,
`/sprints`, `/sla/breached` would break the only client that exists for zero functional gain; if a
second client ever appears, that is the moment to revisit.

---

## D11 + the F26 gating scope (Block F, asked + answered 2026-08-06)

**D11 (F27) — enforce name uniqueness on CREATE *and* RENAME.**
The three catalog resources that already work (statuses, task types, tags) enforce on both paths, and
ISS-033's repro is explicitly two lines — a create AND a rename. Asked with data: the demo DB has
**0 collision groups** across spaces, lists, roles and custom fields, so nothing needs resolving
first. On a database that does hold duplicates, the first rename of a colliding row answers 409,
which is informative rather than destructive.

**F26 gating scope — nav + high-traffic actions.**
`SCAN-M5` names one concrete bug (the Sidebar's Engineering block renders unconditionally) and then
widens to "no action button anywhere is permission-gated". Gating all 56 permissions in the client
is what RBAC plan items P29–P30 are already scoped for; doing it here would duplicate that work at
Block-F speed. This phase does the named bug plus the buttons a wrong render actually costs someone
something: Create Space, Invite Member, Delete/Archive Task, and the Roles/Members settings entries.
`GET /me/permissions` is already wired, so the mechanism is in place for the rest.

---

## D12 — the F28 build-or-remove batch (asked with data + answered 2026-08-06)

Seven items, each put to the user with a measurement from the demo database rather than a
description. All seven took the recommended option. **Three of the seven questions changed shape
once the data came back** — those are marked ⚠ below, because the issue as filed was not the issue
as it exists.

### D12.1 — ⚠ the seeded Guest role: **tighten to read + comment** (ISS-094)

ISS-094 was filed during F26 naming **two** over-broad guest grants. The measurement found
**nineteen**, all at `scope = all`:

```
task.create  task.edit  task.assign  task.archive  task.delete
checklist.manage  dependency.manage  customfield.set_value  template.apply
sprint.assign_tasks  postmortem.manage  form.view_submissions
+ space.view  task.view  member.view  activity.view  assistant.use
  comment.create  bug.report
```

So a guest could **delete any task in the workspace** and **read every public-form submission** —
customer contact details, for a beauty/skincare ecommerce business. `bug.report` and
`postmortem.manage` were never the interesting part.

**This is not a seeding bug, and that matters.** `server/src/rbac/bootstrap.ts` says it outright:
the Guest role's own description is *"External collaborator. Same as a member today, except
uploading files"*, and the shared list is commented *"What ANY authenticated user can do today
(verified against §0.4)"*. The seeded roles were built to reproduce pre-RBAC behaviour **exactly**
so that turning RBAC on changed nobody's access (RBAC plan P0–P11). Before F7 none of these keys
gated anything, so the breadth had no effect. F7 made all 56 toggles real. The DB matches the seed
with **zero drift** — the seed was faithful; what it was faithful *to* was a product with no guest
concept.

**Chosen: Guest drops to 7 read-and-comment grants.** `space.view`, `task.view`, `member.view`,
`activity.view`, `assistant.use`, `comment.create`, `bug.report`. Member is untouched at 20, so no
internal job function changes and F7's P39 day-in-the-life result stands.

Rejected: **tighten Member too** (removing the two engineering writes) — Member is every internal
employee, the day-in-the-life test scored 22/22 against the current grants, and there is no
demonstrated harm in a 100-person company where sprint membership is a coordination act.
**Leave as seeded** — it keeps a guest able to delete other people's work until an admin happens to
notice, and D1 (production not live) means the tightening costs nothing now and gets expensive later.

**Consequence for F26:** the Sidebar's Engineering gate carries an extra `permRole !== "guest"`
term specifically because of this. It comes out — the grant check alone is now correct.

**Build outcome (2026-08-06).** Two things the decision could not have predicted, both from its own
regression fallout:

1. **`bug.report` became a key that opened no door.** The one write the new Guest keeps is "report
   a bug" — but the mechanism behind `POST /eng/report-bug` is a task insert, and the service
   asserts `task.create`. Route admitted, service 403'd. Fixed with a **named intake principal**
   (`rbac/principals.ts` §2b, new `ActorKind "intake"`): once the route proves `bug.report`, the
   insert runs under an actor carrying only `task.create` inside the Bug Triage list's space, and
   attribution stays the real caller (spec-pinned). The bypass lives in the one file
   `grep elevate` audits, per that file's own rule.
2. **The fallout mapped exactly onto the revoked keys — except two routes.** `tags.add` /
   `tags.remove` kept passing with a guest at 204, because those routes carry NO permission gate at
   all (no catalog key exists for tagging, so F7's sweep had nothing to attach). Filed as
   **ISS-095**, deferred to the RBAC write-scope backlog — a grant matrix cannot close a gate that
   does not exist. **(F34 close-out: fixed. The gate is `task.edit` on both tag routes + the F8
   service-depth scope check; every internal role holds the verb, the guest does not, zero grant
   changes — exactly the shape this note predicted.)**

### D12.2 — business hours become real; fiscal year is removed (ISS-029)

BeautyBooth runs `working_days = sun,mon,tue,wed,thu` with `business_hours 09:00–18:00` — a
**Friday–Saturday weekend**. SLA arithmetic is pure wall-clock, so an S0 bug filed 17:30 Thursday
is due 19:30 Thursday: after hours, on the last working day before a two-day weekend. Nobody is
measured against a deadline they could meet.

**Chosen: `working_days` + `business_hours` drive SLA deadlines; `fiscal_year_start_month` is
removed** from schema, Drizzle and the settings page. There is no financial-reporting surface in
this product and no plausible consumer for a fiscal year. `week_starts_on` stays — it is the one
setting of the five that a consumer genuinely reads (`CalendarMonthGrid`, `CalendarView`,
`date-utils`).

Rejected: **remove all three** — it makes the UI honest by giving up on the deadline ever being
meetable, and the SLA feature is the escalation path for a complaint-handling business.
**Build all four consumers** — threading working days through overdue buckets, agenda, the
department-report window and a fiscal-period grouping in `/reports` is a feature build across four
subsystems, which rule X5 puts outside a fixing phase.

**The change is free of data risk.** `sla_due_at` is NULL on all 46 demo tasks, so nothing is
recomputed. Worth recording *why*, because it looked like a bug: `computeSlaDueAt` is called on both
the create and update paths (`TaskWriteService.ts:552`, `:918`), but `seed-demo.ts` writes task rows
straight through Drizzle (`db.insert(S.tasks)`), bypassing the service. The eight Bug/Complaint tasks
in the demo set therefore never went past the producer. Production, where tasks are created through
the API, does set the column.

### D12.3 — ⚠ checklist items stay date-free; the **assignee** gets a UI (ISS-070)

ISS-070 frames this as *"who without by when"* — an item can be assigned but not dated. The
measurement inverts it: **zero of the 14 checklist items have an assignee**, and
`ChecklistsSection.tsx` (430 lines) contains no assignee control at all. The column is validated
carefully — `checklist_item.invalid_assignee` fires correctly for an unknown id and for an
`invited`-status user — and is reachable only by calling the API by hand. It is not "who without
by when". It is neither.

**Chosen: no new column; expose the assignee that already works; document the deliberate absence.**
A per-item due date is a *second deadline system*. To be visible it would have to be read by My
Work, Agenda, the overdue KPI, notifications and the calendar — all of which key on
`tasks.due_date`. Shipping the column without those readers produces exactly the ISS-029 pattern
this same phase is closing: a field stored, validated, and consulted by nothing. And the product
already has a primitive that carries an owner, a date and full visibility everywhere: a **subtask**.

Rejected: **build it fully** (column + validator + serializer + UI + four integrations) — a feature.
**Pure documentation** — leaves the validated-but-unreachable assignee in place, which is the dead
surface this block exists to remove.

### D12.4 — build a compact SLA breach queue (ISS-082)

`GET /sla/breached` has zero callers; there is no `slaApi` in the client at all. The server half is
complete and tested (`SlaRepo` / `SlaService` / `SlaController`, 24 tests), and `SLABadge` does ship
on the task drawer — so a task's own deadline is visible, but the queue the endpoint was built to
produce is not reachable from any screen.

**Chosen: build the page.** ISS-082's own sequencing note — *do not build a UI on a report that is
six hours wrong* — is satisfied: F3 fixed the clock and F4 verified the arithmetic. The deciding
argument is Home: F24 has just made the KPI tiles honest, and `slaBreaches` is one of them. A
truthful number that links nowhere is the same dead end one layer up. The page makes the KPI
clickable and the endpoint live.

Rejected: **drop the endpoint** — it discards the only aggregate view of an otherwise complete
feature. **Document as API-only** — the same end state as today with a paragraph attached.

### D12.5 — the locale control becomes read-only (ISS-028)

Three layers disagree: `GET /workspace` returns `default_locale`, the settings page renders a fully
editable `<Select>`, `workspaceToWire` silently drops it, and the API would answer **422** if it
ever arrived. The user picks a locale, sees *"Workspace saved"*, reloads, and it is unchanged.

**Chosen: disable it with a hint.** The same page already does exactly this for Workspace ID —
`disabled`, with *"cannot be changed"*. Copying a pattern that is already on screen is the smallest
truthful change and needs no server work.

Rejected: **make it saveable** — nothing in the client reads a locale (there is no i18n layer), so a
working control would store a value with no consumer, which is the ISS-029 defect wearing a
different hat. **Remove the row** — the workspace does have a locale and the page is the only place
a person can see it.

### D12.6 — `DELETE /sprints/:id`, guarded against active sprints (ISS-013)

A sprint created with wrong dates or a typo'd name is permanent; ISS-013 was hit for real while
cleaning up test data. The schema was already designed for the delete: `tasks.sprint_id` is
**`ON DELETE SET NULL`**, so removing a sprint detaches its tasks instead of destroying work.

**Chosen: build it behind `sprint.manage`, and refuse a sprint whose status is `active`** with a
distinct code. Planned and completed sprints delete freely; an in-flight sprint has to be closed or
re-planned first. That keeps the cleanup story — the whole point of the issue — while making an
accidental mid-sprint wipe take a deliberate second step, in the same spirit as the `space.archived`
and `task.archived` guards F22 made real.

Rejected: **no status guard** — one click silently un-sprints every in-flight task.
**Do not build it** — leaves SQL as the documented cleanup route for a routine mistake.

### D12.7 — ⚠ a list can be **moved**; `is_private` stays frozen (ISS-036)

The issue bundles two capabilities and the data separates them.

**The move is real work.** A list created in the wrong department is stuck there, and the only route
is to recreate it and hand-move every task — with no bulk move. For an 8-department workspace where
complaint work plausibly starts in Customer Service and belongs in Complain Department, this comes
up. **Chosen: `PATCH /lists/:id` accepts `space_id`**, with the target validated as in-workspace and
un-archived, and a **409 `list.duplicate`** when that space already holds a list of the same name —
F27's `uq_lists_space_name` makes this a live case rather than a theoretical one. No collisions
exist today: no list name occurs in more than one space.

**`is_private` is not.** `server/src/rbac/scope.ts:125` states it plainly — `lists.is_private` *"is
enforced nowhere today"* — and the RBAC plan already decided it stays decorative, with narrow
`space.view` as the real mechanism. Zero of 13 lists are private. Making it editable would ship a
toggle a user can switch on while every member keeps seeing the list: a new instance of the exact
defect D12.5 and D12.3 are removing. **Chosen: leave it frozen and say why.**

Noted rather than hidden: the two resources are *inconsistent* — `SpacesController` does accept
`is_private` on PATCH while `ListController` does not. That inconsistency is now deliberate and
documented, not an oversight.

**One consequence to carry forward.** Visibility in this product is space-scoped. Moving a list
therefore changes **who can see its tasks** — that is the feature, not a side effect, but it is the
kind of thing that surprises someone at 6pm, so it is documented on the endpoint.
