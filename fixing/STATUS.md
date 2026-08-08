# Phase Board — Fixing

Plan: `FIXING_MASTER_PLAN.md`.  Statuses: PENDING · IN PROGRESS · DONE · PARTIAL · BLOCKED

**Running total:** ✅ **CAMPAIGN COMPLETE (F1–F34)** — 96 fixed + ISS-018 WON'T FIX (D4) + ISS-093 duplicate; **0 silently open**. Blocks A–H all DONE. F2 stays an optional dead-code cleanup.
**Filed DURING fixing (rule X1):** ISS-092/093 (F3), 094 (F26), 095 (F28), 096/097/098 (F31) —
issue universe = **98** (93 testing + 5 in-campaign).
Fixed (96): ISS-001…017, 019…091 (the entire testing block bar the two below) + 092, 094, 095,
096, 097, 098 · ISS-018 **WON'T FIX** (D4, admin-only login email) · ISS-093 **duplicate** of
ISS-087. Also closed: SCAN-H2 (F4), SCAN-M7 (F13), SCAN-H4 (F15), SCAN-M1/M2 (F19), SCAN-M4 (F28),
SCAN-M5 (F26). (ISS-005 counted with the fixed — re-measured, does not reproduce.)
**Still open (0):** none. ISS-095 (tag-route gate) FIXED in F34; ISS-096/097/098 (⌘K, 390px
overflow, list-page a11y criticals) filed in F31 AND fixed in F34.
Deliverable: **fixing/FIXING_SUMMARY.md** (the go-live gate). All in-campaign issues were filed,
then disposed, per rule X1.

> **F33 DONE — production parity re-checked; the runbook stopped lying (2026-08-07).** Fresh
> db:setup = **42/5/9**, the NEW canonical shape (X4 folded r2_purge_queue + 2 counter triggers
> into schema.sql) — the scan's 41/7/5 would have false-alarmed on deploy night and is corrected
> with provenance. Bundle cleaner than P41 (0 secrets, relative /api/v1, even the dead :5501
> string gone). All five deploy surfaces current (nginx SSE-exact-match + blocked /metrics; pm2;
> SIX cron conversions incl. Monday-03:00-UTC=09:00-Dhaka; logrotate; backup with disk guard —
> closing the scan's "no backups" gap). **The sharpest find: §6.2's required-env list omitted
> DB_TIMEZONE=+00:00 — following the runbook verbatim produced a non-booting prod server** (F3's
> boot guard); fixed with the MySQL-8.4 DB_SOCKET_PATH note. Box-only items re-scoped as the
> operator handoff table. Result: fixing/results/F33.md.

> **F34 DONE — the go-live gate (2026-08-08).** Every one of the 98 issues (93 testing + 5 filed
> in-campaign) is disposed: **96 fixed, ISS-018 WON'T FIX (D4), ISS-093 duplicate — 0 silently
> open.** The SYMMETRIC proof ran: P42 showed 15 repros reproducing on the broken tree, F34's
> reverify-probe replays them on the fixed tree — **15/15 no longer reproduce**, X8 baseline
> byte-identical. F31's three findings were fixed AND proven by their own un-annotated e2e tests:
> **ISS-096** ⌘K bound in AppShell, **ISS-097** 390px overflow 6→0 (sidebar auto-collapse ≤640 +
> label ellipsize + on-call chip ≤480), **ISS-098** every nameless list-page control aria-labelled
> (axe criticals 4→0). **ISS-095** (tag routes ungated) fixed: task.edit gate + F8 service scope.
> Deliverable: fixing/FIXING_SUMMARY.md. Result: fixing/results/F34.md.

> **F32 DONE — full regression sweep (2026-08-08).** 30 modules + vitest 44 + assistant-eval
> PERFECT + orphan sweep 24/24 + day-in-the-life 47/47. The sweep's 9 red files decoded cleanly:
> 7 pool-flake (green solo, the F23 caveat), 2 genuinely stale — and the stale ones were collateral
> from a PARALLEL overdue-alerts build (upgrade 014 re-added the `overdue` notification type
> mid-sweep, so early modules saw 7 types and late ones 8). Both specs updated to the 8-type
> reality. Lesson: a mid-run migration on a shared test DB reads exactly like a flake. Result:
> fixing/results/F32.md.

> **F31 DONE — the harness stands, the deferred interactions ran (2026-08-07).** The 13 never-run
> P45/P46 Playwright specs are alive again (their qa-DB world reconstructed idempotently —
> restore-qa-fixtures.cjs), plus a NEW 22-test deferred-interaction spec: board drag WORKS
> (SQL-verified persist), calendar drag-to-schedule WORKS, propagation-by-refetch as designed,
> offline/recovery, reload-reauth, logout-all revocation, focus trap, 5 breakpoints, axe on 3
> pages. Final suite: **72 passed, 0 unexpected failures** — the only reds are the three
> test.fail-annotated FINDINGS (green-or-filed by construction): **ISS-096** (Sidebar advertises
> ⌘K, nothing binds it), **ISS-097** (6px horizontal overflow at 390w), **ISS-098** (2 axe
> CRITICALS: icon-only controls with no accessible name on the list page). Filed, not fixed —
> F34 burns them down. Reusable lesson: the view tabs are code-split, the LIST stays mounted
> while a chunk loads, and text locators match its rows — always wait for view-specific DOM
> (openBoard/openCalendar helpers). Result: fixing/results/F31.md.

> **F30 DONE — the headroom is real (2026-08-06/07).** The four P40 filesorts are gone at the PLAN
> level: covering-order indexes matching each query's ACTUAL ORDER BY (upgrades/013, perf+dev+qa),
> proven on the same 5,000-task fixture — EXPLAIN clean, P40 latency table re-run with nothing
> slower and the list reads ~40% faster. The bundle: entry 1,450→1,146 kB (448→351 gz), drawer
> 551→171 kB with the 375 kB editor lazy-split — and the antd mega-bucket was TRIED AND REJECTED
> by measurement (+130 gz eager first load); the rejection lives as a comment in vite.config.ts.
> ISS-005 re-measured: the 16.7 s tsx boot is 4.1 s on today's bigger tree — closed as
> does-not-reproduce, probe kept. Bonus close-out: **ISS-092** (12 "completed before created"
> seed rows) — 2-line seed fix, re-seeded, X8 baseline byte-identical. Result: fixing/results/F30.md.

> **F29 DONE — the LOW sweep, all four fixed (2026-08-06).** The schema's oldest unkept promise is
> kept: git/planning fields now require a dev type (`422 task.not_dev_type`), `bug_severity`
> requires a bug-NAMED type (`task.severity_requires_bug_type` — severity and its §29 SLA travel
> together, killing the "invisible S1" wrinkle), and re-typing onto a non-dev type CLEARS the
> stored git fields + stranded severity + its SLA in one write. `pr_url` finally joined the
> logo/avatar URL rule (`javascript:` → 422, on create AND update). phone/money validate what
> their names promise (BD default so the never-fired regex fires; negatives and NOTACURRENCY out,
> ISO-4217 via ICU). Both checklist-bulk doors capped at 200 together (endpoint + template
> structure). **29 new specs green first run · probe 15/15 · no schema change · zero dev-DB
> residue.** Every one of these had testing-phase evidence files but no jest coverage — which is
> why they survived 29 phases; each fix landed with the specs that would have caught it.
> Result: `fixing/results/F29.md`.

> **F28 DONE — all seven D12 decisions answered AND built (2026-08-06).** The Guest role is finally
> what its name says (19 grants → 7, upgrade `011`; member untouched) — and the revocation's own
> fallout found two things: `bug.report` had become a key that opened no door (fixed with the named
> **intake principal**, `rbac/principals.ts` §2b, new `ActorKind "intake"`), and the tag routes
> turned out to carry NO gate at all (**ISS-095 filed**, not fixed here). SLA deadlines now count on
> the **business clock** (working days + hours finally read by something; Thu-17:30 S0 → Sun 10:30,
> not Thu 19:30); `fiscal_year_start_month` dropped end-to-end (upgrade `012`); the checklist
> assignee got its UI (date half refused — a second deadline system nothing reads); the `/sla`
> breach queue exists and Home's KPI links to it; the locale Select stops lying (disabled + honest
> hint); `DELETE /sprints/:id` with the active-sprint guard; `PATCH /lists/:id {space_id}` moves a
> list (duplicate/archived/foreign guards; `is_private` stays out BY DESIGN, now spec-pinned).
> Probe **38/38** · ten guest specs flipped to 403 · 14+14 new endpoint specs · 7 SLA specs became
> clock-independent properties. Result: `fixing/results/F28.md`.

> **F27 DONE — names are unique (Block F closed).** Spaces, lists and roles now enforce the
> case-insensitive uniqueness the three CATALOG resources always did — a unique index plus a 409
> mapping, copied rather than reinvented — on **create AND rename** (D11). A system role can no
> longer be renamed either. ⚠️ `upgrades/010` FAILED LOUDLY on `taskmanagement_qa`, naming two
> real duplicate values: that is the script working. Six scratch rows renamed, then 15/15 twice.
> Probe 22/22 · **all ten Block F modules green solo** + client vitest 44/44; 15 specs updated (four
> pinned the defect as intended behaviour). Result: `fixing/results/F27.md`.

> **F26 DONE — the nav and the buttons tell the truth.** The Sidebar's Engineering block is gated at
> last (marketing.only@ and guest@ no longer see Eng Home / Sprint Board / On-call); Invite Member,
> Create Space, task Archive/Delete and the settings entries each gate on the key their ENDPOINT
> enforces; `hidden_from_guests` finally reaches the API (create/PATCH/serializer) and the
> eleventh redaction call site stopped hardcoding `false`; the status-reorder endpoint has its
> first UI caller. Probe 22/22 incl. live `/me/permissions` for four personas.
> ⚠️ **New issue ISS-094 filed (X1):** the seeded GUEST role holds `postmortem.manage` +
> `sprint.assign_tasks` at scope=all — reachable since F7. F28's decision batch.
> Result: `fixing/results/F26.md`.

> **F25 DONE — the task UI can do what the API can.** Archive is reversible (Restore appears once
> archived) and "Delete permanently" actually deletes, behind a confirm; the Blocked-by direction is
> reachable; the dependency picker searches the WHOLE workspace, so a cross-department edge is
> creatable at last; `#T-<n>` resolves — scoped to the host list, because thirteen tasks here are
> "T-1"; checklists render as a tree with an add-sub-item control. Probe 22/22.
> Result: `fixing/results/F25.md`.

> **F24 DONE — Home stops inventing.** The permanent "— 0.0%" badge and the creation-date
> "sparkline" are gone (a real trend needs status history the DB does not keep); the Agenda card no
> longer renders a time of day on a DATE column — it shows PRIORITY and sorts by it; and "Awaiting
> My Review" counts the dept-head queue instead of `pr_status='open'`, which was NULL on every
> task. **The six numbers were re-proven against hand-written SQL for two accounts.** Probe 21/21.
> Result: `fixing/results/F24.md`.

> **F23 DONE — the contract says what it does (Block E closed).** `limit` is real on the four §1
> endpoints (shared paginateArray + working cursors); every foreign cursor is a 400 (strict
> round-trip across all six decoders — the forever-loop is dead); a mistyped filter is a 422 naming
> the parameter; checklist-item PATCH is a closed set (`is_completed` → "use /toggle"); POST
> refuses what PATCH refuses; misdirected task-PATCH fields name the right door; §1 documents the
> four response families (D10) and §32 is regenerated from code (129 codes, generator in evidence).
> Probe 30/30 · **all 16 gate modules green solo** (`F23/gate-final2.txt`); 13 stale specs updated,
> most of them pinning a defect as intended behaviour. Result: `fixing/results/F23.md`.
>
> ⚠️ **Chain-gate caveat:** a 16-module serial jest chain on one box mass-fails on a draining pool
> (taskdeps 27-failed in-chain vs 67/67 solo; sprints 117 vs 150/150). Measure solo, or pause
> between modules — a red chain row is not evidence until it is re-run alone.

> **F22 DONE — the spec's promises are enforced.** tag.in_use · cannot_complete_blocked (single +
> bulk) · sprint.overlap · headship SURVIVES deactivation (clearHeadships removed) · role.last_admin
> backstop on the legacy paths · archived spaces/tasks frozen for PATCH/comments/dependency edges.
> Probe 19/19 · **day-in-the-life 47/47** — which caught a backwards dependency edge in the F7
> fixture the moment the rule became real. Result: `fixing/results/F22.md`.

> **F21 DONE — the audit trail records what happened.** task_updated carries per-field {from,to},
> no-ops write nothing, bulk diffs per-target; checklist create/delete/add/delete leave traces
> (deletes carry the name/text); the drawer speaks the REAL 27-code vocabulary with a
> source-derived parity check so the next drift fails a probe. vitest 44/44.
> Result: `fixing/results/F21.md`.

> **F20 DONE — search finds what people mean.** Descriptions searched (the SKU lives there);
> relevance ladder instead of oldest-first (exact custom_id on top); metacharacters literal; q min
> 2. p50 32 ms — no regression. D9: FULLTEXT stays a future option. Result: `fixing/results/F20.md`.

> **F19 DONE — notifications tell the truth (D6–D8).** 12 types → 7 REAL ones; comment +
> status_change finally have producers (a plain comment notifies the attached people); preferences
> actually suppress, enforced at the one chokepoint every producer flows through; the email toggle
> is gone because the channel never existed. Probe 23/23 delta-counted, all 7 types produced live.
> Result: `fixing/results/F19.md`.

> **F18 DONE — six validation holes.** Unknown `reviewer_id` on create: 422 not 500. A 300-char
> `X-Filename`: 422 on the path the client actually uses. The API no longer generates a
> `public_slug` its own validator refuses. `POST /spaces` validates + WRITES the head PATCH always
> validated (and now needs the same `space.head_assign` F7 put on PATCH — create was a bypass).
> Both reorders demand a full permutation with distinct positions — the public form's question order
> can no longer become ambiguous. Probe 16/16 (every repro + every happy path).
> Result: `fixing/results/F18.md`.

> **F17 DONE — ISS-025 closed, rule X9 fully retired.** `upgrades/008` adds the two retention
> columns + index by the documented path, idempotently (16/16 twice). Before: submissions 500,
> public intake 500, expiry job dead — reproduced live, then all green; legacy rows get the 90-day
> clock but keep `encrypted_at=NULL` honestly. The old probes' add/drop protocol was DEFUSED so a
> re-run cannot reintroduce the drift. Nothing in the dev DB is deliberately broken any more.
> Result: `fixing/results/F17.md`.

> **F16 DONE — the P37 orphan sweep is 24/24.** Hard delete now takes the whole subtree's
> notifications with it, and queues every R2 key (soft-deleted rows included) in the new
> `r2_purge_queue` INSIDE the same transaction — the r2-purge job drains it objects-first.
> Un-archiving a space restores exactly the lists archiving took down (the cascade's own timestamp
> is the discriminator), proven with an independently-archived list that correctly STAYED archived.
> ⚠️ The first gate run straddled F18's edits and its spaces/lists rows are void — the consolidated
> `gate-final.txt` is the real one. Result: `fixing/results/F16.md`.

> **F15 DONE — the counters, and SCAN-H4 with them.** All three drifting counters now track the
> rows in BOTH directions: `comments_count` counts soft deletes, `forms.submission_count` follows
> the retention job, and `subtasks_count`/`subtasks_completed` are maintained at all (they were
> 0/0 everywhere). Subtasks are APP-SIDE by necessity — a `tasks` trigger cannot modify `tasks` —
> and it is a RECOMPUTE, not an increment, because increments are what drifted. Backfilled +
> idempotent: `database/upgrades/006_counters.sql` (X4: schema.sql too; no Drizzle change needed).
> Probe 18/18, every value checked against a live COUNT. **SCAN-H4 closed as a precondition:** the
> 3 stale `trg_subtasks_after_*` triggers turned the fix into a 500 on first run
> (`ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG`) — rule X9 had preserved them for exactly this phase.
> ⚠️ **Expect a subtask badge to appear on cards for the first time** — `BoardCard.tsx:198` renders
> it only when the count is > 0. Result: `fixing/results/F15.md`.

> **F14 DONE — the destructive paths refuse.** The demo seed (which truncates every table) had its
> own guard disabled by its own npm script; `cross-env NODE_ENV=dev` is gone and a third,
> env-independent guard was added. `?dry_run=1` no longer silently means "delete" — the truthy set
> is generous, a bare `?dry_run` counts as ON, and an unrecognised value is a 422 rather than a
> guess. A missing `REFRESH_TOKEN_SECRET` is now a hard no-boot instead of a server that reports
> READY and 500s every login. Config stops lying: 4 dead keys deleted, 68/68 documented.
> Probe 24/24 · gate jobs 32 · auth 339 · forms 85. Result: `fixing/results/F14.md`.

> **F13 DONE — network posture.** Production binds **127.0.0.1** (dev keeps the wildcard on purpose
> — LAN origins are deliberately allowed), so the forged-`X-Forwarded-For` rate-limit bypass needs
> the box itself. A rejected CORS origin is a clean no-header response, not a 500 plus a phantom
> `Unhandled error` line. `X-Powered-By` gone; a `default-src 'none'` CSP added. nginx now
> proxies `/health` (an external monitor was getting index.html with a 200 — "up" for a dead API)
> and denies `/metrics` on purpose rather than by accident. Probe 18/18 + a booted bind proof.
> ⚠️ **Two operator follow-ups stay open:** is TCP 5501 firewalled on the prod box (that decides
> whether ISS-089 was ever exploitable), and `nginx -t` before reload.
> Result: `fixing/results/F13.md`.

> **F12 DONE — passwords, and the login identity.** `password`/`12345678`/`aaaaaaaa` and the
> rest are refused everywhere, by ONE shared policy the three password endpoints now share instead
> of three copies of a length check. Changing a login email is admin-only — it was a silent
> persistence primitive. A bogus IANA zone is refused on a profile, using the same check the
> workspace always had. 24/24 decision table · 22/22 probe · auth 339 · users **282**.
> ⚠️ **The class rule exempts non-ASCII passwords** — the first cut refused `পাসওয়ার্ড🔥1`
> while accepting `Abcd123!`, which would push people off Bangla onto weaker ASCII. The repo's own
> test caught it. **D5 decided by default: new passwords only, no forced reset** (production is not
> live). Result: `fixing/results/F12.md`.

> **F11 DONE — no known failing server test remains.** `DB_POOL_QUEUE_LIMIT 50→0` turns a burst into
> latency, and pool exhaustion now sheds as **503 + Retry-After** instead of a generic 500. Ramp on
> the 5k-task fixture: 30 concurrent 24-failed → **0**, 50 concurrent 30-failed → **0**. The repo's
> own red test went green: users **279/279**, tasks **359/359** — the single red line that stood in
> every sweep since 2026-07-30 is gone. `DB_POOL_MAX` deliberately unchanged (shared box).
> Result: `fixing/results/F11.md`.

> **F10 DONE — Block B closed.** D4 = **live check**: eight service gates read the live role, so a
> demotion bites on the NEXT request (was ≤15 min). An `exp`-less token is now 401 (it was a
> permanent, unrevocable credential). change-password revokes every session like reset always did.
> session-cleanup prunes revoked rows after 7 days (~190k → ~23k projected). ISS-018's logout window
> stays the documented bound, re-measured. Probe 19/19 · gate auth 339 · users 278/279 · rbac 286 ·
> jobs 32. Result: `fixing/results/F10.md`.
>
> ⚠️ **Two stale test-fixture classes fixed here, both surfaced by gating:** direct `db.insert(users)`
> seeds must call `syncUserSystemRole`, and an opts-less `signAccess` must carry an expiry.

> **F9 DONE — the space-filter family closed.** Three reads now carry the visibility filter the
> rest of the codebase always had: dependency hydration drops invisible other-ends (and unlink is
> 404 across the boundary); the audit feed is space/list-by-visibility + user/role/workspace/catalog
> rows owner·admin-only (guest's 42 HR rows → 0); forms are department-scoped. Owners unchanged.
> Probe 20/20 · gate 5 modules green (375 tests; one chain flake re-run clean).
> Result: `fixing/results/F09.md`.

> **F8 DONE — grant scopes narrow writes.** `rbac/scopeGuard.ts` + guards on all 8 task-family
> writes. The ISS-047 repro flipped: marketing.only@ editing another's task in a visible space →
> 403 `not_own`, value untouched; own/assigned still 200; space scope narrows create/assign; bulk
> fail-atomic; seeded roles zero-change (all grants scope=all, asserted); public submit alive.
> Probe 21/21 · gate rbac 286/286, tasks 358/359 (ISS-087). Content perms stay verb-level —
> recorded boundary (RBAC P20–22), mechanism ready. Result: `fixing/results/F08.md`.

> **F7 DONE — all 56 toggles are real.** 34 route gates + 6 D3.1 composes, zero grant changes
> (asserted). P5 probe: **NOT ENFORCED 21 → 0** · P39 day-in-the-life **47/47** (“nobody lost a job
> function” — incl. S0→on-call auto-assign, weekly report cycle, dept-only scoping, offboarding)
> · jest gate 8 modules green (rbac 286/286; tasks 358/359 = the known ISS-087).
> `space.head_assign` enforces for the first time ever. Result: `fixing/results/F07.md`.

> **F6 DONE — Block B's design pass.** The route→permission contract is written:
> `fixing/evidence/F06/ROUTE_PERMISSION_MAP.md`. 181 routes censused; the 21 unenforced keys map to
> **34 route-middleware sites + 6 service composes** (+1 new primitive `assertCan`); `space.head_assign`
> found enforced NOWHERE and added to F7. **Grant matrix needs zero changes** — the seeded roles
> already encode today's behaviour. Sub-decision settled: **compose** (D3.1). F7 is now mechanical.

> **F5 DONE — Block A closed.** `workspaces.timezone` now DECIDES “today” (myWork buckets, home
> KPIs, agenda) — proven with Kiritimati(+14)/Midway(−11): the SAME task flips bucket when only the
> timezone changes. An edited comment now SHOWS “(edited)” (DOM-proven, permanent spec
> `client/e2e/f5-edited-marker.pw.ts`). And prod REFUSES to boot unless `DB_TIMEZONE=+00:00`.
> Gate: home 23/23 · collab 47/47 · tasks 358/359 (the 1 = ISS-087) · client vitest 44/44 · the F3
> my-work probe re-passed in both TZ frames. Result: `fixing/results/F05.md`.

> **F4 DONE — ISS-081 independently re-verified, zero code changed.** The full P30 sweep replayed
> on the fixed clock: 47/47 checks in BOTH TZ frames (S0 born at +120 not −240; all ten breach
> offsets exact with endpoint==view — the 6 h blind window is gone; an override round-trips
> byte-exactly; report-bug S1 auto-assigns the on-call engineer through the dhakaToday path).
> Also closes SCAN-H2. Gate: sla 24/24 · eng 78/78 · tasks 358/359 (the 1 = ISS-087).
> Result: `fixing/results/F04.md`.

> **F3 DONE — the clock is fixed.** `DB_TIMEZONE=+00:00` pins the MySQL session to UTC, which is
> what Drizzle's timestamp mapper already assumes. The gate
> `node fixing/evidence/F01/clock-probe.cjs` now exits **0** in both the `TZ=Asia/Dhaka` and
> `TZ=UTC` frames — 12/12 observations at 0.00 h. **Five silent consequences** were caught and fixed
> in the same phase: DATE columns had shifted a day; the on-call roster would have rolled over 6 h
> late (`CURDATE()` → `dhakaToday()`); `OnCallService` was storing a **six-day** on-call week, leaving
> Sunday uncovered while still returning 200; two more stored-DATE readers and the demo seed were on
> the old footing; and `TaskWriteService.ymd` was doing two different jobs under one name.
> Result: `fixing/results/F03.md`.
>
> **Debugging note for everyone:** a SQL client must `SET time_zone='+00:00'` to see what the app
> sees. A default-session `SELECT` looks 6 h off and is not a bug.
>
> **Running jest here:** one invocation at a time, and pass `--testTimeout=60000`. Two concurrent
> runs make `resetTestDb()` blow its 5 s hook timeout and *every* test in the suite fails without a
> single assertion running — it reads as a catastrophic regression and is not one.

> **F1 DONE.** Block A now has an executable gate:
> `node fixing/evidence/F01/clock-probe.cjs` — exit 0 means fixed. It exited **1** with
> **12 drifting observations** until F3; it exits **0** now. Result: `fixing/results/F01.md`.

> ✅ **D1, D2, D3 ANSWERED (2026-07-30) — F1 is unblocked and the plan is updated.**
> **D1** production not live → no timestamp backfill · **D2** Dhaka is the business clock —
> **F3 revised the implementation to store UTC** (`DB_TIMEZONE=+00:00`) and apply Dhaka at the
> display and business-day layers, because Drizzle's driver makes a Dhaka *session* wrong by
> construction · **D3** **gate all 21** permissions. See `fixing/DECISIONS.md`.

> ⏳ **Block A is time-sensitive.** The zero-migration window closes the moment production goes live.
> Run F1–F5 first.

> 🔒 **Rule X9 is FULLY RETIRED.** F15 dropped the stale triggers (after reproducing their crash);
> F17 closed the ISS-025 column drift (upgrades/008) and defused the old probes' add/drop protocol.
> Nothing in the dev database is deliberately broken any more.

> 📌 **Demo-DB baseline note (2026-08-06):** 16 of the 18 tracked counts are at baseline. The two
> that are not are NOT phase residue: `users` 16 (was 15) and `invitations` 1 (was 0) come from a
> real invitation the OWNER sent through the app at 04:38 UTC while F19–F23 ran — a live person
> (a gmail address), not a fixture. Left alone deliberately; delete it through the UI if it was a
> test. Every probe-created row was removed, and `r2_purge_queue` was drained by running the real
> r2-purge job (2 keys from the day-in-the-life hard deletes — F16 working as designed).

| # | Phase | Block | Risk | Issues | Status |
|---|---|---|---|---|---|
| F1 | Build the clock probe | A | LOW | — (instrument) | **DONE** |
| F2 | The DATE half — **rescoped: no DATE bug** | A | LOW | ISS-001a | **READY** (optional) |
| F3 | The TIMESTAMP half — **the phase that matters** | A | MED | ISS-001, 052, 063a, 081 | **DONE** |
| F4 | SLA arithmetic — verify-only re-run of the P30 sweep | A | LOW | ISS-081 (verified) | **DONE** |
| F5 | Remaining time-dependent bugs | A | MED | ISS-058, 063b | **DONE** |
| F6 | Map every route to its permission | B | MED | — (design) | **DONE** |
| F7 | Gate all 21 permissions | B | **HIGH** | ISS-024 | **DONE** |
| F8 | Scope narrowing (own / own_space) | B | MED | ISS-047 | **DONE** |
| F9 | The three space-filter leaks | B | MED | ISS-053, 060, 084 | **DONE** |
| F10 | Session and role freshness | B | MED | ISS-015, 016, 017, 018, 021 | **DONE** |
| F11 | Load shedding instead of 500s | C | MED | ISS-087 | **DONE** |
| F12 | Password policy and account safety | C | LOW | ISS-030, 031, 083 | **DONE** |
| F13 | Network posture | C | LOW | ISS-009, 085, 086, 089, 091 | **DONE** |
| F14 | Destructive-command guards and config | C | LOW | ISS-002, 003, 004, 079, 090 | **DONE** |
| F15 | The counters | D | MED | ISS-046, 065, 080 | **DONE** |
| F16 | Orphans and cascades | D | MED | ISS-022, 041, 073 | **DONE** |
| F17 | Close the dev schema drift | D | LOW | ISS-025 | **DONE** |
| F18 | Validation holes and self-contradictions | D | LOW | ISS-032, 037, 044, 071, 077, 078 | **DONE** |
| F19 | The notification system | E | MED | ISS-064, 072 | **DONE** |
| F20 | Search | E | MED | ISS-074, 075, 076 | **DONE** |
| F21 | Activity and audit quality | E | LOW | ISS-049, 061, 062 | **DONE** |
| F22 | Business rules the spec promises | E | MED | ISS-011, 019, 020, 034, 051 | **DONE** |
| F23 | API contract consistency | E | LOW | ISS-007, 008, 010, 012, 014, 040, 048, 067 | **DONE** |
| F24 | Home page honesty | F | LOW | ISS-056, 057, 059 | **DONE** |
| F25 | Task UI gaps | F | LOW | ISS-050, 054, 055, 066, 069 | **DONE** |
| F26 | Client permission gating and navigation | F | MED | ISS-023, 038, 042 + SCAN-M5 | **DONE** |
| F27 | Names and duplicates | F | LOW | ISS-026, 027, 033, 035 | **DONE** |
| F28 | Product decisions | G | HIGH | ISS-013, 028, 029, 036, 070, 082 | PENDING |
| F29 | The remaining LOW sweep | G | LOW | ISS-039, 043, 045, 068 | PENDING |
| F30 | Performance headroom | G | LOW | ISS-005, 006, 088 | PENDING |
| F31 | Close the testing phase's own gap | H | MED | — (Playwright debt) | PENDING |
| F32 | Full regression sweep | H | LOW | — | PENDING |
| F33 | Production parity re-check | H | MED | — | PENDING |
| F34 | Final consolidation and go-live gate | H | LOW | — | PENDING |
