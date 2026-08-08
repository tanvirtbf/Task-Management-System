# PHASE 01 — Environment, build & health

**Status:** PARTIAL (3 items deferred with reasons — §8)
**Methods:** API · DB · CODE
**Issues filed:** ISS-001 (CRITICAL) · ISS-002 (HIGH) · ISS-003 (MEDIUM) · ISS-004/005/006 (LOW)
**Data left behind:** none — scratch DBs dropped, 0 stray `TEST-` rows in `taskmanagement`

---

## 1. Builds & typechecks — PASS

| check | result |
|---|---|
| `server: npx tsc --noEmit` | exit 0, **0 errors** |
| `server: npm run build` | exit 0 |
| `client: npx tsc -b --noEmit` | exit 0, **0 errors** |
| `client: npm run build` | exit 0, built in 38.07 s |

Client build emits a chunk-size warning -> **ISS-006**:
`index-BE8V4Iiz.js 1,450.97 kB (gzip 448.59)` · `TaskDetailDrawer-Cf9_mE5z.js 547.09 kB (gzip 172.06)`

## 2. `dist/` parity — PASS

Rebuilt both trees, then compared against git:

| | on disk | tracked | changed by rebuild | untracked |
|---|---|---|---|---|
| `server/dist` | 286 | 286 | **0** | 0 |
| `client/dist` | 61 | 61 | **0** | 0 |

The committed artifacts are byte-identical to a fresh build — **not stale**. `SCAN-M9` stays a
*future* hazard (a newly added source file's output would be silently ignored), not a current defect.

## 3. Health & diagnostics surface — PASS

Tested against the **compiled prod build** (`NODE_ENV=prod`).

| endpoint | status | ms | body |
|---|---|---|---|
| `GET /health` | 200 | 63 | `{"status":"ok","uptime":58.6}` |
| `GET /health/ready` | 200 | 8 | `{"status":"ready","checks":{"database":"ok"}}` |
| `GET /health/version` | 200 | 4 | `{"version":"1.0.0","git_sha":"unknown","uptime_seconds":58,"node":"v22.21.1"}` |
| `GET /metrics` | 200 | 5 | prometheus text |
| `GET /api/v1/health` | 404 | 17 | correct error envelope — correctly not mounted under v1 |
| `GET /api/v1/metrics` | 404 | 8 | same |

**Security headers on `/health`** — all five present, HSTS correctly appears only under prod:
`x-content-type-options: nosniff` · `x-frame-options: DENY` · `referrer-policy: no-referrer` ·
`x-permitted-cross-domain-policies: none` · `strict-transport-security: max-age=15552000; includeSubDomains`

This also proves `Config.IS_PROD` works.

**`/metrics` counters increment:** total `7 -> 13` after 5 × `/health` (+1 for the intervening
`/metrics` scrape). Correct.

**Prometheus format:** 96 lines · 8 `# HELP` · 8 `# TYPE` · 80 samples · **0 malformed lines**.
Metrics exposed: `http_requests_total`, `http_request_duration_seconds`, `background_job_runs_total`,
`sse_connections_open`, `mysql_pool_connections_in_use`, `process_uptime_seconds`,
`process_resident_memory_bytes`, `nodejs_heap_used_bytes`.

### 3b. `/health/ready` failure path — PASS

MySQL could not be stopped (no admin rights), so the 503 branch was forced by **pool exhaustion**:
a `DB_POOL_MAX=1` instance, its single connection held by a write blocked on an externally-held
row lock.

```
baseline (pool free)          HTTP 200 in    9ms
during pool exhaustion        HTTP 503 in  515ms  {"status":"not_ready","checks":{"database":"down"}}
during pool exhaustion (2nd)  HTTP 503 in  515ms
after release                 HTTP 200 in    4ms
```

The 500 ms timeout is honoured (515 ms wall), the probe never hangs, and it recovers cleanly with
no connection leak.

**Also tested:** killing the pooled connection from MySQL (`KILL CONNECTION`) — the pool self-heals
transparently, `/health/ready` correctly stays 200, and a subsequent login works. Correct behaviour.

## 4. Database provisioning & destructive-script guards

| test | result |
|---|---|
| `db:setup` on an absent/empty DB | **PASS** — `{"tables":41,"views":5,"triggers":7}` |
| `db:setup` on a non-empty DB | **PASS** — refuses, exit 1, DB untouched (41 tables intact) |
| `db:setup:fresh` with `NODE_ENV=prod` | **PASS** — `REFUSING --drop: NODE_ENV=prod` |
| `db:seed:demo` direct `tsx`, `NODE_ENV=prod` | **PASS** — refuses |
| `db:seed:demo` direct `tsx`, no `ALLOW_DEMO_SEED` | **PASS** — refuses |
| **`db:seed:demo` via npm script, `NODE_ENV=prod` + `ALLOW_DEMO_SEED=1`** | **FAIL -> ISS-002** — wiped 41 tables |
| `db:seed` (non-demo) | no destructive statements; has its own prod guard on the default owner password |

The fresh `db:setup` result (**7 triggers**) independently confirms `SCAN-H4`: the live dev DB has 10.

## 5. Configuration & boot matrix

13 boot variations, each spawned fresh:

| variation | booted? | behaviour |
|---|---|---|
| `ENCRYPTION_KEY` absent | yes | warns `ENCRYPTION_KEY missing — public form submissions will return 503` ✔ |
| `ENCRYPTION_KEY` malformed (`deadbeef`) | **no**, exit 1 | `must be 64 hex chars` ✔ |
| `ENCRYPTION_KEY` 63 hex | **no**, exit 1 | same ✔ |
| `ACCESS_TOKEN_SECRET` missing | **no**, exit 1 | `express-jwt: 'secret' is a required option` — fails closed ✔ |
| `REFRESH_TOKEN_SECRET` missing | **yes** | reports READY, then every login 500s -> **ISS-003** |
| `COOKIE_SECRET` missing | yes | no functional effect at all -> **ISS-004** |
| `INTERNAL_JOB_TOKEN` missing | yes | `/jobs/*` returns 401 for no header, empty header, and any value — fails closed ✔ |
| `DB_PASSWORD` wrong | **no**, exit 1 | `Access denied` ✔ |
| `DB_NAME` nonexistent | **no**, exit 1 | `Unknown database` ✔ |
| `DB_TIMEZONE=Asia/Dhaka` (named) | **no**, exit 1 | `must be a fixed offset like "+06:00"` ✔ |
| `DB_TIMEZONE=6` (garbage) | **no**, exit 1 | same ✔ |
| `DB_TIMEZONE=+06:00` | yes | ✔ |
| `DB_SOCKET_PATH=/tmp/nope.sock` | **no**, exit 1 | `connect ENOENT /tmp/nope.sock` — proves the socket branch wins over host/port ✔ |

## 6. Timezone round-trip — **CRITICAL FAILURE (ISS-001)**

The single most important result of this phase. Four independent experiments:

1. **Driver matrix** — raw mysql2 is correct whenever its `timezone` option matches the MySQL
   session (`default`/`local`/`+06:00` with a Dhaka session; `+00:00`/`Z` with a UTC session).
   mysql2 is **not** at fault.
2. **Drizzle path** — `db.select({ca: tasks.createdAt})` returns a Date whose **UTC** rendering
   equals the *session-local* string. Drizzle ignores the mysql2 `timezone` option and always
   treats TIMESTAMP as UTC. Correct only when the session is `+00:00`.
3. **Storage offset** — a deadline written through the API as *now + 60 min* is seen by MySQL as
   **−300 min** (5 h in the past) under both the dev default and the documented prod
   `DB_TIMEZONE=+06:00`; **+60 min** (correct) under `+00:00`.
4. **Real dev DB** — a task created at `16:13:48` Dhaka is returned by the API as
   `2026-07-29T16:13:48.000Z`, which a browser renders as `22:13:48` — **6 h in the future**.

App-written values round-trip through the API exactly (write-as-UTC / read-as-UTC is
self-consistent), which is why this has stayed hidden. Everything MySQL evaluates itself — the 5
views, the triggers, the cron cutoffs — is 6 h wrong.

Full write-up, tables and repro steps: **ISS-001**.

## 7. Boot performance

| command | DB ready | listening |
|---|---|---|
| `node dist/server.js` (prod path) | 0.39 s | **1.2 s** |
| `npx tsx src/server.ts` (dev path) | 2.2 s | **16.7 s** -> ISS-005 |

A one-off 24 s `dist` boot immediately after `npm run build` did **not** reproduce (cold file cache
on 286 freshly-written files). Steady state is 1.2 s. Not an issue — recorded so it is not chased
again.

## 8. Deferred / not verified (rule R10)

| item | why | moved to |
|---|---|---|
| `ENCRYPTION_KEY` absent -> public form submission returns 503 | the demo dataset contains **0 forms**, so there is nothing to submit to. The boot-time warning half was verified. | **P26** |
| Graceful shutdown (SIGTERM closes SSE, then the pool, exit 0) | **Windows does not deliver SIGTERM or SIGINT** to a spawned process — it is terminated outright. Neither signal produced any handler output. Untestable on this platform. | **P41** (verify on the Linux prod box) |
| SLA breach end-to-end confirmation of ISS-001 | `GET /sla/breached` returned 0 rows in all three timezone configurations, including the one where MySQL agrees the task *is* breached — an unrelated endpoint filter (dev-type / severity / team) excluded the fixtures. ISS-001 is already proven at the DB level. | **P30** |

## 9. Cleanup performed

- Dropped scratch DBs `tms_p1_setup`, `tms_scan0729_test`, `tms_scanA/C/D_test`
- Killed every spawned instance (ports 5502–5591)
- Verified **0** stray `TEST-%` / `%probe%` rows in `taskmanagement.tasks`
- `taskmanagement` still has **10** triggers — `SCAN-H4` deliberately left in place (test mode does
  not fix)
- `git status` for `server/dist` and `client/dist`: **0 changed files** after the rebuild

## 10. Coverage vs the plan

All 13 plan checklist lines were executed. 10 passed, 1 failed critically (§6), 2 produced new
non-critical findings (§5), 3 sub-items deferred with reasons (§8).

**Evidence directory:** `testing/evidence/PHASE-01/` — 10 files.
