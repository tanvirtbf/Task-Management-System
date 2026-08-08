# PHASE 19 — My Work, Home KPIs & Agenda

**Status:** DONE
**Methods:** API · DB · CODE
**Issues filed:** ISS-056, ISS-057, ISS-058, ISS-059 (4 MEDIUM)
**Confirmed, not re-filed:** `SCAN-L3` (`GET /home/agenda` is an orphan endpoint)
**Data left behind:** none — tasks 51, lists 14, statuses 70, 0 orphans.

---

## 1. The six KPI tiles, recomputed by hand — PASS, all six, for four accounts

Every tile was re-derived in raw SQL and compared to the API, for the owner, a member, a
space-scoped user and a guest:

| tile | owner | arif (member) | marketing.only | guest |
|---|---|---|---|---|
| myTasks | 1 = 1 | 3 = 3 | 0 = 0 | 0 = 0 |
| dueToday | 0 = 0 | 0 = 0 | 0 = 0 | 0 = 0 |
| overdue | 1 = 1 | 3 = 3 | 0 = 0 | 0 = 0 |
| awaitingReview | 0 = 0 | 0 = 0 | 0 = 0 | 0 = 0 |
| openTeamTasks | 31 = 31 | 31 = 31 | **6** (their space) | 31 |
| slaBreaches | 0 = 0 | 0 = 0 | 0 = 0 | 0 = 0 |

**Not one mismatch.** `dueToday` was then re-verified positively with a purpose-built fixture (a task
due today, assigned to the caller) and moved 0 → 1 correctly.

**Space scoping works on the two workspace-wide tiles.** `marketing.only@` sees `openTeamTasks = 6`,
which is exactly the open-task count of the Marketing space, against 31 for the whole workspace. The
`listScopeFilter` added to `openTeamSeries`/`slaBreachesSeries` does what it claims.

The guest's `openTeamTasks` is workspace-wide, but that is consistent rather than a leak: the guest
can already page through every task list by hand (32 KPI vs 52 tasks actually readable). Guest
breadth is an RBAC posture question already carried by ISS-024/ISS-042.

## 2. Everything *around* those correct numbers — ISS-057

The KPI card renders three things. The number is right; the other two are placeholders:

- the trend badge is hardcoded server-side to `0 / flat / false`, so all six cards permanently read
  **"— 0.0%"**;
- the sparkline is a `DATE(created_at)` histogram of the current set, not a series of the metric —
  `openTeamTasks` shows **31** above a line summing to **4**.

## 3. `GET /home/agenda` — correct, and unused

| probe | result |
|---|---|
| no `?date` | 200, bare array, only the caller's task due **today** |
| `?date=<tomorrow>` | 200, only the task due tomorrow |
| `?date=2030-12-31` | 200, `[]` (no upper bound — fine) |
| `?date=nonsense` / `2026-13-45` / empty | 422 `validation.failed` |
| hydration | 50 keys, same serializer as `GET /tasks/:id` (assignee ids, verified identical) |

Its result set is **identical** to `my-work.today`, and the client never calls it — `AgendaCard` uses
`tasksApi.myWork()`. So `SCAN-L3` is confirmed *and* sharpened: the endpoint is not merely
uncalled, it is a duplicate of a bucket the client already fetches.

What the card does with that data is the finding — **ISS-056**: `due_date` is a date-only string, so
`formatTime()` renders every row as **"6:00 AM"**, and the sort by that value is a no-op.

## 4. `GET /tasks/my-work` — PASS on every bucket boundary

Hand-counted in SQL first (all five buckets matched), then re-proved with fixtures placed
deliberately either side of each edge:

| fixture | bucket | |
|---|---|---|
| due today | `today` | as designed |
| due tomorrow | `next` | as designed |
| due yesterday | `overdue` | as designed |
| no due date | `unscheduled` | as designed |
| due in exactly 7 days | `next` | boundary is inclusive |
| due in 8 days | **no bucket** | documented — "work for now" only |
| an overdue task moved to Done | `done` | leaves `overdue` correctly |
| an archived task | no bucket | correctly excluded |

`?bucket=today` returns just that key; `?bucket=bogus` → 422.

## 5. Which clock decides "today" — ISS-058

`ymd(new Date())`, i.e. the API process's OS timezone. `workspaces.timezone` (`Asia/Dhaka`) and
`users.timezone` are stored, editable, validated and returned — and read by **nothing**.

Production is configured correctly (`TZ: "Asia/Dhaka"` in the pm2 ecosystem file, with a comment
explaining exactly why; the cron jobs fire through the API's own HTTP endpoint so they inherit it).
The finding is the un-checked coupling: `TZ` lives in one file, `DB_TIMEZONE` in another, and if they
ever disagree every DATE shifts a day silently. Measured under `TZ=UTC` with `DB_TIMEZONE=+06:00`:
`2026-07-07` comes back as `2026-07-06`.

## 6. "Awaiting My Review" — ISS-059

Counts `pr_status = 'open'`. All 51 tasks have `pr_status = NULL`, so the tile is 0 for everyone,
forever — while 11 completed tasks sit with no department-head verdict. The tile measures a workflow
this company does not use and ignores the one it does.

## 7. Home UI, read at source

| card | data source | note |
|---|---|---|
| `HomeGreeting` | client clock | time-of-day greeting + formatted date; no API |
| `KpiRow` → `KpiCard` ×6 | `GET /home/kpis` | → ISS-057 |
| `MyWorkCard` | `GET /tasks/my-work` | five tabs matching the five buckets exactly; `EmptyState` per tab |
| `AgendaCard` | `GET /tasks/my-work` → `.today` | → ISS-056; **not** `/home/agenda` |
| `LineupCard` | `GET /tasks/my-work` | `overdue ++ today`, capped at 6; documented as a Phase-2 stand-in for a curated queue |
| `RecentActivityCard` | `GET /activity/recent?limit=8` | tested in **P20** |

Three of the four cards share one `["my-work", user.id]` query key, so the page issues **two**
requests, not four. Every card has a real loading skeleton and a real `EmptyState`.

## 8. Coverage vs the plan

All 6 checklist lines executed. Two probes in the first run were wrong and were redone rather than
reported: the agenda happy path (the owner had no task due today, so an empty array proved nothing —
re-run with fixtures) and a guest comparison against `GET /tasks`, which is not a real endpoint
(re-run by paging every list the guest can reach).

The arithmetic behind Home is sound — six correct aggregates, correct space scoping, and five My Work
buckets that survive every boundary case. All four findings are about presentation and configuration
sitting on top of it.

**Evidence directory:** `testing/evidence/PHASE-19/` — 3 files.
