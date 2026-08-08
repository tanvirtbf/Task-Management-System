# 🔧 FIXING MASTER PLAN — BeautyBooth Task Management System

**Created:** 2026-07-30
**Mode:** FIXING ONLY. No new testing is invented, no new features are built.
**Input:** `testing/ISSUES.md` — **93** issues (1 CRITICAL · 10 HIGH · 48 MEDIUM · 33 LOW · 1 GAP).
ISS-092 and ISS-093 were filed *during* the fixing phase (F3), per rule X1.
**Phases:** 34 fixing phases across 8 blocks.
**Decisions D1–D3 answered 2026-07-30** (see `fixing/DECISIONS.md`) — this plan is updated to reflect
them. **D1:** production is not live → no timestamp backfill. **D2:** Dhaka is the business clock —
but see §2, **F3 revised how that is implemented**: storage is **UTC (`DB_TIMEZONE=+00:00`)** and
Dhaka is applied at the display and business-day layers, because Drizzle's driver makes a Dhaka
*session* wrong by construction. **D3:** **gate all 21** permissions — the catalog stays at 56 and
every toggle becomes real.
**Companion:** `TESTING_MASTER_PLAN.md` (the run that produced the issues) ·
`testing/TESTING_SUMMARY.md` (the consolidated findings)

---

## 0. THE TWO-MODE CONTRACT

This document governs **FIXING MODE** only. It is the mirror of the testing plan: that one found and
never fixed; this one fixes and never explores.

### Rules that apply to EVERY fixing phase

| # | Rule |
|---|---|
| **X1** | **Only logged issues are fixed.** If a phase's work reveals something new, it is filed as a **new ISS-nnn** in `testing/ISSUES.md` and left alone. Do not "fix while you're in there". |
| **X2** | **Every fix starts by reproducing the issue** and ends by re-running that exact repro. A fix with no before/after evidence is not done. |
| **X3** | **Every phase ends green.** Its own regression gate (named per phase) must pass before the phase closes. A red gate blocks the phase — it is never "fixed later". |
| **X4** | **No schema change ships alone.** Every DB change is three synchronized edits: `database/schema.sql` + the Drizzle TS schema + a new `database/upgrades/NNN_*.sql`. This is the repo's existing rule (`database/upgrades/README.md`) and it is not optional. |
| **X5** | **No refactors.** Fix the defect, not the neighbourhood. If a fix genuinely requires restructuring, stop and raise it as a decision. |
| **X6** | **Decisions belong to the user, not the code.** Anything marked **DECISION** in this plan stops and asks. Do not pick a product behaviour unilaterally. |
| **X7** | **One phase at a time**, in order within a block. Blocks A→C must complete before D→G; block H is last. |
| **X8** | **The demo database is the fixture.** It is currently at a verified baseline (§6). Any phase that dirties it restores it, and says so. |
| **X9** | **Two states are deliberately preserved and must stay reproducible until their own phase fixes them:** the ISS-025 dev column drift, and the 3 stale `trg_subtasks_after_*` triggers (SCAN-H4). Do not "tidy" them early. |
| **X10** | **If a fix cannot be completed**, say so explicitly, leave the issue OPEN with a note explaining what blocks it, and mark the phase `PARTIAL`. Never silently skip. |

---

## 1. FILE + FOLDER LAYOUT

```
FIXING_MASTER_PLAN.md               ← this file (does not change during the run)
fixing/
├── FIX-LOG.md                      ← one entry per fixed issue: what changed, files, before/after
├── STATUS.md                       ← phase board: F1…F34, DONE / PARTIAL / BLOCKED
├── DECISIONS.md                    ← every DECISION raised, the options, and the user's answer
└── evidence/
    ├── F02/                        ← before/after transcripts, test output, screenshots
    └── …
testing/ISSUES.md                   ← updated in place: Status OPEN → FIXED (+ the fixing phase)
```

**`testing/ISSUES.md` is edited, not replaced.** Each fixed issue gets:

```markdown
- **Status:** FIXED in F07 (2026-08-xx)
- **Fix:** requirePermission("task.create") added to routes/tasks.ts:158
- **Verified:** the P5 enforcement probe re-run — 0 of 56 now unenforced
```

---

## 2. THE BIGGEST RISK, STATED UP FRONT

**Existing timestamp data is on two different clocks.** Measured on the live schema:

```
95 TIMESTAMP columns in total
64  MySQL-defaulted (CURRENT_TIMESTAMP)  -> correct Dhaka wall clock
31  written by the application/Drizzle   -> 6 hours EARLY when Drizzle wrote them
```

The 31 app-written columns include the ones that matter most:
`sessions.expires_at`, `invitations.expires_at`, `password_reset_tokens.expires_at`,
`notifications.snoozed_until`, `tasks.sla_due_at`, `tasks.completed_at`, `tasks.archived_at`,
`comments.edited_at`, `attachments.deleted_at`, `department_reports.generated_at`.

**Changing the clock changes how every existing row is interpreted.** That is a data migration, not
just a code change.

### ✅ RESOLVED by D1 — production is not live

**The window is open.** The user has confirmed production is not yet serving users, so the only
timestamp data in existence is the local demo seed, which is disposable.

**Consequences, and they are large:**

- **No backfill script.** `database/upgrades/005_timestamp_backfill.sql` is not needed.
- **F3 drops from 🔴 to 🟡** — it becomes a pure code change followed by a re-seed, not a data
  migration. It is no longer the highest-risk phase in the plan.
- **F1 shrinks** to building the measurement probe, since both of its decisions are already made.
- **This window closes the moment the system goes live.** Block A should therefore run first and
  without delay — every day production stays down is a day this stays free, and every day after
  go-live makes it a migration.

### The frame — ⚠️ **REVISED IN F3 (2026-08-03): the session stores UTC, not Dhaka**

> **This section was rewritten after F3 shipped.** The original plan chose "store Dhaka" from D2 and
> listed the settings below with `+06:00`. Building F1's probe proved that choice unimplementable
> *cheaply*: Drizzle's mysql `timestamp` mapper hardcodes `+0000` in **both** directions
> (`mapFromDriverValue: new Date(value + "+0000")`), so a Dhaka session is wrong by construction no
> matter what the application does. Making Dhaka work would have meant a custom column type across
> ~15 files. Pinning the session to UTC makes the driver's existing assumption true and fixed all 12
> drifting observations in **one line**.
>
> **D2 is honoured where it actually matters.** D2 asked for Dhaka; users still get Dhaka. The
> storage clock and the display clock are different questions — the API emits ISO-8601 `…Z` and the
> client renders local time. What changed is only the former.

These settings must all agree. As of F3 they do, and the probe proves it:

| where | value |
|---|---|
| MySQL session `time_zone` | **`+00:00`** — `DB_TIMEZONE=+00:00` in `server/.env` (dev *and* prod) |
| mysql2 driver `timezone` | **`+00:00`** — same value, set together in `db/client.ts:50-73` |
| Drizzle TIMESTAMP handling | unchanged — its hardcoded `+0000` is now *correct* rather than patched around |
| process `TZ` | `Asia/Dhaka` (pm2 sets it) — but nothing may **depend** on it; the probe runs under `TZ=UTC` too |
| SQL "now" | **`UTC_TIMESTAMP()`** — identical to `NOW()` now, but correct under *any* session zone, so it cannot silently skew if this is ever changed again |
| SQL "today" for a **business day** | **never `CURDATE()`/`UTC_DATE()`** — bind `dhakaToday()` (`utils/dhakaTime.ts`). `week_start`/`week_end` are Dhaka business days; a UTC `CURDATE()` rolls the on-call roster over 6 h late |
| DATE columns | **not** `dateStrings` — Drizzle materialises a DATE at UTC midnight, so `toDateOnly` writes `Date.UTC` and `toWireDate` reads `getUTC*`. Symmetric by construction |

**The trade-off, recorded honestly:** storing UTC is the conventional choice and the one the tooling
already assumes, so it cost one line instead of fifteen files. The price is that a human running a
raw `SELECT` sees UTC, not Dhaka — six hours off from the wall clock, which *looks* like the bug that
was just fixed. That confusion is real: it fooled my own verification script during F3. It is
mitigated by documentation rather than by configuration, in `server/.env`, `server/.env.example`,
`fixing/results/F03.md` and `fixing/STATUS.md`: **`SET time_zone='+00:00'` before reading timestamps
by hand.** If BeautyBooth ever opens an office in another timezone, nothing has to migrate.

---

## 3. FIX ORDERING PRINCIPLE

Phases are ordered by **leverage and blast radius**, not by severity:

1. **Root causes before symptoms.** One clock fix closes five issues.
2. **Security before convenience.** An open door is worse than a wrong label.
3. **Things that break under load before things that look wrong.**
4. **Server before client.** The client's job is to render what the server says; fix the truth first.
5. **Decisions early enough that code isn't written twice.**

---

## 4. THE 34 PHASES

Legend — **Risk:** 🔴 high (touches shared behaviour / data) · 🟡 medium · 🟢 low.
**Gate** = the suites that must be green before the phase closes.

---

# BLOCK A — THE CLOCK (F1–F5)

*Closes the CRITICAL and 4 dependents. Nothing else in this plan is safe to build on until this is
settled.*

## F1 — Build the clock probe
**Fixes:** nothing — this phase builds the instrument the rest of Block A is measured with. 🟢
*(Both of this phase's original decisions are answered: D1 no backfill, D2 store Dhaka. What remains
is measurement.)*
- [x] Enumerate the 31 app-written TIMESTAMP columns and the 64 MySQL-defaulted ones (query in §2)
- [x] Write `fixing/evidence/F01/clock-probe.cjs` — for each of the 31 columns: write a known instant
      through the API, then read it back through **both** the API and raw SQL, and report the drift.
      This is the single before/after instrument for F2–F5.
- [x] Extend it to assert the six settings in §2 agree at runtime (session tz, driver tz, process TZ)
- [x] Run it under **both** `TZ=Asia/Dhaka` **and** `TZ=UTC` — the second is the case that fails today
      and the one that proves the fix is real rather than accidental
- [x] Capture the **before** run
- **Gate:** none (no product code changed). **Exit:** `clock-probe.cjs` committed and its before-run
  saved, showing the expected 6-hour drift on the app-written columns.

## F2 — The DATE half — ⚠️ RESCOPED BY F1: there is no DATE bug
**Fixes:** ISS-001 (part 1 of 2) 🟢 *(was 🟡)*

**F1 proved the DATE columns already round-trip correctly in every configuration**, including the
worst one (`TZ=UTC` + `DB_TIMEZONE=+06:00`). Drizzle's `date()` defaults to `mode: "string"`, so a
DATE never becomes a JS `Date` and no timezone can be misapplied. The P19 evidence that suggested
otherwise was measured on a raw mysql2 connection, not the product path — see `fixing/results/F01.md`
§4, and the correction annotated on ISS-058.

**This phase therefore reduces to removing the dead code that made the bug look plausible:**
- [ ] `taskSerializer.ts:83-90` — the `getFullYear/getMonth/getDate` branch of `toWireDate` is
      unreachable for every DATE column. Remove it, or leave it and add a comment saying why it is
      defensive. **Do not** enable `dateStrings: true`: it changes nothing here and would silently
      alter TIMESTAMP handling, which is F3's job.
- [ ] `onCallSerializer.ts:27-33` — same dead branch
- [ ] Leave a regression test that asserts a DATE round-trips under `TZ=UTC`, so a future change to
      the Drizzle column mode cannot reintroduce this quietly
- **Verify:** `clock-probe.cjs` — the two DATE rows must stay at 0.00 h drift
- **Gate:** `tasks`, `tasks10`, `oncall`, `sprints`
- **If short of time, F2 may be skipped entirely** — it fixes no observable defect. F3 is the phase
  that matters.

## F3 — The TIMESTAMP half
**Fixes:** ISS-001 (part 2), ISS-052 🟡 *(was 🔴 — D1 removed the data-migration half)*
- [x] Make the driver's `timezone` and the MySQL session both `+06:00` (D2), and stop Drizzle
      reinterpreting stored TIMESTAMPs as UTC
- [x] Remove the second writer: `TasksRepo.touchUpdatedAt:163-171` writes `updated_at` through
      Drizzle while POST/PATCH let MySQL default it — that is ISS-052's "two clocks on one column".
      Let MySQL own `updated_at` everywhere, or Drizzle everywhere; not both.
- [x] **Acceptance gate:** `node fixing/evidence/F01/clock-probe.cjs` must **exit 0** — today it
      exits 1 with 12 drifting observations. Run it against the **production pair**
      (`TZ=Asia/Dhaka` + `DB_TIMEZONE=+06:00`, F1's config 3), not just the dev default: the two
      environments configure the driver differently and only config 3 matches production.
- [x] The probe's `updated_at >= created_at` assertion must pass — that is ISS-052's real test
- [x] **No backfill needed (D1).** Re-seed the demo database instead: `npm run db:seed:demo`, then

> **Correction (recorded at the Block F close-out).** The first bullet above still says the
> session should be pinned to `+06:00` per D2. That is NOT what shipped. F3 pinned it to
> `DB_TIMEZONE=+00:00` (UTC) — the value Drizzle already assumed — and `fixing/results/F03.md`
> documents why `+06:00` would have been wrong. Production refuses to boot without `+00:00`.
> The boxes are ticked against what was delivered, not against this stale bullet.
      re-run the department-report job so the 12 seeded reports come back. Re-verify the §6 baseline.
- **Verify:** ISS-001's original repro (P1) and ISS-052's (P17 §6) both go quiet;
  `created_at` on the wire matches the wall clock
- **Gate:** **the full server jest sweep** — all 30 modules. This is the one phase that earns a
  complete run rather than a targeted one.

## F4 — SLA arithmetic — ⚠️ **ALREADY CLOSED BY F3; THIS PHASE IS NOW VERIFY-ONLY**
**Fixes:** ISS-081 🟢 (already fixed — confirm and close)

> ISS-081 was never an SLA bug. All three parts were symptoms of ISS-001, so pinning the session to
> UTC fixed them without touching `SlaRepo` or `computeSlaDueAt`. **Do not make the change the
> original plan describes below** — `UTC_TIMESTAMP()` → `NOW()` is now a no-op at best, and it would
> re-introduce the skew if `DB_TIMEZONE` ever moves. F3 also re-derived both views
> (`upgrades/005_clock_views.sql`), so the endpoint/view disagreement is gone too.

- [x] ~~`SlaRepo.ts:95` → `NOW()`~~ — **rejected.** Keep `UTC_TIMESTAMP()`: identical under the UTC
      session and correct under any other, so it cannot silently skew again.
- [x] ~~Re-check the two views~~ — done in F3, `upgrades/005_clock_views.sql`, applied to
      `taskmanagement` + `taskmanagement_qa`
- [x] `computeSlaDueAt` (`TaskWriteService`) confirmed landing where it intends: S0 stored at
      **+120 min**, not breached
- [x] Re-run the P30 sweep once, as an independent confirmation rather than a fix — **done 2026-08-04**,
      47/47 in both TZ frames; `fixing/results/F04.md`
- **Verify (all four already observed in F3, `fixing/evidence/F03/issue-verification.txt`):** an S0 is
  created +120 min in the future, a 60-min-late task reports `minutes_breached=60`, and endpoint and
  view agree
- **Gate:** `sla`, `eng`, `tasks`

## F5 — The remaining time-dependent bugs — **shrunk by F3**
**Fixes:** ISS-063 (client half only) 🟢, ISS-058 🟡

> F3 closed ISS-063's *window* half (it behaves as a real 15 minutes now) and already moved
> `TaskWriteService.myWork` off process-local "today". What is left here is genuinely smaller.

- [x] ~~**ISS-063** window~~ — closed in F3. The JS comparison is no longer wrong, because both
      clocks now agree. Moving it into SQL is optional hardening, not a fix; do it only if F5 is
      touching that file anyway.
- [x] **ISS-063 (client half)** — DONE 2026-08-04: `CommentsSection` renders "(edited)" (hover =
      full instant), guarded `editedAt && !deletedAt`. DOM-proven; permanent spec
      `client/e2e/f5-edited-marker.pw.ts`. See `fixing/results/F05.md` §2.
- [x] **ISS-058** — DONE 2026-08-04 (the "make it decide" arm): `todayInZone(workspace.timezone)`
      now drives myWork + Home KPIs + agenda; `users.timezone` stays decorative (F28 decision).
      Proof `fixing/evidence/F05/f5-timezone.txt`. ~~make `workspaces.timezone` actually decide "today", **or** delete the setting
      from the UI. Half-measures here are what created the issue. Two known readers:
      - `HomeService.ymd()` — still process-local, untouched
      - `TaskWriteService.myWork` — F3 moved it to `dhakaToday()`, so the zone is now a *named
        constant* rather than the box's accident. Replacing that constant with the workspace's
        setting is a one-line change at a single call site; do `HomeService` the same way.
      - The helper to build on is `utils/dhakaTime.ts` (fixed-offset, no tz tables). Generalising it
        to take a zone is the natural shape.
- [x] Boot-time assertion DONE 2026-08-04 — prod refuses to start otherwise (`boot-guard.txt`).
      ~~Add a boot-time assertion: `NODE_ENV=prod` requires `DB_TIMEZONE`, and it must be **`+00:00`**
      (not merely "matching the process TZ" — F3 decoupled them deliberately, and pm2 keeps
      `TZ=Asia/Dhaka` while the DB session is UTC). Guard the value, not the agreement.
- **Verify:** an edited comment shows "(edited)"; change the workspace timezone and watch `dueToday`
  move. Re-run `fixing/evidence/F03/mywork-buckets.cjs` — it must still pass in **both** TZ frames.
- **Gate:** `collab`, `home`, `tasks`

---

# BLOCK B — AUTHORIZATION (F6–F10)

*The largest single body of work. 21 permissions currently do nothing.*

## F6 — Map every route to its permission
**Fixes:** nothing — this is the design pass that makes F7 mechanical. 🟡
*(D3 is answered: **gate all 21**. The catalog stays at 56 and every toggle becomes real.)*
- [x] Produce the **route → permission table**: every one of the ~60 currently ungated routes gets a
      named permission from the existing 56-key catalog. No new permissions are invented.
- [x] Produce the **role → grant matrix**: for each of the 4 seeded roles, which of the 21 newly-gated
      permissions it must hold so that **today's effective behaviour is unchanged**. This is the half
      that prevents "I can't do my job any more", and it is the harder half.
- [x] **Sub-decision to settle here (recommendation: compose).** ISS-024 records that
      `task.delete_hard` and `comment.delete_any` are decided **only** by the legacy `users.role`
      column — the RBAC grant is inert even when the legacy role is raised. Choose:
      **replace** (RBAC becomes the sole authority) or **compose** (legacy role as a floor, RBAC
      narrowing on top). **Compose** is the smaller change and cannot accidentally widen access.
- [x] Decide where the gate lives for the 3 routers that are not simple CRUD — `search.ts`,
      `home.ts`, `me.ts` — where "permission to read your own data" may be the wrong shape entirely
- **Gate:** none. **Exit:** both tables written into F7's checklist and reviewed.

## F7 — Gate all 21 permissions
**Execution contract (F6, 2026-08-04): `fixing/evidence/F06/ROUTE_PERMISSION_MAP.md` — 34 route-middleware
sites + 6 service composes + `assertCan()`; grant matrix verified as ALREADY CORRECT (Side 1 = assert only).**
**Fixes:** ISS-024 🔴 **the largest single change in the plan**
*(D3: gate all 21. Two sides — the routes, and the seeded role grants. Do the grants FIRST, so the
gates never bite an under-provisioned role.)*
- [x] **Side 1 — seeded role grants.** (F7: asserted zero-drift — no upgrade script needed) Apply F6's role→grant matrix so the 4 seeded roles hold the 21
      newly-gated permissions in the pattern the legacy roles allowed. Ship as
      `database/upgrades/NNN_rbac_grants.sql` (rule X4).
- [x] **Side 2 — the routes.** (F7: 34 gates applied per the F6 map) `routes/tasks.ts` first: **18 routes, 0 gates** today, the single
      biggest surface.
- [x] `routes/comments.ts` etc. — done per map (comments 1 write-gate; reads stay visibility-scoped), `checklists.ts` (9), `attachments.ts` (6), `taskDependencies.ts` (3),
      `workspaceActivity.ts` (2), `engineering.ts` (4), `search.ts` (1), `home.ts` (2), `me.ts` (1)
- [x] The two special cases — D3.1 composes, toggles real (F7): `task.delete_hard` and `comment.delete_any` are
      currently decided **only** by the legacy `users.role` column — the RBAC toggle is inert even
      when the legacy role is raised. Both layers need to agree.
- [x] P5 probe re-run — NOT ENFORCED 21 → 0 (`fixing/evidence/F07/f7-enforcement-probe.txt`)
- **Verify:** the probe's "NOT ENFORCED" count goes from 21 to whatever F6 decided; **and** a
  full P39 day-in-the-life re-run still scores 22/22 — that is the "nobody lost their job function"
  check
- **Gate:** `rbac`, `tasks`, `collab`, `attachments`, `taskdeps`, `workspaceActivity`, `eng`, `search`

## F8 — Scope narrowing (`own` / `own_space`)
**Fixes:** ISS-047 🟡
- [x] DONE (F8): `rbac/scopeGuard.ts` — the service-layer half; composes with F7's route gates.
- [x] Both covered + `space`: own = creator|assignee; ownSpaceIds + spaceIds via foldGrants. Probe 21/21.
- **Verify:** ISS-047's original repro — `marketing.only@` holding `task.edit` at scope `own` must
  now be **refused** on a task created by someone else **inside a space they can see**. (Note the P42
  re-check gotcha: use a task in a *visible* space, or space visibility answers first and the scope
  check is never reached.)
- **Gate:** `rbac`, `tasks`

## F9 — The three space-filter leaks
**Fixes:** ISS-053, ISS-060, ISS-084 🟡
- [x] **ISS-053** — DONE (F9): hydration filtered + unlink 404 across the boundary.
- [x] **ISS-060** — DONE: gate in F7 (`activity.view`), the data filter in F9 (`auditVisibility`).
- [x] **ISS-084** — DONE (F9): both reads carry `listScopeFilter(forms.listId)`.
- [x] The working pattern copied verbatim — zero new machinery.
- **Verify:** each issue's own repro; plus a sweep as `marketing.only@` and `cs.only@` confirming
  nothing from another department appears in any of the three
- **Gate:** `taskdeps`, `workspaceActivity`, `forms`, `search`, `sprints`

## F10 — Session and role freshness
**Fixes:** ISS-015, ISS-016, ISS-017, ISS-018, ISS-021 🟡
- [x] **ISS-016** — DONE (F10): `exp` required; exp-less → 401 `auth.invalid_token`.
- [x] **ISS-021** — DONE (F10, **D4 = live check**): 8 gates read `liveLegacyRole()`; demotion bites next request.
- [x] **ISS-018** — WON'T FIX by D4: the logout window stays documented, re-measured in F10.
- [x] **ISS-015** — DONE (F10): `changePassword` calls `revokeAllForUser`; 3 sessions → 0.
- [x] **ISS-017** — DONE (F10): cleanup prunes `revoked_at < now−7d`; ~190k → ~23k projected.
- **Verify:** each repro; plus confirm the P32 `session-cleanup` job still behaves (its 30-day
  window must not be disturbed)
- **Gate:** `auth`, `users`, `rbac`, `jobs`

---

# BLOCK C — PRODUCTION SAFETY (F11–F14)

*Everything here is about the system surviving 100 people and the open internet.*

## F11 — Load shedding instead of 500s
**Fixes:** ISS-087 🟡
- [x] DONE (F11) — the repo's own test is GREEN (users 279/279, tasks 359/359):
      `tests/users/list.test.ts` → *"serves 50 parallel reads with identical, consistent results"*.
      That test is the acceptance criterion — make it green.
- [x] DONE — `DB_POOL_QUEUE_LIMIT=0` (unlimited queue → latency instead of failure). `.env.example`
      already ships `0`; the deployed `.env` sets `50`.
- [x] DONE — mapped to 503 `service.unavailable` + `Retry-After: 2`, proven against a tiny pool., not a generic 500, so
      clients back off and monitoring is not polluted.
- [x] NOT DONE, with data — the queue absorbs the peak; serialising would add 3 round-trips to every request (X5). See F11.md §2. — it issues 8 queries, several in parallel, which is
      why ~30 requests saturate 70 slots.
- [x] Honoured — `DB_POOL_MAX` stays 20; the reason is now written into `.env`.: MySQL's `max_connections` is 151 and is shared with the
      five other apps on that box.
- **Verify:** the P40 ramp — 5/10/15/20/30/50 concurrent, all 200; and re-run against the
  `taskmanagement_perf` scratch DB (5 000 tasks), which is still in place for exactly this
- **Gate:** `users` (the failing test), plus a P40 latency re-run showing no regression

## F12 — Password policy and account safety
**Fixes:** ISS-083, ISS-030, ISS-031 🟢
- [x] DONE (F12) — **ISS-083** — `isLength({min:8,max:200})` and nothing else. Add
      complexity **and** a common-password denylist (`password`, `12345678` and `aaaaaaaa` are all
      accepted today). Keep bcrypt cost 10 — it is correct.
- [x] **D5 DECIDED (F12): new passwords only, no forced reset** — production is not live (D1), so the ~100 shared-password accounts do not exist yet. Reversible. Original question: on next login, or only to new
      passwords? ~100 accounts are currently seeded with one shared password.
- [x] DONE (F12) — admin-only now. **ISS-030** — with no verification and no
      notification to the old address
- [x] DONE (F12) — shares the workspace's IANA check. **ISS-031** — on the workspace but accepted on a user profile
- **Verify:** each repro. **Watch out:** the P38 probe that found ISS-083 changed the owner's real
  password. Use a throwaway account.
- **Gate:** `auth`, `users`

## F13 — Network posture
**Fixes:** ISS-089, ISS-085, ISS-009, ISS-086, ISS-091 🟢
- [x] DONE (F13) — prod binds 127.0.0.1, dev keeps the wildcard deliberately. ⚠️ the firewall question is STILL OPEN for the operator. **ISS-089** —. `app.listen(PORT, "127.0.0.1")`; nginx
      already proxies to `127.0.0.1:5501`, so nothing breaks. **First confirm whether TCP 5501 is
      firewalled on 209.38.65.61** — that answer decides whether this was ever exploitable.
- [x] DONE (F13) — **ISS-085 / ISS-009** —: `cb(new Error(...))` → `cb(null, false)`. A disallowed
      origin then gets a normal response with no `ACAO` header instead of a 500 and a false error log.
- [x] DONE (F13) — plus a `default-src 'none'` CSP for the JSON API (the SPA origin needs its own). **ISS-086** —; decide CSP (it matters on the SPA origin, not the
      JSON API); HSTS is already correct under `NODE_ENV=prod`
- [x] DONE (F13) — ⚠️ `nginx -t` not run (no nginx on the dev box); validate on the deploy box.
      **ISS-091** — nginx: `location = /health { proxy_pass … }` so external uptime checks work, and
      an explicit `location /metrics { deny all; }` so its protection is intentional rather than
      accidental
- **Verify:** the P38 §7 header table and the P41 §1 bypass matrix
- **Gate:** `health`, `auth`; plus a manual nginx `-t`

## F14 — Destructive-command guards and config
**Fixes:** ISS-002, ISS-079, ISS-003, ISS-004, ISS-090 🟢
- [x] DONE (F14) — `cross-env` removed + a third env-independent guard. **ISS-002** — and truncates. Give it the same
      refusal `db:setup` has (P41 proved that guard works: *"Refusing to apply schema.sql: database
      already has 41 tables"*).
- [x] DONE (F14) — generous truthy set, bare `?dry_run` = ON, 422 on unrecognised. **ISS-079** —: `req.query.dry_run === "true"` silently means **false**
      for `?dry_run=1`. Accept the usual truthy set, or 422 on an unparseable value. Three of the six
      jobs delete data. *(This was found by the tester typing `?dry_run=1` and destroying a row.)*
- [x] DONE (F14) — hard no-boot. **ISS-003** — boots a server that reports READY and cannot log
      anyone in. Fail closed at boot, like the `ENCRYPTION_KEY` check already does (P26 §6).
- [x] DONE (F14) — removed, with 3 more dead keys. **ISS-004** —; remove it
- [x] DONE (F14) — documented, not deleted: they are the MAIL_* FALLBACK tier. 68/68 now in .env.example. **ISS-090** — are absent from `.env`; the 6 `SMTP_*`/`EMAIL_*` ones
      are a **second, unused mail configuration** (the working one is `MAIL_*`). Delete or wire.
- **Verify:** each repro; `?dry_run=1` must no longer delete
- **Gate:** `jobs`, `auth`, `forms`

---

# BLOCK D — DATA INTEGRITY (F15–F18)

## F15 — The counters
**Fixes:** ISS-046, ISS-065, ISS-080 🟡
- [x] DONE (F15) — `trg_attachments_after_update` was the model for both new triggers. `trg_attachments_after_update` is an AFTER UPDATE trigger that
      moves the counter in **both** directions and handles soft delete correctly (P37 §1). It is the
      model for all three.
- [x] DONE (F15) — **ISS-065** — and misses soft deletes
- [x] DONE (F15) — **ISS-080** — when the retention job deletes rows
- [x] DONE (F15) — app-side RECOMPUTE on 6 write paths; SCAN-H4's stale triggers had to be dropped first (they made it a 500). **ISS-046** — are maintained by nothing at all.
      MySQL forbids a `tasks` trigger from modifying `tasks`, which is why the original triggers were
      removed — so this one must be **app-side**, as `schema.sql:1482-1488` already documents.
- [x] CONFIRMED (F15) — the badge WILL now appear. `BoardCard.tsx:198` renders the subtask badge only `if (subtasksCount > 0)`, so
      **fixing the counter makes a badge appear on cards for the first time.** Expect that.
- [x] DONE (F15) — `upgrades/006_counters.sql` + schema.sql. No Drizzle edit needed: no column changed.
- [x] DONE (F15) — all three, idempotent (applied twice, 10/10). **Backfill** for existing rows in the same upgrade script
- **Verify:** P37 §1's trigger table, one path at a time
- **Gate:** `collab`, `tasks`, `forms`, `attachments`

## F16 — Orphans and cascades
**Fixes:** ISS-073, ISS-022, ISS-041 🟡
- [x] DONE (F16) — app-side delete in the hard-delete tx (whole subtree) + an orphan sweep in 007. **ISS-073** — `notifications.entity_id` is polymorphic with no FK; it is the **only** child
      table in the schema that orphans (P37 §4: 23 of 24 relationships clean, this one not). Either
      a per-entity-type cascade or a sweep in the janitor job.
- [x] DONE (F16) — `r2_purge_queue`, filled in the same tx, drained by the job. **ISS-022** — hard-deleting a task orphans its R2 objects forever. The `r2-purge` job already
      knows how to delete objects; it just never learns about these.
- [x] DONE (F16) — restores by the cascade's own timestamp; independently-archived lists stay put. **ISS-041** — un-archiving a space does not restore the lists that archiving it archived
- **Verify:** re-run P37's full 24-query orphan sweep — it must come back **24 of 24 clean**
- **Gate:** `notifications`, `attachments`, `spaces`, `lists`, `jobs`

## F17 — Close the dev schema drift
**Fixes:** ISS-025 🟢
- [x] DONE (F17) — reproduced live (3 surfaces), then closed. The dev DB is missing `form_submissions.encrypted_at` / `expires_at`. P41 proved a fresh
      `db:setup` **has** them — so production is fine and this is dev-only drift.
- [x] DONE — `database/upgrades/008_form_submission_retention.sql`, information_schema-gated, idempotent (16/16 twice) so every already-provisioned
      DB (dev, `taskmanagement_qa`, and prod if it was provisioned before the columns existed) gets
      them by the documented path
- [x] DONE — X9 now FULLY retired (F15 took the triggers); the old probes' add/drop protocol was defused. **This retires rule X9's first half** — after this phase the drift is gone on purpose
- **Verify:** `GET /forms/:id/submissions` returns 200; the `form-submission-expiry` job stops
  returning `{"ok":false,"error":"Unknown column …"}` (P32 §4)
- **Gate:** `forms`, `jobs`

## F18 — Validation holes and contract self-contradictions
**Fixes:** ISS-044, ISS-071, ISS-077, ISS-032, ISS-037, ISS-078 🟢
- [x] DONE (F18) — create runs update's check. **ISS-044** — `POST /tasks` with an unknown `reviewer_id` → **500**. The validation exists in
      `TaskWriteService.update()` (lines 678-690) and was never added to `create()`.
- [x] DONE (F18) — the presign rule, post-decode, on the proxied path. **ISS-071** — a 300-char `X-Filename` → **500** (`attachments.name` is `varchar(255)`). The
      presign path validates the identical field correctly; copy that rule.
- [x] DONE (F18) — `randomToken(6).toLowerCase()`. **ISS-077** — the API generates a `public_slug` containing a mixed-case random suffix that its
      own `SLUG_RE` rejects, so a form cannot be written back unchanged. One character: lowercase the
      token.
- [x] DONE (F18) — shared `assertValidHead`, value written, + the F7 permission. **ISS-032** — `POST /spaces` silently discards an invalid `head_user_id` that `PATCH` rejects
- [x] DONE (F18) — full set exactly once + distinct positions, else 422. **ISS-037** — status reorder accepts payloads that are not a valid permutation
- [x] DONE (F18) — same permutation rule; public-form question order is stable. **ISS-078** — form-field reorder accepts a partial list and duplicate positions, leaving two
      fields at position 0 and the public form's question order ambiguous
- **Verify:** each repro returns the right 4xx instead of a 500 or a silent 200
- **Gate:** `tasks`, `attachments`, `forms`, `spaces`, `statuses`

---

# BLOCK E — BEHAVIOUR CORRECTNESS (F19–F23)

## F19 — The notification system
**Fixes:** ISS-064, ISS-072 🟡 **DECISION-heavy**
- [x] DONE (F19) — now 7 of 7 types have a producer. Was: **5 of 12** declared types have a producer; the preferences screen governs **none** of
      them; no email is ever sent (`SCAN-M1`, `SCAN-M2`, both proven by execution in P24 §6).
- [x] **D6 ANSWERED: build comment + status_change, remove the other 5** (see fixing/DECISIONS.md). Original question: for each of the 7 producerless types — build the producer, or remove the type
      from the enum and the settings UI?
      `comment` (ISS-064) and `status_change` are the two a task manager is expected to have.
      `due_soon` / `overdue` need a scheduler that does not exist. `pr_review`, `incident_alert`,
      `automation_failed` are engineering-only.
- [x] **D7 ANSWERED: suppress for real** — enforced at the createMany chokepoint, proven live.
- [x] **D8 ANSWERED: remove the toggle** — the channel never existed; a body carrying it gets a 422 that says why. Original: email — wire `MailService` into notifications, or remove the `email_enabled`
      toggle that promises a channel with no implementation.
- **Verify:** produce every type that survives the decision; turn one off and confirm it stops
- **Gate:** `notifications`, `collab`, `home`

## F20 — Search
**Fixes:** ISS-074, ISS-075, ISS-076 🟡
- [x] DONE (F20) — description joined the predicate. **ISS-074** —; `description` is not in
      it, though `comments.body` **is** searched. For ops teams the description is where the order
      number and SKU live.
- [x] DONE (F20) — the exact ladder this line sketches, implemented. **ISS-075** —: oldest first, no scoring. At a few
      thousand tasks the `limit` fills with the oldest matches and the wanted task is never on the
      page. Cheap improvement without full FULLTEXT: exact-title, then prefix, then substring, then
      recency; and float exact `custom_id` hits to the top.
- [x] DONE (F20) — escaping already existed (P18); min length 2 added. **ISS-076** —, so "50%" and `snake_case` behave unexpectedly; and
      `q` has no minimum length, so one keystroke runs five un-indexable `LIKE '%x%'` scans
- [x] **D9 ANSWERED: better LIKE** — p50 32 ms; FULLTEXT stays the future scale option. Original: The database has
      **zero** FULLTEXT indexes today.
- **Verify:** P25's fixtures — the description fixture must be found; ordering must put the exact
  match first
- **Gate:** `search`; plus the P40 latency check (search is already the slowest endpoint at 125 ms)

## F21 — Activity and audit quality
**Fixes:** ISS-049, ISS-061, ISS-062 🟢
- [x] DONE (F21) — per-field {from,to}, no-op = no row, bulk per-target. **ISS-049** — `{"fields":[…]}` with no before/after values, and
      a no-op update still writes a row. `status_changed` does it properly (`{from,to}`) — copy it.
      Bulk edits record only `{"bulk":true}`, so a 200-task bulk leaves 200 contentless rows.
- [x] DONE (F21) — 27-entry real vocabulary + source-derived parity check. **ISS-061** — the **mock's** vocabulary: 2 of 13 real
      action codes hit a case, and 7 of its 9 cases are codes the server never emits. It also reads
      only `context.taskName`, which task activity never contains — so real context is discarded.
- [x] DONE (F21) — 4 new activity writes; deletes carry name/text. **ISS-062** —, while ticking one box does.
      "Who deleted the acceptance criteria?" is unanswerable.
- **Verify:** P20's action-vocabulary table; the drawer must render English for all 13 codes
- **Gate:** `tasks`, `collab`, client `vitest`

## F22 — Business rules the spec promises
**Fixes:** ISS-011, ISS-019, ISS-020, ISS-034, ISS-051 🟡
- [x] DONE (F22) — all three: tag.in_use / cannot_complete_blocked / sprint.overlap. **ISS-011** — (proven live), including completing a task
      that is **blocked by** an open dependency
- [x] DONE (F22) — legacy-path backstop; unreachable while an active owner exists (stated honestly), proven by forcing the state. **ISS-020** —; a workspace can be left with zero active
      admins and nobody able to fix it
- [x] DONE (F22) — headship SURVIVES now (clearHeadships removed). **ISS-019** — their department headship, and reactivating
      does not give it back
- [x] DONE (F22) — spaces PATCH-frozen; tasks refuse comments + dependency edges. Lists were the model. **ISS-034 / ISS-051** —: archived **spaces** stay
      fully editable, archived **lists** are correctly frozen, archived **tasks** are frozen for edits
      but still accept comments and dependency edges. **Lists are the model to copy.**
- **Verify:** each repro; the P39 day-in-the-life must still score 22/22
- **Gate:** `tasks`, `spaces`, `users`, `collab`, `taskdeps`

## F23 — API contract consistency
**Fixes:** ISS-007, ISS-008, ISS-010, ISS-012, ISS-014, ISS-040, ISS-048, ISS-067 🟢
- [x] DONE (F23) — paginateArray: real limit + working cursor. **ISS-007** — that advertise pagination
- [x] DONE (F23) — strict round-trip decode on all six decoders. **ISS-008** —; one form makes a paging client **loop
      forever**
- [x] DONE (F23) — D10 docs-only; the one true mismatch (/activity/recent) aligned. **ISS-012** —; `/activity/recent` contradicts its own
      documentation
- [x] DONE (F23) — closed set; is_completed → 422 naming /toggle. **ISS-067** —, including
      `is_completed` — the obvious way for any new client to tick a box
- [x] DONE (F23) — task-type create refuses server-owned fields; misdirected task-PATCH fields name the right door; allowQuery on the 5 primary collections. **ISS-040 / ISS-048 / ISS-014** — that PATCH rejects;
      `assignees`/`tags` in a task PATCH give a misleading message; unknown query params are ignored
- [x] DONE (F23) — §32 regenerated from source: 129 codes; generator in evidence. **ISS-010** —; the server throws 140
- [x] **D10 ANSWERED: docs-only** — breaking 3 families would hurt the only client for zero gain. Original: is the envelope inconsistency (ISS-012) worth a breaking change now, before more
      clients exist, or is it documentation-only?
- **Verify:** the P2 conventions sweep re-run
- **Gate:** `tasks`, `collab`, `workspaceActivity`, `notifications`, `search`

---

# BLOCK F — UI TRUTHFULNESS (F24–F27)

*The client's job is to render what the server says. These are the places it says something else.*

## F24 — Home page honesty
**Fixes:** ISS-057, ISS-056, ISS-059 🟢
- [x] DONE (F24) — badge + sparkline removed, both sides; the six NUMBERS re-proven against SQL. **ISS-057** — **"— 0.0%"** trend (hardcoded server-side to
      `0/flat/false`) and a sparkline that plots `DATE(created_at)` rather than the metric. Visually
      confirmed in P35: **"Open Team Tasks 31"** sitting above a line summing to **4**. The six
      numbers themselves are correct — verified against hand-written SQL for four accounts.
      **Simplest honest fix: remove the badge and the sparkline.**
- [x] DONE (F24) — shows PRIORITY and sorts by it; there is no time-of-day column to show. **ISS-056** — on a **date-only** column, so
      every row reads "6:00 AM" and the sort by that value is a no-op. `tasks` has no time-of-day
      column anywhere.
- [x] DONE (F24) — counts the dept-head review queue. **ISS-059** — (0 rows for everyone, forever)
      while 11 completed tasks wait on a department head. Count the review queue the company uses.
- **Verify:** by eye at `localhost:5173`, plus the P19 hand-recount
- **Gate:** client `vitest`; the numbers must still match the P19 SQL

## F25 — Task UI gaps
**Fixes:** ISS-050, ISS-054, ISS-055, ISS-066, ISS-069 🟢
- [x] DONE (F25) — Archive toggles with Restore; Delete permanently sends ?hard=true behind a confirm. **ISS-050** — irreversible action in the UI and neither can
      be undone; `tasksApi` has no `unarchive` and **0 callers**
- [x] DONE (F25) — two direction buttons; the mutation maps onto the stored edge. **ISS-054** — group whose picker is unreachable:
      the single Link button hard-codes `"blocks"` and the mutation never reads the direction
- [x] DONE (F25) — searches the workspace (visibility-filtered, F20-ranked). **ISS-055** —, while the API allows any task
      in the workspace (sequence **after** F9 decides whether cross-space edges stay legal)
- [x] DONE (F25) — resolves T-<n> inside the HOST LIST (task_number is unique per list only). **ISS-066** —, but the drawer shows `T-<task_number>`
      (49 of 53 tasks have no `custom_id`). Either resolve `T-<n>` server-side or stop displaying it.
- [x] DONE (F25) — the client builds the tree + an add-sub-item control. **ISS-069** — on the server; the client renders one flat level
- **Verify:** by eye; ISS-066 with a `#T-<n>` reference that must now link
- **Gate:** client `vitest`, `taskdeps`, `collab`

## F26 — Client permission gating and navigation
**Fixes:** ISS-042, ISS-023, ISS-038, plus `SCAN-M5` 🟡
- [x] DONE (F26) — gated on the engineering grants (+ a not-a-guest term; see the new ISS-094). **`SCAN-M5`** — **unconditionally**,
      outside the conditional that gates Department and Reports. Every Marketing-only user sees Eng
      Home, Sprint Board and On-call rotation — and P29 showed `/eng/home` answers 200 for them.
- [x] DONE (F26), SCOPED to nav + high-traffic actions per the answered scope question (P29–P30 own the rest). **`SCAN-M5` (wider)** —; Create Space, Delete
      Task, Invite Member all render for everyone and fail with a 403 toast. **Sequence after F7**,
      so the client gates on the same permissions the server now enforces.
- [x] DONE (F26) — validator + serializer + repo + service; create/PATCH both work. **ISS-042** —, so the one guest-redaction
      control the product implements cannot be switched on
- [x] DONE (F26) — fixed together with ISS-042 on purpose. **ISS-023** — the flag to `false`
- [x] DONE (F26) — move-earlier/later arrows, sending the COMPLETE permutation F18 requires. **ISS-038** —; the reorder endpoint has no UI caller
- **Verify:** log in as `marketing.only@`, `cs.only@` and `guest@` and confirm the nav and the action
  buttons match their real permissions
- **Gate:** client `vitest`, `rbac`, `customfields`

## F27 — Names and duplicates
**Fixes:** ISS-027, ISS-033, ISS-035, ISS-026 🟢
- [x] DONE (F27) — the unique-index + 409 pattern copied to all three. The settled cross-phase pattern: of 8 named resources, **3 enforce** case-insensitive
      uniqueness (statuses, task types, tags) and **5 do not** (roles, spaces, lists, custom fields,
      checklists). The three that work are the catalog resources; the ones that do not are the
      **navigation** resources, where a duplicate name hurts most.
- [x] DONE (F27) — upgrades/010 + schema.sql + Drizzle. **ISS-033** (spaces), **ISS-035** (lists), **ISS-027** (roles) — copy the working
      implementation
- [x] DONE (F27) — same guard shape as delete (403, not 409 — the issue text was off). **ISS-026** —
- [x] **D11 ANSWERED: create AND rename** — asked with data (0 collision groups in the demo DB). Original: Existing duplicates would need resolving.
- **Verify:** create and rename each resource to a colliding name → 409
- **Gate:** `spaces`, `lists`, `rbac`, `customfields`, `tags`, `statuses`, `taskTypes`

---

# BLOCK G — DECISIONS & SWEEP (F28–F30)

## F28 — Product decisions — **DONE 2026-08-06: all seven answered AND built in-phase**
**Fixes:** ISS-070 (the GAP), ISS-013, ISS-028, ISS-029, ISS-036, ISS-082, **+ ISS-094** (adopted
from F26) 🔴 **all DECISION** → decisions D12.1–D12.7 in `fixing/DECISIONS.md`, build log in
`fixing/results/F28.md`
- [x] DONE (D12.3) **ISS-070 (GAP)** — assignee got its UI (always existed server-side, no screen
      rendered it); the DATE half **refused**: an item-level date is a second deadline system that
      My Work / Agenda / overdue KPI / calendar would not read — a subtask is "who, by when"
- [x] DONE (D12.2) **ISS-029** — working days + business hours now drive SLA deadlines (the
      business clock, `utils/dhakaTime.ts`); `fiscal_year_start_month` REMOVED end-to-end
      (`upgrades/012`) — no financial-reporting surface exists to read it
- [x] DONE (D12.5) **ISS-028** — disabled with the Workspace-ID treatment + honest hint (nothing in
      the client reads a locale; a working control would store a value with no consumer)
- [x] DONE (D12.6) **ISS-013** — built, behind `sprint.manage`; tasks DETACH (`ON DELETE SET
      NULL`); an ACTIVE sprint refused (`409 sprint.active_immutable`)
- [x] DONE (D12.7) **ISS-036** — the move built (404/409-archived/409-duplicate guards; visibility
      moves with the list, documented); `is_private` stays frozen **by design** (enforced nowhere —
      a settable toggle would visibly do nothing) and is spec-pinned
- [x] DONE (D12.4) **ISS-082** — the `/sla` queue page, sequenced after F3/F4 exactly as filed;
      Sidebar + Home KPI link to it; KB + route-parity updated
- [x] DONE (D12.1) **ISS-094** — Guest 19 grants → 7 read-and-comment (`upgrades/011`); the
      revocation surfaced and F28 fixed the dead `bug.report` key (named intake principal) and
      surfaced **ISS-095** (tag routes carry no gate — filed, deferred to the RBAC backlog/F31+)
- **Gate:** ran anyway (all touched modules + part-2 sweep, `fixing/evidence/F28/gate.txt`; probe
  38/38). **Exit met:** every decision recorded; every one that became work built in-phase.

## F29 — The remaining LOW sweep — **DONE 2026-08-06: all four fixed**
**Fixes:** ISS-039, ISS-043, ISS-045, ISS-068 🟢 → build log in `fixing/results/F29.md`
- [x] DONE **ISS-045** — `pr_url` carries the same http(s) custom check as logo/avatar, on create
      AND update; `javascript:` → 422; null still clears
- [x] DONE **ISS-068** — both entry points capped at **200** together (`bulkAddItemsValidator`
      copying `bulkTasksValidator`, + templates `structure.checklistItems`)
- [x] DONE **ISS-039** — `assertEngFieldsAllowed` on the RESOLVED type: git/planning fields need
      `is_dev_type` (`422 task.not_dev_type`); `bug_severity` needs a bug-NAMED type
      (`task.severity_requires_bug_type` — same name key as the §29 SLA switch, so severity and SLA
      travel together); re-typing to non-dev CLEARS stored git fields + severity + SLA
- [x] DONE **ISS-043** — phone: `default_country` defaults BD (the regex finally fires;
      local/+880/880 spellings; other countries opt out); money: negatives refused, ISO-4217 via
      ICU (`BDT` in, `NOTACURRENCY`/`XYZ`/`bdt` out)
- **Gate:** `tasks`, `collab`, `customfields`, `templates` + `eng`, `forms` — all green
  (`fixing/evidence/F29/gate.txt`) · probe 15/15 · 29 new specs · 2 new error codes (§32 = 135)

## F30 — Performance headroom — **DONE 2026-08-06/07: all three closed (+ ISS-092 bonus)**
**Fixes:** ISS-088, ISS-005, ISS-006 🟢 → build log in `fixing/results/F30.md`
- [x] DONE **ISS-088** — four covering-order indexes matching each query's ACTUAL ORDER BY
      (comments = `(task_id, created_at, internal_id)` — the code, not this note's sketch).
      EXPLAIN on the same perf fixture: 4 filesorts → 0, all four on their new index.
- [x] DONE **ISS-006** — react/editor/icons/map manualChunks: entry 1,450→1,146 kB (448→351 gz),
      drawer 551→171 kB + lazy editor. The antd mega-bucket was TRIED AND REJECTED by measurement
      (+130 gz eager) — rejection documented in vite.config.ts + evidence.
- [x] CLOSED **ISS-005** — re-measured, does not reproduce: tsx 4.1 s on today's bigger tree
      (recorded 16.7 s); dist 2.0 s; probe kept, nothing built for a 2 s delta.
- [x] X4 applied — `upgrades/013_perf_indexes.sql` + schema.sql + Drizzle, on perf + dev + qa
- [x] **Verify:** P40 EXPLAIN table re-run — zero filesorts, and the latency table re-run shows
      nothing slower (list reads ~40% faster). Bonus close-out: **ISS-092** (seed created_at) —
      re-seeded, X8 baseline byte-identical.
- **Gate:** tasks · collab · workspaceActivity · home (`fixing/evidence/F30/gate.txt`)

---

# BLOCK H — VERIFICATION (F31–F34)

## F31 — Close the testing phase's own gap — **DONE 2026-08-07: 72 passed / 3 filed**
**Fixes:** no ISS — this pays down the debt P34/P35/P36 recorded 🟡
- [x] DONE Stand up the **Playwright harness once** (`client/playwright.config.ts` and 12 specs already
      exist and have never been run in this campaign)
- [x] DONE Run the deferred interaction tests as one scripted pass: drag-and-drop between board columns,
      drag-to-schedule on the calendar, two-browser propagation, offline and recovery, token expiry
      mid-session, server-side session revocation, ⌘K and focus traps, the five responsive
      breakpoints, and an accessibility pass
- [x] DONE Anything it finds is filed as a **new ISS-nnn** (rule X1) — not fixed here → ISS-096/097/098
- **Why here:** by F31 the server behaviour is settled, so a UI failure is a UI failure rather than
  an artefact of a server bug
- **Gate:** the 12 e2e specs green, or every failure filed

## F32 — Full regression sweep — **DONE 2026-08-08: green (9 sweep-reds = 7 pool-flake + 2 parallel-build stale, all resolved)**
**Fixes:** nothing 🟢
- [x] DONE **All 30 server jest modules** — every one green (solo where the serial chain flaked on the shared pool)
- [x] DONE Client `vitest` — **44/44**
- [x] DONE `assistant-eval.cjs --assert` — **PERFECT** (15/15 links · 12/12 steps · 10/10 data · 15/15 Bangla · 0 fabricated · 0 forbidden); route-parity/kb-coverage green with the F28 `/sla` route
- [x] DONE P37 orphan sweep — **24/24 clean**
- [x] DONE P39 day-in-the-life — **47/47** (gated tree = superset of the 22/22 baseline)
- **Gate:** everything green, or a documented, accepted exception

## F33 — Production parity re-check — **DONE 2026-08-07 (local half; box half = documented operator handoff)**
**Fixes:** nothing 🟡
- [x] DONE Re-run every P41 check after the fixes: `db:setup` now **42/5/9** (X4 provenance documented), the bundle still secret-free
      and same-origin, nginx, pm2, the six cron conversions, logrotate
- [x] DONE (as handoff) Work through the deferred list that needs the real box: **is 5501 firewalled** (ISS-089),
      R2 genuinely unreachable (P23), `run-job.sh` with the API down (P32),
      `eng.not_configured` (P29), the 23:59→00:01 Dhaka boundary (P19/P37), assistant upstream
      failures (P33), SPA-origin headers (P38)
- [x] DONE Walk `DEPLOY_READINESS_SCAN_2026-07-28.md` §6 literally — 3 wrong steps found AND corrected in place (42/5/9; backups closed; **missing DB_TIMEZONE would have made prod refuse to boot**)
- **Gate:** the runbook completes without an undocumented surprise

## F34 — Final consolidation and go-live gate — **DONE 2026-08-08**
**Fixes:** ISS-095 (deferred in F28) + ISS-096/097/098 (filed F31) 🟢
- [x] DONE Every issue disposed — **96 FIXED · ISS-018 WON'T FIX (D4) · ISS-093 duplicate · 0
      silently open** (98-issue universe: 93 testing + 5 filed in-campaign)
- [x] DONE `fixing/FIX-LOG.md` complete
- [x] DONE **`fixing/FIXING_SUMMARY.md`** produced — the go-live gate deliverable
- [x] DONE **Re-verified P42's 15** — `fixing/evidence/F34/reverify-probe.cjs`: **15/15 no longer reproduce**, X8 baseline byte-identical
- **Gate:** F32 + F33 green, and the 15 re-verifications all negative

---

## 5. TRACEABILITY — all 93 issues have an owning phase

| Phase | Issues | n |
|---|---|---|
| F2, F3 | ISS-001, ISS-052, ISS-063a, ISS-081 — **all 4 FIXED in F3** | 4 |
| F4 | ISS-081 (verify only — closed by F3) | 0 |
| F5 | ISS-058, ISS-063b (client "(edited)" marker only) | 2 |
| F7 | ISS-024 | 1 |
| F8 | ISS-047 | 1 |
| F9 | ISS-053, ISS-060, ISS-084 | 3 |
| F10 | ISS-015, ISS-016, ISS-017, ISS-018, ISS-021 | 5 |
| F11 | ISS-087 | 1 |
| F12 | ISS-030, ISS-031, ISS-083 | 3 |
| F13 | ISS-009, ISS-085, ISS-086, ISS-089, ISS-091 | 5 |
| F14 | ISS-002, ISS-003, ISS-004, ISS-079, ISS-090 | 5 |
| F15 | ISS-046, ISS-065, ISS-080, ISS-092 | 4 |
| F16 | ISS-022, ISS-041, ISS-073 | 3 |
| F17 | ISS-025 | 1 |
| F18 | ISS-032, ISS-037, ISS-044, ISS-071, ISS-077, ISS-078 | 6 |
| F19 | ISS-064, ISS-072 | 2 |
| F20 | ISS-074, ISS-075, ISS-076 | 3 |
| F21 | ISS-049, ISS-061, ISS-062 | 3 |
| F22 | ISS-011, ISS-019, ISS-020, ISS-034, ISS-051 | 5 |
| F23 | ISS-007, ISS-008, ISS-010, ISS-012, ISS-014, ISS-040, ISS-048, ISS-067 | 8 |
| F24 | ISS-056, ISS-057, ISS-059 | 3 |
| F25 | ISS-050, ISS-054, ISS-055, ISS-066, ISS-069 | 5 |
| F26 | ISS-023, ISS-038, ISS-042 | 3 |
| F27 | ISS-026, ISS-027, ISS-033, ISS-035 | 4 |
| F28 | ISS-013, ISS-028, ISS-029, ISS-036, ISS-070, ISS-082, **+ ISS-094** (X1) | 7 |
| F29 | ISS-039, ISS-043, ISS-045, ISS-068 | 4 |
| F30 | ISS-005, ISS-006, ISS-088, **+ ISS-092** (X1, seed) | 4 |
| F32 | ISS-093 (→ duplicate of ISS-087, closed) | 1 |
| F34 | **ISS-095** (deferred in F28), **ISS-096/097/098** (filed F31) | 4 |
| | **TOTAL** | **98** (93 testing + 5 filed in-campaign) |

F1, F6, F31, F33 own no issue by design — they are decision, verification and consolidation phases.
The X1 in-campaign filings (092/093/094/095/096/097/098) are folded into their fixing phase above.

**Also carried (from `FULL_SYSTEM_SCAN_2026-07-29.md`, never given an ISS number):**
`SCAN-M5` (client permission gating + the Engineering nav) → **F26** ·
`SCAN-M4` (SSE unreachable from the browser) → **F28 decision** ·
`SCAN-H4` (3 stale dev triggers) → **F15**, where the subtask counters are rebuilt ·
`SCAN-M1` / `SCAN-M2` (preferences do nothing / no emails) → **F19**.

---

## 6. THE STARTING STATE (**re-baselined 2026-08-03 in F3** — was verified 2026-07-30)

The demo database is at a clean baseline. Any phase that dirties it restores it to these numbers:

```
tasks 46 · lists 13 · statuses 65 · spaces 6 · users 15 (15 active)
comments 7 · checklists 3 · checklist_items 14 · attachments 0 · notifications 57
forms 0 · form_fields 0 · form_submissions 0 · templates 0 · sprints 1 (active)
on_call_shifts 1 · task_reviews 9 · department_reports 12 · tags 8 · task_dependencies 0
triggers 10   ·   0 TEST- fixtures   ·   0 orphans
```

> **Why the numbers changed.** F3 re-seeded the demo DB
> (`ALLOW_DEMO_SEED=1 npm run db:seed:demo`, then `npx tsx scripts/demo-role-accounts.ts`, then the
> department-report job) to confirm the clock fix held on freshly written rows rather than only on
> rows written under the old clock. The seed is authoritative, so these are now the numbers to
> restore to — the 2026-07-30 set included leftovers from the testing phases' own fixtures. Decision
> **D1** (production is not live, data is disposable) is what makes a re-seed acceptable at all.
>
> The old baseline is still what `testing/results/PHASE-*.md` refer to; don't treat the difference as
> a leak. **`fixing/evidence/F01/clock-probe.cjs` carries these numbers too** — update both together.

**Deliberately preserved (rule X9):** the ISS-025 column drift (until F17) and the 3 stale
`trg_subtasks_after_*` triggers (until F15).

**Available fixtures:**
- `taskmanagement_perf` — a scratch DB with 5 000 tasks / 20 000 comments / 50 000 activity rows,
  built from a clean `schema.sql`. This is the ready-made instrument for F11 and F30.
- 11 demo accounts across every role (`DEMO_ACCOUNTS.md`), all password `Owner@12345`.
- Test harness recipes: a dedicated API per block on its own port with `DISABLE_RATE_LIMIT=1`;
  `node` + `mysql2` probe scripts; per-module jest configs.

---

## 7. DECISIONS THE USER MUST MAKE (collected)

These block or reshape their phases. They are gathered here so they can be answered in one sitting.

| # | Phase | Decision |
|---|---|---|
| D1 | F1 | Is production serving real users? (decides whether Block A needs a timestamp backfill) |
| D2 | F1 | Canonical clock: store UTC, or store Dhaka? |
| D3 | F6 | RBAC posture: gate all 21, delete all 21, or gate the security-relevant subset? |
| D4 | F10 | Role-change latency: shorter token TTL, a per-request version check, or accept 15 minutes? |
| D5 | F12 | Does the new password rule apply to existing users at next login? |
| D6 | F19 | For each of 7 producerless notification types: build the producer or remove the type? |
| D7 | F19 | Make preferences actually suppress, or hide the screen? Wire email, or drop `email_enabled`? |
| D8 | F20 | Real FULLTEXT indexes, or LIKE with better ordering? |
| D9 | F23 | Fix the inconsistent collection envelopes now (breaking), or document them? |
| D10 | F27 | Enforce name uniqueness on rename too? (existing duplicates need resolving) |
| D11 | F28 | Checklist item due dates (the GAP) — build or document as intentional? |
| D12 | F28 | Business hours, default locale, sprint delete, list move, SLA UI, SSE — build or remove? |

**Recommended:** answer D1, D2 and D3 before F1 starts. The rest can be answered at their phase.

---

## 8. SUGGESTED SEQUENCING

| stage | phases | closes | why here |
|---|---|---|---|
| **1** | F1 → F5 | CRITICAL + 4 | one root cause, five issues; everything downstream depends on the clock being right |
| **2** | F6 → F10 | 5 HIGH-ish | the security surface; F7 is the single largest change in the plan |
| **3** | F11 → F14 | 2 HIGH + 12 | makes the system survive 100 users and the open internet |
| **4** | F15 → F18 | 13 | data honesty; F17 retires a deliberately-preserved state |
| **5** | F19 → F23 | 21 | behaviour correctness; heaviest on decisions |
| **6** | F24 → F27 | 15 | the client stops contradicting the server |
| **7** | F28 → F30 | 13 | decisions, sweep, headroom |
| **8** | F31 → F34 | — | verification, including the UI testing debt |

**Stages 1–3 alone close the CRITICAL, all 10 HIGHs, and the capacity ceiling** — the shortest path
to a system whose behaviour matches its own description.

---

## 9. WHAT "DONE" MEANS

The fixing phase is complete when:

1. Every one of the 93 issues is FIXED, WON'T FIX (with a recorded decision), or DEFERRED (with a
   reason) — none left silently OPEN.
2. F32's full regression is green: 30 jest modules, client vitest, the assistant gate and its two KB
   guards, the 24-query orphan sweep, and the 22-assertion day-in-the-life.
3. The 15 issues P42 re-verified as reproducing now **fail to reproduce**.
4. F33's production runbook completes without an undocumented surprise.
5. `fixing/FIXING_SUMMARY.md` states the residual risk at go-live in plain language.
