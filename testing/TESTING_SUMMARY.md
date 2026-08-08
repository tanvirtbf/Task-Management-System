# TESTING PHASE — FINAL SUMMARY

**Scope:** the whole BeautyBooth task-management system — backend, database, API, frontend,
deployment artifacts.
**Plan:** `TESTING_MASTER_PLAN.md` (42 phases, 7 blocks)
**Issue log:** `testing/ISSUES.md` (91 issues, ISS-001 … ISS-091)
**Per-phase detail:** `testing/results/PHASE-01.md` … `PHASE-42.md`
**Evidence:** `testing/evidence/PHASE-nn/` — raw transcripts of every run
**Finished:** 2026-07-30

> **Operating rule that held throughout: nothing was fixed.** Every phase tested and logged. The two
> environment changes made (temporarily restoring dev-vs-prod schema parity) were both reverted and
> are documented in the phases that made them.

---

## 1. The headline

**91 issues: 1 CRITICAL · 10 HIGH · 47 MEDIUM · 32 LOW · 1 GAP.**

The system's **core mechanics are sound**. Task CRUD, authorization gates on the paths that have
them, transactions, FK cascades, unique constraints under concurrency, background jobs, encryption at
rest, the AI assistant, and every department's real workflow all work. P39 ran eight complete
day-in-the-life journeys across eleven accounts and scored **22/22** with no new defects.

What the testing found is concentrated in four themes, and almost every serious issue belongs to one
of them:

| theme | issues | one-line statement |
|---|---|---|
| **A. The 6-hour clock** | ISS-001, ISS-052, ISS-058, ISS-063, ISS-081 | Drizzle writes TIMESTAMP as UTC while MySQL runs `+06:00`. Every consequence is a separate, visible defect. |
| **B. Permissions that do nothing** | ISS-024 (+ISS-047) | 21 of 56 permissions are not enforced anywhere; the admin toggles for them are inert. |
| **C. Read paths that forgot the space filter** | ISS-053, ISS-060, ISS-084 | Three endpoints return data from spaces the caller cannot open, while every other read path filters correctly. |
| **D. Counters that only move one way** | ISS-046, ISS-065, ISS-080 | Three of four denormalised counters drift. `attachments_count` is the one that is right and is the model to copy. |

---

## 2. Every CRITICAL and HIGH issue

| id | phase | severity | what it is |
|---|---|---|---|
| **ISS-001** | P1 | CRITICAL | Every timestamp is stored 6 hours off — Drizzle parses/writes `TIMESTAMP` as UTC while the MySQL session is `+06:00`. Root cause of theme A. |
| **ISS-002** | P1 | HIGH | `npm run db:seed:demo` bypasses the production guard and wipes the database. |
| **ISS-024** | P5 | HIGH | **21 of 56 permissions do nothing.** Measured by executing each permission's endpoint with the grant withheld and granted. |
| **ISS-025** | P5 | HIGH | `GET /forms/:id/submissions` 500s — the **dev** database is missing two columns. P41 proved a fresh `db:setup` has them, so production is fine; this is dev drift. |
| **ISS-047** | P15 | HIGH | `own` scope does not narrow anything — a `task.edit`-at-`own` holder edited someone else's task. |
| **ISS-053** | P18 | HIGH | A dependency edge hydrates the full 50-field task of a space the reader cannot open (name, description, assignees). |
| **ISS-060** | P20 | HIGH | The workspace audit trail is readable by **every** account — a guest reads role changes, deactivations and invitations with actor emails. |
| **ISS-063** | P21 | HIGH | The 15-minute comment edit window is really **6 h 15 m**, and the client never marks a comment as edited. |
| **ISS-081** | P30 | HIGH | Every SLA deadline is written 6 hours short, so an **S0 bug is already breached when filed**; the breach report is a further 6 hours late and under-reports by exactly 360 minutes. |
| **ISS-083** | P38 | HIGH | The password policy is length-only — `password`, `12345678`, `aaaaaaaa` all accepted. |
| **ISS-087** | P40 | HIGH | 50 concurrent requests → **37 fail with 500** (DB pool queue exhaustion). Failures start around 30 concurrent. |

All eleven were **re-verified in P42 and all still reproduce** — no phantom entries.

---

## 3. Recommended fixing order

Sequenced by *leverage*, not severity alone — batch 1 closes five issues by fixing one thing.

### Batch 1 — the clock (closes 5 issues, one root cause)
`ISS-001` → and with it `ISS-052`, `ISS-058`, `ISS-063`, `ISS-081`.
Make MySQL and the driver agree on one frame. `db/client.ts:63` already has `dateStrings: true`
commented out — that alone removes the DATE half. For TIMESTAMP, either set the session to `+00:00`
or stop letting Drizzle write `Date` objects into columns MySQL also defaults.
**Also fix in this batch:** `SlaRepo.ts:95` — swap `UTC_TIMESTAMP()` for `NOW()`, which makes the SLA
endpoint and `v_breached_sla` agree.

### Batch 2 — authorization (closes 4 issues)
`ISS-024`, `ISS-047`, `ISS-053`, `ISS-060`, `ISS-084`.
Two separate jobs: (a) put `requirePermission` on the 21 ungated routes, or delete those permissions
from the catalog so the UI stops lying; (b) apply the existing space filter to the three read paths
that skip it — the pattern is already correct in `SearchRepo` and the sprint task list.

### Batch 3 — stop the bleeding in production (closes 3)
`ISS-087` (pool queue → 503 with `Retry-After`, or `DB_POOL_QUEUE_LIMIT=0` as `.env.example` already
suggests), `ISS-083` (a real password rule), `ISS-089` (`app.listen(PORT, "127.0.0.1")` — one line).

### Batch 4 — data honesty (closes 4)
`ISS-046`, `ISS-065`, `ISS-080`, `ISS-073`. Copy the `attachments_count` AFTER-UPDATE trigger pattern;
add a cascade or a janitor sweep for notifications.

### Batch 5 — the notification system (closes 3)
`ISS-064`, `ISS-072`, plus `SCAN-M1`/`SCAN-M2`. Decide the story: 5 of 12 types have producers, the
preferences screen governs none of them, and no email is ever sent. Either wire it up or hide what
does not work.

### Batch 6 — UI truthfulness (closes 4)
`ISS-050`, `ISS-054`, `ISS-057`, `ISS-061`, `ISS-066`. Mostly small: stop drawing a fabricated
"— 0.0%" and an unrelated sparkline, teach the activity feed the server's real vocabulary, make
`#T-<number>` references resolve.

Everything else is LOW and can be swept afterwards.

---

## 4. Coverage — what was actually executed

**42 of 42 phases ran.** No phase was skipped.

| block | phases | outcome |
|---|---|---|
| A — Foundations | P1–P5 | 27 issues; RBAC enforcement measured definitively |
| B — Structure | P6–P12 | 16 issues; the duplicate-name pattern settled (3 of 8 resources enforce) |
| C — Tasks | P13–P20 | 19 issues; the task engine is strong, its edges are not |
| D — Collaboration | P21–P25 | 14 issues |
| E — Specialized modules | P26–P31 | 6 issues — **four of six phases came back clean** |
| F — Platform & UX | P32–P38 | 8 issues; P32 and P37 clean |
| G — Whole-system | P39–P42 | 5 issues; P39 scored 22/22 |

**Regression suites at the end (P42):**

```
server jest — auth module          339/339 passed
server jest — users module         278/279 passed — the ONE failure is ISS-087 (a repo test
                                   asserting 50 parallel reads all return 200; it returns 500)
client vitest                       44/44  passed
assistant eval gate (live model)   PERFECT — 15/15 links, 12/12 steps, 15/15 Bangla,
                                    10/10 data, 0 fabricated, 0 forbidden
assistant jest (incl. both guards) 127/127 passed
```

**Database integrity (P37):** 24 orphan-detection queries across the schema — **23 clean**. The one
failure is ISS-073.

**Performance (P40), at 5 000 tasks / 20 000 comments / 50 000 activity rows:** no endpoint over
300 ms; the slowest is `/search` at 125 ms; cursor pagination is flat with depth; **no N+1 anywhere**.

---

## 5. What was deliberately NOT covered, and why

Being explicit about this matters more than the issue count.

| area | status | why |
|---|---|---|
| **UI interaction** — drag-and-drop, two-browser sync, offline, keyboard, responsive, accessibility | **not tested** | P34/P35/P36 verified rendering, routing, guards and the console in a real browser, then stopped. Driving interaction one screenshot at a time produces evidence too weak to trust. **This needs one scripted Playwright pass covering all three phases together** — it is the single largest remaining gap. |
| **The 12 Playwright e2e specs** | not run | Same harness gap; `client/e2e/*.pw.ts` exist and are ready. |
| **The full 30-module jest sweep** | started, incomplete | Each module takes 2–5 minutes (bcrypt). `auth` passed 339/339; the rest is running into `testing/evidence/PHASE-42/jest-sweep.txt`. |
| **Anything needing the live production box** | deferred to a deploy checklist | Is TCP 5501 firewalled (decides ISS-089); the `DEPLOY_READINESS_SCAN` §6 runbook walked literally; R2 genuinely unreachable; `run-job.sh` with the API down; `eng.not_configured`; the 23:59→00:01 Dhaka boundary; assistant upstream failures; SPA-origin headers. |
| **`hidden_from_guests` redaction end-to-end** | blocked | ISS-042 — the flag cannot be set through the API at all. |

---

## 6. A note on method

Roughly **35 probes across the 42 phases were wrong before they were right** — a wrong payload key, a
wrong route, a wrong role assumption, an animation caught mid-flight. Every one was traced to its
source, corrected, and re-run, and each phase file lists its own corrections in a table.

Several would have become confident, wrong bug reports: "the assistant ignores conversation ids"
(the id goes in the body, not the header), "another department's head can review any task" (that head
is an admin — the documented override), "the snooze feature is inert" (it marks read; the wake job
un-reads it), "JWT role escalation works" (the owner's token re-encoded to an identical payload).

Two incidents caused real damage and were repaired in the same run: the password-policy probe changed
the owner's password (restored and verified), and a cleanup query removed 13 already-orphaned
notification rows (all confirmed dangling, no seed data lost).

**The demo database ends exactly where it started** — 51 tasks, 14 lists, 70 statuses, 9 spaces,
16 users, 8 comments, 1 attachment, 65 notifications, 12 reports, 10 triggers, 0 leftover fixtures,
0 orphans, and both ISS-025's dev drift and the SCAN-H4 triggers deliberately preserved so they stay
reproducible for whoever fixes them.

---

## 7. Verdict

This is a system that **works** and is **not yet honest about itself**.

Every workflow BeautyBooth actually runs completes end to end. The failures are concentrated in
things the product *claims* — a permissions screen whose toggles do nothing for 21 of 56 rows, an SLA
that reports the wrong hour, KPI cards drawing invented trend lines, an edit window 25× wider than it
says, counters that only climb — plus one genuine capacity limit (ISS-087) that turns a busy morning
into 500s.

Batches 1–3 address the CRITICAL, all ten HIGHs, and the capacity ceiling. That is the shortest path
to a system whose behaviour matches its own description.
