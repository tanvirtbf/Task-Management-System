# PHASE 41 — Production parity

**Status:** PARTIAL (the runbook must still be walked on the real box — §9)
**Methods:** CODE · API (`NODE_ENV=prod`, limiters ON, against the scratch DB)
**Issues filed:** ISS-089 (MEDIUM) · ISS-090, ISS-091 (LOW)
**Data left behind:** none — this phase ran against `taskmanagement_perf`.

---

## 1. `db:setup` on a fresh prod-shaped database — PASS, exactly

```
npm run db:setup:fresh  (against a brand-new database)
  Database setup complete {"tables":41,"views":5,"triggers":7}
```

**41 / 5 / 7 — exactly the documented shape.** Two useful by-products:

- The **H3 guard works**: a first attempt against a database that already had tables was refused with
  *"Refusing to apply schema.sql: database … already has 41 tables and schema.sql would DROP them
  all"*. The destructive-wipe trap the deploy scan warned about is now fenced.
- `form_submissions` on the fresh database **has `encrypted_at` and `expires_at`**. That settles
  ISS-025 definitively: production is fine, only the dev database drifted.

## 2. The production client bundle — clean

Built with `vite build` (which loads `.env.production`):

```
VITE_BACKEND_API_URL: "/api/v1"          <- relative, same-origin, domain-independent
```

The committed `client/dist` carries the same value. The `:5501` fallback still exists in the source
(`"/api/v1".trim() || …:5501/api/v1`) but is unreachable dead code because the baked value is
truthy — so the deploy scan's "the client bundle would call :5501" finding is **fixed**.

Secrets: `OPENAI`, `ENCRYPTION_KEY`, `JWT_SECRET`, `INTERNAL_JOB_TOKEN`, `CLOUDFLARE_R2` — **0
matches** in 58 JS chunks. (`sk-` matched five files but every hit was a substring of ordinary words —
`task-level`, `task-types`, `mask-motion`.) No `mock-api`, no dev-only code.

**Bundle size**, which P40 deferred here:

| chunk | raw | gzip |
|---|---|---|
| `index` (main) | 1 451 kB | **449 kB** |
| `TaskDetailDrawer` | 547 kB | 172 kB |
| `Table` (antd) | 164 kB | 52 kB |
| `FormBuilderPage` | 73 kB | 23 kB |
| `ListPage` | 67 kB | 18 kB |
| total dist | **2.7 MB** across 58 files | |

Vite warns about the two chunks over 500 kB. Route-level code splitting is clearly working (each page
is its own small chunk); the weight is in the vendor bundle and the task drawer. Recorded as a
measurement, not filed — 449 kB gzipped on a first load is heavy but not broken, and it is cached
`immutable` for a year by the nginx rule below.

## 3. Rate limiters — PASS (deferred here from P26, P33, P38)

```
bad login 1-5  -> 401, header RateLimit-Limit: 5
bad login 6    -> 429 auth.rate_limited, Retry-After: 60
```

Exactly the documented 5/min, with standard headers. The general limiter deliberately keys on the
Bearer `sub` rather than the IP, so an office NAT does not share one bucket (gap-scan M1).

The bypass probe found one conditional weakness — `X-Forwarded-For` spoofing works when the API is
addressed directly, and does **not** work through nginx. Filed as **ISS-089**, whose real content is
"is port 5501 firewalled?".

## 4. Prod-mode response headers

```
strict-transport-security   max-age=15552000; includeSubDomains     <- set in prod mode
x-content-type-options      nosniff
x-frame-options             DENY
referrer-policy             no-referrer
content-security-policy     absent
x-powered-by                Express                                  <- still advertised
```

HSTS **is** switched on by `NODE_ENV=prod` — which corrects the P38 reading, where the dev-mode API
had none. CSP remains absent everywhere, and nginx adds no headers of its own, so ISS-086 stands with
that one correction.

## 5. nginx — well built

| requirement | verdict |
|---|---|
| SPA fallback | `try_files $uri $uri/ /index.html` ✔ |
| `/api/v1` proxy | → `127.0.0.1:5501`, XFF/Real-IP/Proto set, 120 s read timeout ✔ |
| **SSE location** | `= /api/v1/assistant/chat` with `proxy_buffering off`, `gzip off`, `proxy_cache off`, 300 s timeout ✔ |
| body size | `client_max_body_size 32m` (attachments cap 25 MB, express.raw 30 mb) ✔ |
| cache headers | `/assets/` 1 y immutable; `index.html` `no-store, must-revalidate` ✔ |
| Cloudflare real IP | `cloudflare-realip.conf` + a generator script that refuses to install fewer than 15 ranges ✔ |
| `/metrics` unreachable | yes — but by omission, not by a `deny` → **ISS-091** |
| security headers | none set at the edge |

## 6. pm2 — correct

```
instances: 1, exec_mode: fork          (deliberate — in-process limiter/metrics/SSE registries)
TZ: Asia/Dhaka   NODE_ENV: prod
max_memory_restart: 400M
script: dist/server.js   cwd: /var/www/html/tasks-beautybooth/server
server/dist/server.js exists in the repo: yes
```

The `TZ` here is the half of ISS-058's pair that makes dates correct; it is set and commented.

## 7. cron — all six conversions verified

```
snooze-wake             */5 * * * *     timezone-independent
session-cleanup         02:10 UTC  ->  08:10 Dhaka
attachment-janitor      02:20 UTC  ->  08:20 Dhaka
r2-purge                02:30 UTC  ->  08:30 Dhaka
form-submission-expiry  02:40 UTC  ->  08:40 Dhaka
department-report       Mon 03:00 UTC -> MONDAY 09:00 Dhaka   (dow=1, no day rollover)
```

Every one matches its own comment. The Monday report lands on Monday morning Dhaka, as documented.

## 8. logrotate — correct

`daily`, `rotate 14`, `maxsize 50M`, `compress`, `delaycompress`, `missingok`, `notifempty`,
`create 0640 root root`, and **`copytruncate`** — which is the right choice for pm2 and winston,
since both hold their log file handles open.

## 9. Deferred (rule R10) — needs the real box

| item | why |
|---|---|
| the `DEPLOY_READINESS_SCAN` §6 runbook walked literally | needs SSH to 209.38.65.61 |
| cookie `Secure` / `HttpOnly` / `SameSite` in prod mode | the probe's own limiter test exhausted the login bucket and the follow-up login returned 429; re-run after a 60 s cooldown |
| is TCP 5501 firewalled? | the deciding question for ISS-089 |
| R2 genuinely unreachable (P23) | needs credentials broken on a live box |
| `run-job.sh` with the API down (P32) | same |
| `eng.not_configured` (P29) | needs the Bug type / Bug Triage list removed |
| the 23:59 → 00:01 Dhaka boundary (P19, P37) | needs the system clock moved |
| assistant upstream errors — timeout / openai_error / empty_reply (P33) | needs the OpenAI endpoint broken deliberately |
| SPA-origin response headers (P38) | needs the built client behind the real vhost |

## 10. Coverage vs the plan

7 of the 9 checklist lines executed. The deployment artifacts are in good shape — the schema
provisions to exactly the documented counts behind a destructive-wipe guard, the bundle is
same-origin and secret-free, nginx handles SPA fallback, the SSE stream and cache headers correctly,
pm2 pins the timezone, all six cron conversions are right, and logrotate uses `copytruncate`.

What is left is a short list of things only the live box can answer, headed by one question that
decides a security finding: **is port 5501 open to the internet?**

**Evidence directory:** `testing/evidence/PHASE-41/` — 2 files.
