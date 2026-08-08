# PHASE 40 — Performance & scale

**Status:** PARTIAL (client bundle metrics and a sustained memory run deferred — §7)
**Methods:** API · DB, against a **separate scratch database** (`taskmanagement_perf`)
**Issues filed:** ISS-087 (HIGH) · ISS-088 (LOW)
**Data left behind:** none in the demo database — this phase never touched it.

---

## 0. Method — the demo data was never at risk

A second database was created from `database/schema.sql` via `db:setup --drop`, a second API booted
against it on `:5713`, and the volume seeded there:

```
41 tables / 5 views / 7 triggers   (a clean prod-shaped schema)
1 workspace, 40 users, 8 spaces, 40 lists, 120 statuses
5 000 tasks · 5 000 assignees · 20 000 comments · 50 000 activity rows
total seed time: 12 s
```

Final table sizes: `task_activity` 23.1 MB, `comments` 12.6 MB, `tasks` 6.5 MB.

## 1. Endpoint latency at volume — good

Median of 7 runs each. **Nothing exceeded 300 ms.**

| endpoint | median | bytes |
|---|---|---|
| `/activity/recent` | **2.6 ms** | 11 |
| `/activity?limit=50` | 4.0 ms | 81 |
| `/spaces` | 5.3 ms | 2 128 |
| `/users?limit=50` | 5.3 ms | 9 441 |
| `/home/agenda` | 5.5 ms | 2 |
| `/tasks/:id/comments` | 5.9 ms | 1 176 |
| `/notifications?limit=50` | 6.2 ms | 81 |
| `/tasks/:id` | 7.4 ms | 1 160 |
| `/tasks/:id/activity?limit=50` | 7.4 ms | 4 281 |
| `/lists/:id/tasks?limit=50` | 17.3 ms | 58 707 |
| `/lists/:id/tasks?limit=200` | 19.6 ms | 146 716 |
| `/home/kpis` | 24.1 ms | 906 |
| `/tasks/my-work` | 24.4 ms | 104 447 |
| `/search?q=task 250` | 83.5 ms | 12 985 |
| **`/search?q=Perf`** | **124.9 ms** | 33 388 |

Search is the slowest by a factor of five — consistent with ISS-076, since it is `LIKE '%q%'` across
five tables with no index able to help.

## 2. Pagination at depth — flat

```
list tasks, 125 in the list: page 1 = 14.7 ms  ->  page 13 = 13.7 ms
```

Cursor pagination does what it is supposed to: depth costs nothing. (A first attempt at this measured
`workspace_activity`, which the seed left empty, and was therefore meaningless — re-run against a
table that actually has rows.)

## 3. N+1 — none

Query counts captured with the MySQL general log, one request each:

```
GET /activity?limit=50          2 queries
GET /tasks/:id                  6 queries
GET /lists/:id/tasks?limit=50   8 queries
GET /home/kpis                  8 queries
GET /search?q=Perf             13 queries
```

No endpoint scales its query count with its result count. The hydration is properly batched.

## 4. Concurrency — the phase's finding, ISS-087

```
 5 concurrent -> 0 failed        20 concurrent -> 0 failed
10 concurrent -> 0 failed        30 concurrent -> 3 FAILED
15 concurrent -> 0 failed        50 concurrent -> 37 FAILED (500 internal)
the same 50 sequentially -> 50/50 ok
```

Cause, from the server log: **`Unhandled error Queue limit reached.`** — the mysql2 pool
(`DB_POOL_MAX=20`, `DB_POOL_QUEUE_LIMIT=50`) runs out of queue slots, and the driver's error surfaces
as a generic 500. Because one request issues up to 8 queries, several in parallel, ~30 requests are
enough to saturate 70 slots.

## 5. `EXPLAIN` on the hot paths — ISS-088

Four of the seven hottest queries do **Using filesort** (list tasks, task comments, task activity,
workspace activity) because pagination orders by `internal_id` while the indexes end in a time
column. Two more (`LIKE` search, overdue count) fall back to a 2 226-row scan. None of it hurts at
this volume; all of it is the first thing that will bend at ten times the volume.

`my open tasks` is the one that is fully covered — `Using index`, no table access at all.

## 6. Pool behaviour

`MySQL max_connections` is **151** on this box, shared with the five other production apps.
`Threads_connected` peaked at **86** during the bursts. Raising `DB_POOL_MAX` therefore trades this
application's stability against its neighbours' — which is exactly why ISS-087 recommends fixing the
queue behaviour rather than the pool size.

## 7. Deferred (rule R10)

| item | why |
|---|---|
| memory over a sustained run (pm2 restarts at 400 MB) | needs a long soak, and the meaningful measurement is on the production box |
| client bundle size, initial paint, route-chunk sizes | needs a production build — folded into **P41**, which builds it anyway |
| reports at volume | the perf workspace has no report history to generate against |

## 8. Coverage vs the plan

6 of the 8 checklist lines executed. The headline is reassuring and the caveat is specific: **at
5 000 tasks this system is fast** — a 200-task list page renders its payload in under 20 ms, and the
only endpoint above 30 ms is the substring search. What it does not do is degrade gracefully. Past
roughly 20–30 simultaneous requests it stops answering rather than slowing down, and it says
"Internal server error" while doing it.

**Evidence directory:** `testing/evidence/PHASE-40/` — 3 files.
