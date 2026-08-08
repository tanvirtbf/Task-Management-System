# Fix Log

One entry per fixed issue. Format:

```markdown
### ISS-nnn — fixed in Fxx (YYYY-MM-DD)
- **Was:** the defect, in one line
- **Change:** file:line — what was actually changed
- **Schema:** none | schema.sql + Drizzle + upgrades/NNN_x.sql   (rule X4)
- **Before/after:** fixing/evidence/Fxx/<file>
- **Regression gate:** which suites were run, and the result
- **Side effects:** anything a reader would be surprised by
```

### F1 — clock probe built (2026-08-03) — no issue fixed, by design
- **Deliverable:** `fixing/evidence/F01/clock-probe.cjs` — the pass/fail gate for F2–F5
- **Baselines:** 4 configurations captured (dev, TZ=UTC, production, production-minus-TZ) —
  all four show the same 12 drifting observations, so the drift is not configurable away
- **Finding:** ISS-058's DATE-shift evidence corrected. Drizzle `date()` defaults to
  `mode: "string"`, so DATE columns never become a JS Date and never drift. ISS-058's primary
  claim (`workspaces.timezone` is read by nothing) stands unchanged.
- **Plan change:** F2 rescoped from a fix to a dead-code cleanup and marked optional;
  F3 now has an executable acceptance gate.
- **Result:** `fixing/results/F01.md`

### ISS-001 — fixed in F3 (2026-08-03)
- **Was:** every TIMESTAMP was stored 6 h off, because Drizzle's mysql timestamp mapper hardcodes
  `+0000` in both directions while the MySQL session was Dhaka
- **Change:** `server/.env` — `DB_TIMEZONE=+00:00`. That single line is the whole clock fix; it makes
  the assumption the driver already hardcodes actually true. `server/.env.example` documents it.
- **Schema:** `schema.sql` + `_post.sql` + `upgrades/005_clock_views.sql` (views only — no table
  changed, so no Drizzle schema edit was needed)
- **Before/after:** `fixing/evidence/F03/after.txt` (TZ=Asia/Dhaka) · `after-utc.txt` (TZ=UTC) —
  both exit 0, 12/12 observations at 0.00 h. Baseline was `F01/before-*.txt`.
- **Regression gate: PASSED.** Full server jest sweep — 31 modules, ~3,500 tests,
  `fixing/evidence/F03/jest-sweep.txt`. Every module green except two, both pre-existing and both
  filed: `users` 1/279 (**ISS-093**, byte-identical to the PHASE-42 baseline) and `tasks` 1/359
  (**ISS-087**, the 50-parallel-read pool exhaustion, reproduces on an idle box).
  `tasks` was re-run cleanly against final code — 4 failed → 1 failed once the stale `my-work` DATE
  fixture was repaired (`fixing/evidence/F03/tasks-clean.txt`). The modules that carry this fix are
  all green: oncall 81, sprints 150, eng 78, sla 24, deptreview 122, collab 47, home 23, jobs 31,
  notifications 84, rbac 286.
- **Side effects — five, all handled in-phase, all of them silent:**
  1. **DATE columns shifted a day.** Dhaka local midnight is 18:00 the previous day under a UTC
     session, and a DATE column truncates it — `2026-08-10` was landing as `2026-08-09`. Fixed by
     re-centring both ends on UTC midnight: `toLocalDate` → `toDateOnly` with `Date.UTC` in
     `TaskWriteService` (8 sites), `SprintsService` (4), `OnCallService` (1); `toWireDate` → `getUTC*`
     in `taskSerializer` + `onCallSerializer`.
  2. **The on-call roster would have rolled over 6 h late.** `week_start`/`week_end` hold Dhaka
     business days but both live paths compared them against SQL `CURDATE()`, which follows the
     session zone. `OnCallRepo.findCurrent` and `EngineeringRepo.findCurrentOnCallEngineerId` now bind
     `dhakaToday()` (`utils/dhakaTime.ts`, offset-based, independent of session zone *and* box TZ).
     Proof across a simulated week edge: `fixing/evidence/F03/oncall-frame.txt`.
  3. **`OnCallService` stored a six-day week — the worst of the five.** After (1) moved `weekStart` to
     UTC midnight, `weekEnd` was still rebuilt from that date's *local* components, mixing frames in
     one function. `PUT /on-call/2026-09-07` stored `week_end = 2026-09-12`, not `2026-09-13`, so
     **Sunday had no engineer on call** — and the endpoint still returned 200. Found by reading the
     diff, not by a test. Fixed by adding the 6 days in UTC.
  4. **Two more stored-DATE readers, and the seed.** `sprintSerializer.formatWireDate` and
     `EngineeringService.ymd` (the 2nd and 3rd hand-rolled copies of the same helper) read sprint
     DATEs with local components → `getUTC*`. `db/seed-demo.ts` built its DATEs at local midnight, so
     every seeded due date / sprint boundary / on-call week landed a day early — which matters because
     the seed *is* the fixture every later phase restores to.
  5. **`TaskWriteService.ymd` was doing two different jobs.** It formatted stored DATEs *and* derived
     "today". Flipping it wholesale to UTC would have fixed the first and broken the second — the
     same 6 h bug as (2), in the my-work buckets. Split into `storedDateYmd` (UTC) and `dhakaToday()`
     (business day). `HomeService.ymd` deliberately untouched: it only ever sees now-instants, which
     makes it ISS-058 / F5's.
- **Test fixtures, not the product, were wrong afterwards.** `makeSprint` / `makeOnCallShift` and four
  suites' private `toLocalDate` copies all built DATE fixtures at local midnight, so they inserted a
  row one day before the API read it back. Consolidated into `tests/test-utils/dates.ts` — one
  documented place to build a DATE fixture, instead of six copies free to drift apart again.
- **Read this before debugging timestamps by hand:** a SQL client must `SET time_zone='+00:00'` to see
  what the app sees. A default-session `SELECT` looks 6 h off and is **not** a bug —
  `fixing/evidence/F03/frame-note.txt` shows the same row under three frames.

### ISS-052 — fixed in F3 (2026-08-03)
- **Was:** `updated_at` could land *before* `created_at`, and the ETag moved with it
- **Change:** none of its own — it was a symptom of ISS-001. The two writers (Drizzle
  `touchUpdatedAt`, MySQL `ON UPDATE CURRENT_TIMESTAMP`) still both exist, but they no longer run on
  different clocks, so the column cannot move backwards.
- **Before/after:** `fixing/evidence/F03/after.txt` — `updated_at >= created_at ?  yes (0h)`

### ISS-081 (a, b, c) — fixed in F3 (2026-08-03)
- **Was:** an S0 bug was born already SLA-breached (stored −240 min instead of +120), the breach
  report was a further 6 h late, and `/sla/breached` disagreed with `v_breached_sla`
- **Change:** none of its own — all three were ISS-001. `005_clock_views.sql` additionally pins the
  view to `UTC_TIMESTAMP()`, which the live copy had drifted off, so it cannot silently skew again.
- **Before/after:** `fixing/evidence/F03/issue-verification.txt` — S0 stored at +120 min and not
  breached; a 60-min-late task reports `minutes_breached=60`; endpoint and view both list it

### ISS-033 + 035 + 027 + 026 — fixed in F27 (2026-08-06) — Block F closed
- **Was:** of eight named resources, three enforced case-insensitive uniqueness and five did not —
  and the three that worked were the CATALOG resources while the ones that did not were the
  NAVIGATION resources, where a duplicate hurts most. The workspace really did hold two spaces
  called "Marketing" (one with three lists and a head, one empty) rendering identically in the
  sidebar. And a system role could be RENAMED though it could not be deleted.
- **Change:** the working implementation copied exactly — a UNIQUE index on the same
  `utf8mb4_unicode_ci` columns (case-insensitive, race-free) plus an ER_DUP_ENTRY → 409 mapping:
  spaces (workspace_id, name) → space.duplicate · lists (space_id, name) → list.duplicate · roles
  (workspace_id, name) → role.name_taken. **D11: create AND rename.** Plus a rename guard on system
  roles, the same shape as the delete guard.
- **Schema (X4):** `upgrades/010_name_uniqueness.sql` + schema.sql + Drizzle (hierarchy.ts,
  rbac.ts). Archived rows included on purpose — a restore must not recreate the duplicate.
- **Before/after:** `fixing/evidence/F27/f27-probe.txt` — 22 checks: every create AND rename
  collision, the cross-space negative case, each indexed column's collation, and the three catalog
  resources re-checked to prove the pattern was copied not reinvented.
- **Regression gate:** spaces · lists · rbac · customfields · tags · statuses · taskTypes.
- **The QA database had REAL duplicates and the migration said so.** `010` applied cleanly to
  `taskmanagement` and failed loudly on `taskmanagement_qa` naming the colliding values
  ("P35 Activity Space", "Bug Triage") — which is the script behaving as documented. Six scratch
  rows were RENAMED (suffixed), not deleted, and it then applied 15/15, twice.
- **Correction to ISS-026:** its repro records the delete guard as "409"; `DELETE` on a system role
  has always answered **403**. The rename guard matches it, and the probe asserts both.

### SCAN-M5 + ISS-042 + ISS-023 + ISS-038 — fixed in F26 (2026-08-06)
- **Was:** the Sidebar's Engineering block rendered UNCONDITIONALLY (every Marketing-only user saw
  Eng Home, Sprint Board, On-call), no action button anywhere was permission-gated,
  `hidden_from_guests` appeared in no validator and no serializer so the one guest-redaction
  control could not be switched on, one of eleven redaction call sites hardcoded `false`, and the
  status-reorder endpoint had zero UI callers.
- **Change:** the Engineering block gated on the engineering-domain grants (plus a not-a-guest term
  — see ISS-094); sidebar menu entries + Invite member + task archive/restore + permanent delete
  each gated on the key the ENDPOINT enforces; `hidden_from_guests` threaded through
  validator/serializer/repo/service; `ReviewsService` computes `redactGuest`; move-earlier /
  move-later arrows on `/settings/statuses`.
- **Schema:** none
- **Before/after:** `fixing/evidence/F26/f26-probe.txt` — 22 checks including live
  `/me/permissions` reads for owner / engineer / marketing-only / guest, and the reverse direction
  (the SERVER refuses what the client now hides).
- **NEW ISSUE FILED (rule X1): ISS-094** — the seeded **Guest** role holds `postmortem.manage` and
  `sprint.assign_tasks` at scope=all, reachable since F7 made those route gates real. Not fixed
  here (it is a grant-matrix decision, F28's). It is why the nav gate needs the extra role term; the
  code says to drop that term once the grants are right.
- **Scope, stated:** nav + high-traffic actions, per the answered scope question — gating all 56
  permissions is what RBAC plan items P29–P30 already own.

### ISS-050 + 054 + 055 + 066 + 069 — fixed in F25 (2026-08-06)
- **Was:** "Delete" and "Archive" were two labels for ONE soft delete and neither could be undone
  (`tasksApi` had no `unarchive`, 0 callers); the dependency picker could only ever create
  "blocks" and only from the current list; `#T-<n>` — the key the UI displays for 43 of 46 tasks —
  resolved against nothing; checklists nested on the server and rendered flat on the client.
- **Change:** `unarchive` wired + the drawer menu toggles Archive/Restore + "Delete permanently"
  sends `?hard=true` behind a confirm (bulk toolbar too); two direction buttons whose mutation
  maps onto the stored edge; the picker searches the WORKSPACE (visibility-filtered, F20-ranked);
  `#T-<n>` resolves inside the HOST LIST — `task_number` is unique per list only, thirteen tasks
  here are "T-1", so a workspace-wide lookup would have to guess; the client builds the checklist
  tree and offers add-sub-item.
- **Schema:** none
- **Before/after:** `fixing/evidence/F25/f25-probe.txt` — 22 checks, each client fix verified BOTH
  ways (the server behaviour live + the client source).
- **The probe caught a bug in my own change:** the picker first passed `types: ["tasks"]`; the
  valid `SearchType` is SINGULAR and the service silently drops unknown tokens, so it would have
  searched nothing — the exact "accept and discard" failure F23 spent a phase removing.

### ISS-057 + 056 + 059 — fixed in F24 (2026-08-06)
- **Was:** every KPI card carried a hardcoded "— 0.0%" trend badge and a sparkline that plotted
  `DATE(created_at)` rather than the metric ("Open Team Tasks 31" above a line summing to 4); the
  Agenda card rendered `formatTime` on a DATE column so every row read "6:00 AM" and its sort was
  a no-op; and "Awaiting My Review" counted `pr_status='open'`, NULL on every task, so the tile
  was 0 for everyone forever.
- **Change:** `HomeKpi` is label + value + valueDisplay, nothing else (a real trend needs task
  status history, which is not stored — so it stays unbuilt rather than faked); the agenda column
  carries PRIORITY and sorts by it; awaitingReview counts completed-but-unreviewed tasks in a space
  the caller HEADS, keeping the named-reviewer arm.
- **Schema:** none
- **Before/after:** `fixing/evidence/F24/f24-probe.txt` — 21 checks, and critically the six
  NUMBERS are recomputed in independent SQL for two accounts and matched, so the refactor did not
  disturb the values P19 verified by hand.

### ISS-007 + 008 + 010 + 012 + 014 + 040 + 048 + 067 — fixed in F23 (2026-08-06) — Block E closed
- **Was:** `limit` a decoration on four §1 endpoints; `garbage` cursors restarting pagination
  WITH a fresh next_cursor (a retrying client looped forever); a mistyped filter returning the full
  set; checklist-item PATCH answering 200 to fields it discarded (`is_completed` included — the
  obvious way to tick a box); POST silently dropping what PATCH refuses; misdirected task-PATCH
  fields told "you sent no fields"; the error catalog documenting 37 of 140 codes; four response
  shapes with one genuine spec-vs-code contradiction.
- **Change:** shared `utils/pagination.ts` (`paginateArray` + `strictDecodeCursor` round-trip)
  wired into 4 controllers + 6 cursor decoders; `allowQuery` middleware on the 5 primary
  collections; a closed body set on checklist-item PATCH (422 pointing at /toggle); server-owned
  fields refused on task-type create; misdirected-field 422s that name the right door; §1 documents
  the four families (D10, docs-only) and /activity/recent's spec now matches the code; §32
  REGENERATED from source — 129 codes, generator in evidence.
- **Schema:** none
- **Before/after:** `fixing/evidence/F23/f23-probe.txt` — 30/30.
- **Regression gate:** the 16-module consolidated run (`gate-final.txt`).

### ISS-011 + 019 + 020 + 034 + 051 — fixed in F22 (2026-08-06)
- **Was:** three §32 promises unenforced (in-use tags silently stripped on delete; a blocked task
  completed regardless; overlapping sprints coexisted); deactivation silently orphaned a
  department's headship forever; the last-admin rule existed only on the RBAC path; archived
  spaces stayed editable and archived tasks took comments + dependency edges.
- **Change:** `tag.in_use` / `task.cannot_complete_blocked` (single + fail-atomic bulk) /
  `sprint.overlap` (create + date update); `clearHeadships` REMOVED (headship survives — the
  issue's own first option; sessions are already revoked so it costs nothing);
  `role.last_admin` backstop on the legacy role-PATCH + deactivate (unreachable while an active
  owner exists — stated honestly — proven by forcing the ownerless state); `space.archived` on
  PATCH; `task.archived` on comments and dependency creation.
- **Schema:** none
- **Before/after:** `fixing/evidence/F22/f22-probe.txt` — 19/19.
- **Regression gate:** consolidated + **day-in-the-life 47/47** — which caught a BACKWARDS
  dependency edge in the F7 fixture (its own label said t2 was the blocker; the edge said t1),
  invisible until the rule became real. Fixture corrected to its own stated intent.

### ISS-049 + 061 + 062 — fixed in F21 (2026-08-06)
- **Was:** `task_updated` recorded key names but no values and logged no-ops; bulk left
  `{"bulk":true}` × N; checklist create/delete left no trace; the client activity switch spoke
  the MOCK's vocabulary (7 of 9 cases never emitted; 11 of 13 real codes raw snake_case).
- **Change:** `scalarChanges` diff → per-field `{from,to}`, no-op = no row, status-only = only
  `status_changed`, bulk diffs per-target (meta keys excluded — the probe caught
  `archived_at_provided` leaking); four checklist activity writes (deletes carry the name/text —
  the row is gone, the trace is where it survives; four inputs gained actorId); the client map now
  covers the REAL 27-code vocabulary with the probe re-deriving the set from source so the next
  drift fails a check.
- **Schema:** none
- **Before/after:** `fixing/evidence/F21/f21-probe.txt` — 12/12; client vitest 44/44.

### ISS-074 + 075 + 076 — fixed in F20 (2026-08-06) — D9: better LIKE
- **Was:** descriptions unsearched (comments were!); results oldest-first; `%`/`_` wildcards in
  user input; no minimum on `q`.
- **Change:** description in the predicate; relevance ladder (exact custom_id → exact name →
  prefix → substring → recency; users prefix-first); `q` 2–200 (escapeLike already existed —
  it arrived with RBAC P18).
- **Schema:** none (D9 keeps FULLTEXT for a future scale problem).
- **Before/after:** `fixing/evidence/F20/f20-probe.txt` — 13/13; latency p50 32 ms (old figure
  125 ms — no regression from the ORDER BY).

### ISS-064 + ISS-072 — fixed in F19 (2026-08-06) — D6/D7/D8
- **Was:** commenting notified NOBODY (the only reach was @mention); 7 of 12 notification types had
  no producer; the preferences screen governed nothing; `email_enabled` promised a channel with
  no implementation.
- **Change:** `comment` + `status_change` producers (assignees + watchers, minus author/actor,
  minus already-mentioned); enum 12 → 7 (`upgrades/009`, X4, idempotent 9/9 twice); preference
  suppression at the ONE chokepoint (`NotificationsRepo.createMany`) so every producer — current
  and future — obeys; `email_enabled` removed at every layer (a body carrying it gets a 422 that
  says why).
- **Schema:** `upgrades/009_notification_types.sql` + schema.sql + Drizzle.
- **Before/after:** `fixing/evidence/F19/f19-probe.txt` — 23/23 with DELTA counts, all seven
  surviving types produced live (report_ready via the real weekly job).
- **Probe lesson:** the first cut filtered on a bound JS-Date and misread same-second rows — 11
  false FAILs and a cleanup that ate 6 baseline reports (restored by re-running the job). Delta
  counting, not timestamp binding.

### ISS-044 + ISS-071 + ISS-077 + ISS-032 + ISS-037 + ISS-078 — fixed in F18 (2026-08-06)
- **Was:** six validation holes. An unknown `reviewer_id` on CREATE was the one unvalidated
  reference (raw 500); a 300-char `X-Filename` was a raw 500 on the exact path the client uses; the
  API generated a `public_slug` its OWN validator refuses (a form could never be written back
  unchanged); `POST /spaces` silently dropped the `head_user_id` that PATCH refuses; and both
  reorder endpoints accepted non-permutations — all-statuses-at-0, or one-item-of-three leaving two
  rows colliding at position 0, which made the PUBLIC form's question order change between requests.
- **Change:** create runs update's reviewer check; the proxied upload applies the presign path's
  255 rule (post-decode); `randomToken(6).toLowerCase()`; one shared `assertValidHead` + the
  create validator rule + the value actually carried through and written + the same
  `space.head_assign` permission F7 put on PATCH (create was a bypass); both reorders now demand
  the full set exactly once with distinct positions (422s that say "got 1 of 5").
- **Schema:** none
- **Before/after:** `fixing/evidence/F18/f18-probe.txt` — 16 checks: every repro the right 4xx AND
  every matching happy path intact (a validator that refuses everything also "fixes" a 500).
- **Regression gate:** the consolidated 8-module gate on the settled tree (`F16/gate-final.txt`).
- **Side effect worth knowing:** creating a space with a head now needs `space.head_assign` (all
  seeded admin+ roles hold it — zero behaviour change for the seeded matrix).
- **Nine stale specs updated** (8 reorder + 1 unarchive), each of which asserted the PRE-fix
  behaviour — three pinned ISS-037 verbatim and one pinned ISS-041 (its fixture reused one
  ARCHIVED_AT constant for space AND list, unknowingly forging the cascade signature). After the
  updates: statuses 209/209, spaces 244/244.

### ISS-025 — fixed in F17 (2026-08-06) — rule X9 fully retired
- **Was:** the dev DB predates migration 0005 and missed `form_submissions.encrypted_at`/
  `expires_at` — submissions list 500, PUBLIC intake 500, expiry job "Unknown column". A fresh
  `db:setup` has the columns (P41), so this was drift between schema.sql and one live DB.
- **Change:** `database/upgrades/008_form_submission_retention.sql` — both columns + the
  `expires_at` index, each gated on information_schema via prepared statements (MySQL 8 has no
  ADD COLUMN IF NOT EXISTS). Applied to dev + QA; idempotent (16/16 twice). Backfill: legacy rows
  keep `encrypted_at=NULL` honestly (they WERE stored unencrypted) but get
  `expires_at = submitted_at + 90d` so PII still ages out.
- **Schema:** upgrades/008 only — schema.sql + Drizzle already declared the columns; they were never
  the drifted side.
- **Before/after:** `fixing/evidence/F17/before.txt` (dev 0/2 vs QA 2/2 + the three 500s live) /
  `after.txt` (200 / 201-encrypted-stamped-90d / ok:true).
- **Regression gate:** `forms` + `jobs` in the consolidated gate.
- **X9 is now fully retired.** F15 dropped the stale triggers; this closes the column drift. The
  F7/F8/F15 probes' add/drop protocol was DEFUSED in the same phase — their cleanup DROPs would have
  silently reintroduced the drift on any re-run. Nothing in the dev database is deliberately broken
  any more.

### ISS-073 + ISS-022 + ISS-041 — fixed in F16 (2026-08-06) — the orphan sweep is 24/24
- **Was:** hard-deleting a task left its notifications in every inbox pointing at a 404 (the ONLY
  child table that orphaned — P37: 23 of 24 clean) and stranded its R2 objects forever (the FK
  cascade removed the attachment rows before the purge job — which reads soft-deleted rows — could
  learn the objects existed; P4 deleted four stranded objects by hand). And un-archiving a space did
  not restore the lists archiving it took down — Marketing's three boards were invisible for ninety
  minutes in P8.
- **Change:** inside the hard-delete transaction: `deleteByEntity("task", subtree)` +
  `enqueueR2Purge(keys of the whole subtree, soft-deleted rows included)` into the new
  `r2_purge_queue` table (X4: upgrades/007 + schema.sql + Drizzle); the r2-purge job drains the
  queue objects-first-row-second, dry run reports `wouldDrainQueue`. Unarchive restores exactly
  `lists WHERE archived_at = <the space's archivedAt>` — the archive cascade already stamps that
  instant and skips already-archived lists, so the equality is the exact inverse and cannot
  resurrect an independently-archived list (the old comment claiming otherwise is replaced; the
  audit row carries `lists_restored`).
- **Schema:** `upgrades/007_orphans_and_cascades.sql` (+ an idempotent sweep of pre-existing
  notification orphans).
- **Before/after:** `fixing/evidence/F16/f16-probe.txt` — 12 checks with REAL R2 traffic, then
  P37's full 24-query orphan sweep: **24 of 24 clean**.
- **Regression gate:** `gate-final.txt` — the 8-module consolidated run. The FIRST gate run
  (`gate.txt`) straddled F18's edits mid-run and its spaces/lists rows are VOID (lists 171/171
  failed = the mass-fail signature of compiling a broken intermediate tree, not 171 real bugs). Kept
  as a worked example of the straddle rule.
- **Recorded edge:** `archived_at` is second-precision; a list archived independently in the SAME
  second as the space-archive would be restored with it. Sub-second, harmless, schema-cost to fix.

### ISS-065 + ISS-080 + ISS-046 — fixed in F15 (2026-08-05) — the counters, + SCAN-H4
- **Was:** one bug three times. Each counter was maintained by a rule that did not match how the app
  writes: `comments_count` had an AFTER DELETE trigger but the API SOFT-deletes (so it only ever
  went up); `forms.submission_count` was INSERT-only while the retention job DELETEs;
  `subtasks_count`/`subtasks_completed` were maintained by NOTHING and every task reported 0/0.
- **Change:** `trg_comments_after_update` + `trg_form_submissions_after_delete` (both modelled on
  `trg_attachments_after_update`, the one that was always right — moves both ways, understands soft
  delete). Subtasks CANNOT be triggers (MySQL forbids a `tasks` trigger from modifying `tasks`),
  so `TasksRepo.recomputeSubtaskCounters()` + six call sites in `TaskWriteService`.
  **Recompute, not increment** — the other two bugs were increment rules that drifted the moment a
  write took an unforeseen path; an absolute recompute repairs whatever a caller misses.
- **Schema (X4):** `database/upgrades/006_counters.sql` + `database/schema.sql`. **No Drizzle
  edit** — no column added or changed. All three counters backfilled in the same script; idempotent
  (applied twice, 10/10 both times).
- **Before/after:** `fixing/evidence/F15/f15-probe.txt` — 18 checks, every counter compared against
  a live COUNT rather than an expected number. delete a comment 3->2 (was stuck at 3); the retention
  job 3->2; subtasks 2/0 -> 2/1 -> 2/0 -> archive 1/0 -> unarchive 2/0 -> bulk 2/2 -> hard delete 1/1.
- **Regression gate:** collab 47/47, tasks, forms, attachments.
- **SCAN-H4 closed as a PRECONDITION, not a bonus.** The first run turned every subtask status change
  and every hard delete into a 500 —
  `ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG` — because the dev DB still carried the three stale
  `trg_subtasks_after_*` triggers (absent from schema.sql, the QA DB and production). Rule X9 had
  preserved them until this phase precisely so the crash could be confirmed first-hand; it was, and
  `006_counters.sql` drops them as step 0. Dev went 12 triggers -> 11, QA 9 -> 11 (both now carry
  F15's two new ones).
- **MySQL 1093, twice.** The obvious correlated-subquery form of BOTH the recompute and the backfill
  is rejected ("can't specify target table for update in FROM clause"). Both are a JOIN against a
  derived table; the upgrade script says so inline, because the next person will write the subquery
  version first too.
- **Expect a new badge.** `BoardCard.tsx:198` renders the subtask badge only when
  `subtasksCount > 0`, which was never true. It will now appear. That is the fix working.

### ISS-002 + ISS-079 + ISS-003 + ISS-004 + ISS-090 — fixed in F14 (2026-08-05)
- **Was:** `db:seed:demo` (which truncates EVERY table) hard-coded `cross-env NODE_ENV=dev`, so
  the `Config.IS_PROD` guard was permanently false on the documented path — the script disabled the
  layer meant to stop a production run. `?dry_run=1`/`yes`/`TRUE`/bare all meant FALSE and ran
  the destructive job (a tester lost a row to exactly this). A missing `REFRESH_TOKEN_SECRET`
  booted a server that reported READY and 500'd every login. `COOKIE_SECRET` was inert config that
  looked mandatory, and 9 vars `Config` reads were undocumented.
- **Change:** `cross-env` removed + a THIRD, env-independent seed guard (any non-demo user account
  means "this looks like a real workspace", mirroring `db:setup`'s table-count refusal);
  `parseDryRun` accepts the usual truthy set, treats a bare `?dry_run` as ON, and **422s** on
  anything unrecognised rather than guessing (the handler gained `next` — Express 4 does not catch
  an async throw); both token secrets are a hard no-boot beside the existing ENCRYPTION_KEY check;
  `COOKIE_SECRET`/`SECRET_KEY`/`REDIS_URL`/`CLOUDFLARE_TOKEN_VALUE` deleted.
- **Schema:** none
- **Before/after:** `fixing/evidence/F14/f14-probe.txt` — three seed refusals with `tasks` at 46
  throughout (nothing truncated to prove it); a 10-row `dry_run` table; the refused boot; 68/68
  config vars documented.
- **Regression gate:** jobs 32/32, auth 339/339, forms 85/85.
- **ISS-090's premise corrected.** The `SMTP_*`/`EMAIL_*` keys are NOT a second mail config —
  `config/index.ts:120-125` reads them as the fallback tier (`MAIL_HOST ?? SMTP_HOST`). Deleting
  them would remove a working fallback, so they are documented instead. Testing the general property
  ("every var Config reads appears in .env.example") caught one the issue never listed:
  `R2_SIGNED_URL_TTL`.

### ISS-089 + ISS-085 + ISS-009 + ISS-086 + ISS-091 — fixed in F13 (2026-08-05)
- **Was:** the API bound all interfaces, so a direct client was the only hop and could forge
  `X-Forwarded-For` to mint a fresh rate-limit bucket per request (P41: 6 bad logins -> 429; the
  same 6 with a forged XFF -> 401 every time). A disallowed CORS origin threw, producing a 500 and an
  `Unhandled error` log line. `X-Powered-By: Express`, no CSP. `/health` was not proxied, so an
  external monitor got index.html with a 200 — "up" for a dead API.
- **Change:** prod binds `127.0.0.1` (dev keeps the wildcard on purpose — LAN origins are
  deliberately allowed so a phone on the Wi-Fi can use the app); `cb(null, false)` instead of
  `cb(new Error(...))`; `app.disable("x-powered-by")` + a `default-src 'none'` CSP and three
  more headers; nginx `location = /health` proxied and `location /metrics { deny all; }`.
- **Schema:** none
- **Before/after:** `fixing/evidence/F13/f13-probe.txt` (18 checks) + `bind-proof.txt` — dev `::`
  vs prod `127.0.0.1`, both BOOTED rather than read off the source.
- **Regression gate:** auth 339/339, users 282/282, health 14/14.
- **Two things NOT done, and why they are open rather than skipped:** ISS-089 asks to first confirm
  whether TCP 5501 is firewalled on the production box — that decides whether this was ever
  exploitable, needs the box, and has not been run. And `nginx -t` cannot run here (no nginx on
  Windows); validate on the deploy box before reload. Both carried in the issue status notes.

### ISS-083 + ISS-030 + ISS-031 — fixed in F12 (2026-08-05)
- **Was:** the entire password rule was `isLength({min:8,max:200})` — `password`, `12345678`,
  `PASSWORD`, `aaaaaaaa` and `alllowercase` were all accepted with a 204, across three
  endpoints each carrying its own copy of that one rule. A member could move their own login email
  anywhere with no verification and no notice. A bogus IANA zone was refused on the workspace and
  accepted on a user profile.
- **Change:** one shared `validators/passwordPolicy.ts` (denylist + repeated-char + straight-run +
  3-of-4 classes, with a 16+ passphrase and any non-ASCII password exempt from the class rule);
  changing a login email is admin-only (`403 user.email_change_forbidden`, same-value echo still
  allowed); the user validator imports the workspace's `isIanaTimezone` rather than carrying a
  second copy.
- **Schema:** none
- **Before/after:** `fixing/evidence/F12/policy-cases.txt` (a 24-row decision table, 24/24) +
  `f12-probe.txt` (22 end-to-end checks).
- **Regression gate:** auth 339/339, users **282/282** (279 + 3 new specs).
- **A real defect in my own first cut, caught by the repo's test.** The class check was ASCII-only,
  so `পাসওয়ার্ড🔥1` — Bangla + emoji, strong by any measure — was REFUSED while `Abcd123!`
  passed. In a Bangladeshi company that quietly pushes people off their own script onto weaker
  ASCII. `reset-password.test.ts` went red and was right; non-ASCII now exempts the class rule for
  the same reason length does.
- **Two tests asserted the OLD behaviour** and were rewritten with the reason in the comment: a
  member lowercasing their own changed email (that IS ISS-030), and `"a".repeat(64)` being accepted
  as a timezone (that IS ISS-031 — and the IANA rule is strictly narrower than the length rule, so
  the 64-char boundary is unreachable by design now).
- **D5 decided by default — NEW PASSWORDS ONLY, no forced reset.** D1 established production is not
  live, so the ~100 shared-password accounts the decision was written about do not exist yet.
  Reversible; see `fixing/DECISIONS.md`.

### ISS-087 — fixed in F11 (2026-08-04) — no failing server test remains
- **Was:** a burst of concurrent requests exhausted the pool queue and returned generic 500s — 30
  concurrent → 24 failed, 50 → 30 failed, while the same 50 SEQUENTIALLY were fine. Indistinguishable
  from a real fault to both the user and monitoring.
- **Change:** `server/.env` `DB_POOL_QUEUE_LIMIT: 50 → 0` (unlimited queue = latency, not failure;
  `.env.example` already shipped 0 — a config defect, not a code one) + a new `errorHandler` branch
  mapping mysql2 pool exhaustion to **503 `service.unavailable` + `Retry-After: 2`**, logged at warn.
  `DB_POOL_MAX` left at 20 ON PURPOSE (max_connections 151, five other apps on the box) — the reason
  is now written into `.env` where the next person will change it.
- **Schema:** none
- **Before/after:** `ramp-before.txt` vs `ramp-after.txt` — every level 0 failed (30: 24→0, 50: 30→0).
  The 503 path proven separately against a tiny pool: 40 × 503 + Retry-After, zero 500s
  (`shed-503.txt`).
- **Regression gate:** the repo's OWN red test is the acceptance criterion and it is green —
  `users` **279/279** (was 278/279), `tasks` **359/359** (was 358/359). **No known failing server
  test remains** — that one red line stood in every sweep since 2026-07-30.
- **Considered and rejected with data:** reducing the 4-way hydration fan-out. It would trade three
  round-trips of latency on EVERY request for a peak the queue already absorbs (rule X5).
- **Fixture note:** `taskmanagement_perf` predated RBAC (0 `user_roles`), so the first ramp measured
  the 404 visibility path. Bootstrapped it (`bootstrap-perf.ts`) before trusting any number — F30
  uses the same fixture.

### ISS-016 + ISS-021 + ISS-015 + ISS-017 — fixed in F10 (2026-08-04) — Block B closed
- **Was:** an `exp`-less token was accepted forever (unrevocable, since access tokens are never
  checked against `sessions`) · eight service gates trusted the JWT's frozen `role` claim, so a
  demotion took ≤15 min · change-password left every other session alive (reset did not) · revoked
  session rows survived ~60 days (~190k projected).
- **Change:** `middlewares/authenticate.ts` requires `exp` (express-jwt only validates one when
  present) · `rbac/scopeGuard.liveLegacyRole()` at 8 gates — the resolver already reads the live row
  per request, so the fresh role costs nothing · `changePassword` calls `revokeAllForUser` ·
  `sessionCleanup` gained a `revoked_at < now−7d` rule (+`countPrunable` OR-count so the dry run
  cannot double-count).
- **Decision:** D4 = **live check** (user, 2026-08-04) — TTL untouched; see `fixing/DECISIONS.md`.
- **Before/after:** `fixing/evidence/F10/f10-probe.txt` 19/19 — exp-less 401 (was 200) · demoted
  token 403 on the NEXT request (was 204) · 3 live sessions → 0 on change-password · revoked-20d
  pruned, revoked-2d + active kept.
- **Regression gate:** auth 339 · users 278/279 (the 1 = ISS-087) · rbac 286 · jobs 32 — serial,
  final code. First run was 33+1 red: BOTH were stale fixtures, fixed — see below.
- **Test fixtures fixed (surfaced by gating, not by the product):** `seedUsers` in 2 users suites
  bulk-inserted `users` rows without `syncUserSystemRole`, so the seeded caller held NO permissions
  and 403'd on F7's `member.view` gate (F7's gate list never ran `users`) · 52 `signAccess`
  helpers gained a default `expiresIn: "15m"` so an opts-less call still means “a valid token”.
- **ISS-018:** WON'T FIX by D4 — the logout window stays the documented bound, re-measured.
- **ISS-093 corrected:** closed as a DUPLICATE of ISS-087. My F3 naming came from a KILLED run;
  the real survivor is the 50-parallel-read concurrency test. The process half survives as F32's
  requirement.

### ISS-053 + ISS-060 + ISS-084 — fixed in F9 (2026-08-04) — the space-filter family
- **Was:** three read paths skipped the visibility filter the codebase applies everywhere else:
  dependency other-end hydration served an invisible space's full task (and let the edge be
  unlinked); the audit feed handed every account the HR/config timeline; the forms collection and
  by-id reads crossed departments.
- **Change:** three applications of the existing SearchRepo pattern — `listScopeFilter` on
  `TaskDependenciesRepo.findTaskRowsByIds` (+ both-ends re-check in the delete service),
  `WorkspaceActivityRepo.auditVisibility()` (space/list rows by visibility; user/role/workspace/
  catalog rows owner·admin-only) on all three reads, `listScopeFilter(forms.listId)` on the two
  form reads. No schema, no grants, no new machinery.
- **Before/after:** each issue's repro flipped — blocks hydration [] + unlink 404 · guest user-rows
  42→0 · cross-space form 404 — owners/admins byte-unchanged. `fixing/evidence/F09/f9-leak-probe.txt`
  (20/20, exit 0).
- **Regression gate:** taskdeps 67 · workspaceActivity 41 · forms 85 · search 32 · sprints 150 —
  all green (taskdeps flaked once in the chain, solo re-run clean; load-flake protocol).
- **Side effects:** the ONE intended behaviour change — members/guests no longer read the audit
  user/role/workspace/catalog rows; that IS ISS-060's Expected.

### ISS-047 — fixed in F8 (2026-08-04)
- **Was:** grant SCOPES narrowed nothing — an `own`-scoped `task.edit` edited anyone's task; the
  resolver understood all four scope reaches and no write path ever asked it.
- **Change:** `rbac/scopeGuard.ts` (assertScoped + hasFullReach) · `TasksRepo.spaceIdsByTask` +
  `TaskHeader.createdBy` · guards on 6 TaskWriteService writes + 2 TaskMembershipService writes.
  Full-reach (`all`) grants skip context-building — the seeded hot path pays one map read.
- **Schema:** none
- **Before/after:** P15's repro — 200-and-written → 403 `task.forbidden`/`not_own`, value intact;
  the full matrix (own/assigned/foreign × create/edit/assign/archive/delete/bulk + no-actor
  carve-out + seeded-unchanged) in `fixing/evidence/F08/f8-scope-probe.txt`, 21/21.
- **Regression gate:** jest `rbac` + `tasks`, serial — `fixing/evidence/F08/gate.txt`
- **Side effects:** none for seeded roles (all grants scope=all, asserted). Content permissions
  remain verb-level — recorded boundary (RBAC P20–22), the guard is ready for them.

### ISS-024 — fixed in F7 (2026-08-04) — gate all 21 (D3/D3.1)
- **Was:** 21 of 56 catalog permissions enforced nowhere; the roles-grid toggles lied; two of them
  (`task.delete_hard`, `comment.delete_any`) were decided solely by the legacy `users.role` column.
- **Change:** 34 `requirePermission` route gates across 12 routers (census: 95 gated / 70 by-design /
  16 public) + 6 D3.1 service composes (`legacyAdmin && holds(key)`; self/author/uploader/head
  branches untouched) incl. the F6-found `space.head_assign` body-conditional check. No new
  primitives — `holds`/`assertCan`/`currentActor` already existed.
- **Schema:** none — Side 1 asserted the live grants already match `SYSTEM_ROLE_GRANTS` exactly
  (owner 56 / admin 53 / member 20 / guest 19), so no upgrades script exists for this phase.
- **Before/after:** P5 probe “NOT ENFORCED: 21” → `f7-enforcement-probe.txt` 17/17 ENFORCED +
  every compose toggle real both ways + compose-cannot-widen; P39 22/22 → `f7-day-in-the-life.txt`
  **47/47** on the gated tree.
- **Regression gate:** jest rbac/tasks/collab/attachments/taskdeps/workspaceActivity/eng/search,
  serial, final code — `fixing/evidence/F07/gate.txt` (rbac 286/286 headline).
- **Side effects:** none intended — the entire design goal was zero behaviour change for seeded
  roles; the day-in-the-life run is the proof. Client button-hiding stays F26.

### F6 — route→permission map produced (2026-08-04) — no issue fixed, by design
- **Deliverable:** `fixing/evidence/F06/ROUTE_PERMISSION_MAP.md` + the re-runnable census
  (`route-census.ts`: 181 routes — 61 gated / 104 authenticate-only / 16 public).
- **The 21** (ISS-024/D3): 17 → 34 mechanical route-middleware sites; 4+`report.view` → service
  composes; +`space.head_assign` found enforced NOWHERE (catalog-invariant violation) → added to F7.
- **Grant matrix: NO changes needed** — `SYSTEM_ROLE_GRANTS` already encodes today's behaviour
  (snapshot-pinned); both suspected divergences run down and cleared (guest upload · head-scoped
  reports list).
- **Settled:** COMPOSE (D3.1, `fixing/DECISIONS.md`) · search/home/me stay ungated BY DESIGN.
- **Result:** `fixing/results/F06.md`

### ISS-058 — fixed in F5 (2026-08-04)
- **Was:** `workspaces.timezone` was stored, editable, validated and returned — and read by nothing.
  "Today" (dueToday/overdue KPIs, agenda default, all five My Work buckets) was the API box's OS clock.
- **Change:** `utils/dhakaTime.ts` gained Intl-based `zoneDateOf`/`todayInZone` (DST-correct, Dhaka
  fallback); `TaskWriteService.myWork` + `HomeService` now resolve the workspace's zone per call;
  `WorkspaceRepo` injected at the five DI sites (`routes/tasks`/`engineering`/`forms`/`home`/`assistant`).
  Company-calendar artifacts (dept-review weeks, on-call roster) stay on `dhakaToday()` BY DESIGN.
- **Schema:** none
- **Before/after:** `fixing/evidence/F05/f5-timezone.txt` — three zones × three surfaces, and the
  pivot: the SAME task flips `today`→`next` and leaves the agenda when only the timezone changes.
  Deterministic at any hour via Kiritimati (+14) / Midway (−11).
- **Also shipped (the plan's third F5 item):** a boot guard in `db/client.ts` — `NODE_ENV=prod`
  refuses to start unless `DB_TIMEZONE=+00:00` (`boot-guard.txt` matrix, incl. the "production"
  spelling). Closes the issue's production-coupling half loudly instead of silently.
- **Regression gate:** jest `home`/`collab`/`tasks` serial (`gate.txt`) · client vitest 44/44 · the
  F3 my-work probe re-passed in both TZ frames (`mywork-recheck*.txt`)
- **Still decorative, on purpose:** `users.timezone` — per-user calendars are an F28-batch product
  decision, recorded on the issue.

### ISS-063 (client half) — fixed in F5 (2026-08-04) — the issue is now closed in full
- **Was:** the API set `edited_at` and no component rendered it — a comment could be rewritten
  inside its (now real) 15-minute window with nothing shown to readers.
- **Change:** `client/src/components/task/CommentsSection.tsx` — an "(edited)" marker after the
  timestamp (italic, muted, full instant in the hover title), guarded `editedAt && !deletedAt` so
  deleted tombstones stay bare. No mapper work: the axios R1 rule already camelises `edited_at`.
- **Before/after:** wire half `fixing/evidence/F05/f5-edited-wire.txt` (null → set → survives the
  list read); DOM half `edited-marker.png` — exactly one marker, on the edited comment only.
- **Permanent coverage:** `client/e2e/f5-edited-marker.pw.ts` (self-contained: builds its fixture
  through the API, no hardcoded ids, cleans up) — 1 passed.
- **Skipped on purpose:** the optional move of the window check into SQL — F5 never touched
  `CommentsService`, and both clocks agree since F3 (the plan's own "only if touching that file").

### F4 — ISS-081 re-verified (2026-08-04) — no issue fixed, by design
- **What:** the plan's post-F3 rescope made F4 verify-only: replay the P30 sweep that found ISS-081,
  on the fixed clock. **Zero product code changed.**
- **Result:** 47/47 checks green in BOTH TZ frames (`f4-sla-sweep.txt` / `-utc.txt`, exit 0):
  every severity lands at intent (S0 **+120 min**, was −240 "born breached"); all ten breach offsets
  exact with **endpoint == view** (the >6 h blind window and the −360 under-report are gone); the
  filter matrix and all seven override guards unchanged-PASS; a future override round-trips
  **byte-exactly** (was "stored 6 h off"); severity-change recompute lands +120 from the PATCH moment
  and discards a manual override (documented V1, re-characterised); completed/archived exclusions
  hold; and `POST /eng/report-bug` (S1) **auto-assigns the current on-call engineer** — driving the
  F3 `dhakaToday()` binding through a real write path.
- **Also closes:** SCAN-H2 (the detection half of the same defect, in the full-system scan's list).
- **Observations, not defects:** `?limit=` on `/sla/breached` is silently ignored (never implemented;
  P30 only asserted the 200) · `report-bug` requires `reporter_team`
  (ops/cs/inventory/listing/marketing/internal).
- **Rejected on purpose:** the original plan's `SlaRepo UTC_TIMESTAMP()→NOW()` edit — a no-op under
  the UTC session, and a re-skew risk if the session ever changes. `UTC_TIMESTAMP()` stays.
- **Gate:** `sla` 24/24 · `eng` 78/78 · `tasks` 358/359 (the 1 = pre-existing ISS-087, owned by F11) —
  run serially per the F3 one-jest-at-a-time rule; `fixing/evidence/F04/gate.txt`
- **Result file:** `fixing/results/F04.md`

### ISS-063 — PARTIALLY fixed in F3 (2026-08-03)
- **Was:** the 15-minute comment edit window behaved as 6 h 15 m, and an edited comment is never
  marked `(edited)`
- **Change:** the window half was ISS-001 and is closed — editable at 14 min, refused at 16 min
- **Still open:** the `(edited)` marker is untouched client work and stays with **F5**
- **Before/after:** `fixing/evidence/F03/issue-verification.txt`

---

### Block E close-out note (2026-08-06)

**13 stale specs** were updated across F19–F23 (tags/delete ×3, spaces/update, tags+task-types+
spaces list suites ×7, task-types/create, users/list ×2, sprints/create). Most asserted a DEFECT as
intended behaviour — `tags/delete`'s describe block literally called the silent-strip cascade
"the §9 headline behavior". Every rewrite carries the ISS number in a comment.

**Chain-gate caveat, learned the expensive way:** a 16-module serial jest chain on one box produces
spurious mass-failures once earlier modules leave the pool draining — `taskdeps` 27-failed in-chain
vs **67/67 solo**, `sprints` 117-failed vs **150/150 solo**. Re-measure solo before believing a red
chain row. All 16 modules are green solo (`fixing/evidence/F23/gate-final2.txt`).

---

### Block F close-out note (2026-08-06)

**15 specs updated** across F24–F27. Four asserted a defect as intended behaviour — *"allows two
spaces with an identical body (no unique constraint → no 409)"*, the space-rename twin, and the two
list equivalents — and one (`rbac`) asserted the key-suffixing that made `role.key_taken`
unreachable. The rest were fixtures leaning on the missing rule: validation loops creating several
spaces from one body, and a local `insertList` helper hardcoding `name: "Test List"` while four
`statuses` specs put a second list in the same space.

Two are worth remembering. The colour-validation loop, given names derived from the colour values,
**collided on `#abcDEF` vs `#ABCDEF`** — the name rule is case-insensitive, so that pair is one
name; a neat accidental proof. And `custom-fields/list` carried an explicit
`expect(f).not.toHaveProperty("hidden_from_guests")` leak guard, which was right until ISS-042 put
the flag on the wire on purpose.

**Final Block F gate — all ten modules green solo:** home 23 · spaces 246 · lists 172 · rbac 287 ·
customfields 90 · statuses 209 · tagsreview 149 · taskTypes 184 · collab 47 · taskdeps 67 · client
vitest 44/44.

---

### F28 — the Block G decision batch, all seven built (2026-08-06)

Full account: `fixing/results/F28.md`. Decisions: `fixing/DECISIONS.md` D12.1–D12.7.

### ISS-094 — fixed in F28 (2026-08-06)
- **Was:** the seeded Guest role held 19 grants at scope=all (the pre-RBAC "everyone" set); after F7
  made the gates real, a guest could delete any task, plan sprints, edit postmortems, and read
  public-form submissions
- **Change:** `rbac/bootstrap.ts` — Guest = 7 read-and-comment grants; description rewritten;
  member untouched at 20. **Plus the repair the revocation forced:** `bug.report` became a key that
  opened no door (report-bug's mechanism asserts `task.create`), fixed with the named intake
  principal — `rbac/principals.ts` §2b, `ActorKind` + `"intake"`, `runWithPrincipal` around exactly
  the create call, attribution pinned by spec
- **Schema:** `upgrades/011_guest_role_tightening.sql` (both DBs)
- **Regression gate:** rbac 289 · ten guest specs flipped to 403 across 7 modules · eng 78/78
- **Side effects:** F26's Sidebar `permRole !== "guest"` workaround retired; **ISS-095 filed** (the
  tag routes turned out to have NO gate — found because the fallout mapped onto every revoked key
  except those two routes)

### ISS-029 — fixed in F28 (2026-08-06)
- **Was:** working days + business hours + fiscal year stored, validated, read by NOTHING; SLA
  deadlines were wall-clock (an S0 filed Thu 17:30 was due Thu 19:30, after hours, weekend next)
- **Change:** `utils/dhakaTime.ts` business-clock helpers; `computeSlaDueAt` counts on them
  (numbers unchanged, clock changed; 24h ⇒ ONE working day by design); wall-clock fallback for an
  unusable calendar. `fiscal_year_start_month` dropped end-to-end (column, CHECK, validator,
  controller, repo, wire types, mappers, settings UI)
- **Schema:** `upgrades/012_drop_fiscal_year.sql` + `schema.sql` + Drizzle `auth.ts`
- **Before/after:** `evidence/F28/business-clock.txt` — the Thu-17:30 table; probe sweeps 504
  deadlines, 0 outside working hours
- **Regression gate:** workspace 83 · sla 24 · tasks + eng SLA specs rewritten as properties

### ISS-070 — fixed in F28 (2026-08-06, D12.3: assignee YES, date NO)
- **Was:** `checklist_items.assignee_id` existed + validated, no UI ever rendered it (14 demo items,
  0 assignees); the issue asked for a due date too
- **Change:** per-item assignee Select in `ChecklistsSection` (active members only). The DATE half
  is REFUSED: a second deadline system nothing reads; a subtask is the "who, by when" primitive
- **Regression gate:** collab 47 · client vitest 44

### ISS-082 — fixed in F28 (2026-08-06)
- **Was:** `GET /sla/breached` had zero callers — no `slaApi`, no page, the Home KPI linked nowhere
- **Change:** `/sla` queue page + `slaApi` + Sidebar entry (ungated, matching the endpoint) + the
  KPI tile links there; KB + route-parity map updated (the guard caught the route first, as built)
- **Regression gate:** assistant 127 incl. route-parity · client tsc/vitest

### ISS-028 — fixed in F28 (2026-08-06)
- **Was:** the locale Select accepted a choice, toasted "saved", and the value was dropped by the
  mapper — and would have been 422'd had it arrived
- **Change:** disabled with the Workspace-ID treatment + honest hint; nothing in the client reads a
  locale, so wiring it would store a value with no consumer

### ISS-013 — fixed in F28 (2026-08-06)
- **Was:** no `DELETE /sprints/:id` at all; mistakes were permanent, cleanup meant SQL
- **Change:** the endpoint, behind `sprint.manage`; tasks DETACH via the schema's existing
  `ON DELETE SET NULL`; ACTIVE refused (`409 sprint.active_immutable`); workspace-lock serialised;
  activity row records the detached count
- **Regression gate:** sprints 178 incl. 14 new delete specs

### ISS-036 — fixed in F28 (2026-08-06, D12.7: move YES, is_private NO)
- **Was:** a list could never leave the space that created it; `is_private` frozen after creation
- **Change:** `PATCH /lists/:id { space_id }` with 404/409-archived/409-duplicate guards (F27's
  index, case-insensitive, checked against the INCOMING name on a simultaneous rename); visibility
  moves with the list — documented as the feature it is. `is_private` stays unpatchable BY DESIGN
  (enforced nowhere per `rbac/scope.ts`) and a spec now pins that
- **Regression gate:** lists 187 incl. 14 new move specs

**Phase notes.** The chain-flake caveat held twice more (102 phantom rbac failures under default
workers; one cold-compile timeout in eng — both green serial/warm). And the fallout pattern is worth
keeping: when a grant revocation lands, the specs that fail SHOULD map exactly onto the revoked
keys — the two routes that kept passing were how ISS-095 was found.

---

**Sweep addendum (the F32 scenario arrived early).** F28's part-2 gate was the first FULL sweep
since Block E, and it surfaced five stale suites in modules no phase had re-run:
- `dept-review` (absent from every F22–F27 gate): three specs pinned the pre-F22 headship-clearing
  that ISS-019 deliberately inverted, one pinned 12 notification types + `email_enabled`. All four
  rewritten to current truth (headship survives; the ≤15-min live token keeps head powers with the
  surviving pointer; 7 types, in-app only) — deptreview **122/122**.
- `notifications/preferences.test.ts` had been a **TS compile error since F19/D8** (fixtures wrote
  the removed `emailEnabled` column): "Test suite failed to run" = zero of its ~18 tests executed
  for nine phases while the module reported green at 68. Rewritten (incl. new 422 guards for the
  dropped `overdue` type and the removed email channel) — notifications **86/86**, its true size.
  ⚠️ Lesson for every future gate: a "failed to run" suite is not a red test, it is a HOLE IN THE
  COUNT — grep gates for `failed to run`, not just `✕`.
The other five part-2 reds (users/auth/forms/health/workspaceActivity) were the pool flake — all
green solo, per protocol.

---

### F29 — the remaining LOW sweep, all four fixed (2026-08-06)

Full account: `fixing/results/F29.md`.

### ISS-039 — fixed in F29 (2026-08-06)
- **Was:** the schema promised the engineering columns are "NULL for non-dev task types and gated
  in the application layer" since P11; nothing enforced it — a Marketing task could carry a branch,
  a PR link and S1 severity (and got NO SLA, because the SLA switch keys on the type name)
- **Change:** `TaskWriteService` — `assertEngFieldsAllowed` on create AND update, on the RESOLVED
  type. Git/planning fields (`story_points`, `reviewer_id`, `branch_name`, `pr_url`, `pr_status`)
  → `422 task.not_dev_type`; `bug_severity` → bug-NAMED type or `422
  task.severity_requires_bug_type` (severity and its SLA travel together — the "invisible S1"
  wrinkle is unrepresentable). Re-typing onto a non-dev type CLEARS stored git fields + stranded
  severity + its SLA in the same write. `sprint_id`/`reporter_team` deliberately not gated
  (documented).
- **Schema:** none
- **Regression gate:** tasks (create+update +13 specs) · eng · sprints untouched by design
- **Side effects:** `makeTaskType` factory gained `isDevType` (defaults false, like the schema)

### ISS-043 — fixed in F29 (2026-08-06)
- **Was:** the BD phone regex existed and NEVER ran (`default_country` was never set); money
  accepted −500 NOTACURRENCY
- **Change:** `CustomFieldsService` — `default_country` defaults to BD (local/+880/880 spellings
  pass, stored verbatim; other countries opt out); money refuses negatives and non-ISO-4217
  currencies (ICU's `Intl.supportedValuesOf("currency")`, no dependency, format-only fallback)
- **Regression gate:** customfields (+12 specs) · forms
- **Side effects:** none — the existing money specs already used BDT

### ISS-045 — fixed in F29 (2026-08-06)
- **Was:** `pr_url` stored `javascript:alert(1)` verbatim while logo_url/avatar_url refused it
  since P6/P7 — and the drawer renders it as a clickable link
- **Change:** `validators/tasks.ts` — the same http(s) custom check on BOTH task validators;
  null still clears
- **Regression gate:** tasks (probe runs the chains directly: javascript/https/null × create+update)

### ISS-068 — fixed in F29 (2026-08-06)
- **Was:** checklist bulk-add unbounded (5,000 items in one transaction, embedded unpaginated in
  every later task read); templates were the second door (2,000 items via structure, P27)
- **Change:** both capped at **200** together — `bulkAddItemsValidator` (copying
  `bulkTasksValidator`) and templates `structure.checklistItems`
- **Regression gate:** collab (+2) · templates (+2) — cap-exact passes, cap+1 refuses with 0 rows

**Phase note.** All four defects had *evidence files* from the testing phase but **zero jest
coverage** — which is exactly why they survived 29 phases. Each fix landed with the specs that
would have caught it.
---

### F30 — performance headroom, all three closed (2026-08-06)

Full account: fixing/results/F30.md.

### ISS-088 — fixed in F30 (2026-08-06)
- **Was:** four hot reads (list tasks, comments, task activity, workspace activity) did Using
  filesort on every page — the code orders by internal_id, every index ended in a time column
- **Change:** four covering-order indexes matching each query ACTUAL ORDER BY (comments =
  (task_id, created_at, internal_id) — the code, not the plan note). upgrades/013 + schema.sql +
  Drizzle; applied to perf + dev + qa
- **Before/after:** evidence/F30/explain-before|after.txt — 4 filesorts -> 0, all four queries on
  their new index; latency-after.txt — P40 table re-run, nothing slower, list reads ~40% faster
- **Regression gate:** tasks / collab / workspaceActivity / home (gate.txt)

### ISS-006 — fixed in F30 (2026-08-06)
- **Was:** 1,450 kB entry (448 gz) + 551 kB drawer; vite monolith warning
- **Change:** react/editor/icons/map manualChunks (package-NAME matched); antd bucket TRIED and
  REJECTED by measurement (it eager-loaded the lazy Table + drawer antd: +130 gz first load) —
  the rejection and numbers live as a comment in vite.config.ts and build-antd-bucket.txt
- **After:** entry 1,146 kB (351 gz), drawer 171 kB + independently-cached 120 gz editor; first
  load ±0.7%; redeploys re-download 351 gz instead of 448

### ISS-005 — closed in F30 (2026-08-06) — re-measured, does not reproduce
- The recorded 16.7 s tsx boot is 4.1 s on today BIGGER tree (dist 2.0 s). Probe kept
  (evidence/F30/boot-probe.cjs). Nothing built — a second dev workflow to save 2 s would add
  staleness traps (this campaign already met nodemon) for no felt benefit.

### ISS-092 — fixed in the F30 close-out (2026-08-07)
- **Was:** the demo seed backdated completed_at to last week but left created_at to the
  CURRENT_TIMESTAMP default — 12 of 46 tasks were "completed before they were created", a
  fixture trap that mimics the real ISS-052 symptom
- **Change:** seed-demo.ts — done tasks seed created_at = completed_at − 2 days (reviews ride the
  completion instant and were verified to only exist on done tasks)
- **Verify:** demo DB re-seeded (+ role accounts + department-report job): 0 impossible task rows,
  0 impossible review rows, **X8 baseline counts identical** (46/13/65/6/15/7/3/14/57/9/12/1/1/8)

---

### F31 — harness stood up + deferred interaction pass run (2026-08-07) — no issue fixed, by charter

Full account: fixing/results/F31.md. The 13 P45/P46 specs never ran in this campaign; standing
them up required reconstructing their world (qa DB, pinned fixture ids, a bug in Bug Triage,
GAMMA sla_due_at for the drawer panel spec). New e2e/f31-deferred.pw.ts covers the P34/P35/P36
debt. Verdict: board dnd + calendar drag-to-schedule genuinely WORK; three findings FILED (X1):
**ISS-096** (advertised ⌘K unbound) · **ISS-097** (390px overflow) · **ISS-098** (a11y criticals
on the list page). All three annotated test.fail in the spec — un-annotating is how a fix will
prove itself. Final: 72 passed / 0 unexpected (evidence/F31/pw-final.txt).

---

### ISS-096 — fixed in F34 (2026-08-08)
- **Was:** the Sidebar advertised ⌘K on the Search item since P8; nothing anywhere bound it
- **Change:** AppShell — a window keydown handler (Ctrl/⌘-K → /search), exempting
  input/textarea/contenteditable (tiptap owns Ctrl-K for links). Bound in the shell so the promise
  holds on every page the badge is visible.
- **Proof:** the F31 e2e test un-annotated → passes (evidence/F34/pw-final.txt, 72/72)

### ISS-097 — fixed in F34 (2026-08-08)
- **Was:** 6 px of horizontal overflow at 390 px — the app panned sideways on a phone
- **Change:** the ROOT CAUSE was the sidebar, not the topbar: 248 px expanded left a 142 px content
  column no topbar could fit. Sidebar auto-collapses ≤640 px (one-way; user can re-expand); the
  search label ellipsizes; the on-call chip hides ≤480 px (index.css + Topbar span).
- **Proof:** overflow 6 → 0 measured; the un-annotated breakpoint test passes; 768+ untouched

### ISS-098 — fixed in F34 (2026-08-08) — the criticals
- **Was:** axe criticals on the list page: icon-only controls with no accessible name (plus a
  label-less row checkbox and nameless dnd-kit drag handles); flickered run-to-run because the
  rows render late — the finding was real whenever rows were present
- **Change:** aria-labels on every nameless control the node dump identified: row … menu, drag
  handle, row checkbox, assignee trigger, group/column/swimlane toggles, ListPage header ellipsis
- **Proof:** axe(list) = zero critical / zero label / zero aria-command-name (color-contrast
  serious rows remain, recorded in the issue as the scoped follow-up); un-annotated test passes

### ISS-095 — fixed in F34 (2026-08-08)
- **Was:** POST/DELETE /tasks/:id/tags carried NO permission gate (tagging never had a catalog
  key, so F7's sweep had nothing to attach) — after D12.1 a guest could still re-tag every task
  in the workspace, rewriting saved filters/board groupings and bumping everyone's ETags
- **Change:** `requirePermission("task.edit")` on both routes (a tag is task metadata; internal
  roles keep the verb, the guest loses it, zero grant changes) + the F8 two-layer pattern:
  `assertTagScope` in TaskMembershipService (mirrors `assertAssignScope`) on add AND remove.
  `/watchers/self` stays ungated ON PURPOSE — a personal subscribe is right for a read persona.
- **Schema:** none
- **Regression gate:** membership **102/102** (incl. the two flipped role-loops → guest 403,
  and the parallel overdue-build's new assign-email suite passing alongside)

