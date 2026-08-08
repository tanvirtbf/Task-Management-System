# 🚀 DEPLOY-READINESS SCAN — full system (2026-07-28)

**Scope:** server runtime/config · client build · database/provisioning · API security surface
**Method:** 4 parallel read-only source scans + builds/typechecks/tests run for real on this machine.
Every BLOCKER below was **personally re-verified** against the code, not taken on an agent's word.

---

## VERDICT

**The application code is production-grade. The *deployment path* has never been executed once, and it is broken.**

Nothing here is a rewrite. The blockers are a broken start script, a dotenv path that fails
silently under the compiled build, secrets committed in two tracked docs, and a destructive seed
script with no production guard. Roughly **half a day of config work**, then this ships.

| | |
|---|---|
| 🔴 **BLOCKERS** | **7** — deploy fails, or data/secrets are lost |
| 🟠 **HIGH** | **14** — will bite within the first weeks |
| 🟡 **MEDIUM** | 12 — fix soon after |
| ✅ **Green** | builds, typechecks, tests, auth/error/upload layers |

---

## 1. THE GREEN LINE — what I ran today, and it passed

| Check | Result |
|---|---|
| Server `tsc --noEmit` | **clean** ✅ |
| Server `npm run build` | **compiles** ✅ (but emits to the wrong path — BLOCKER 1) |
| Client `npm run build` (`tsc -b && vite build`) | **clean, 1m 6s** ✅ |
| Client `vitest` | **7 files / 40 tests** ✅ |
| `jest.assistant` | **5 suites / 104 tests** ✅ |
| Env hygiene | `server/.env`, `server/.env.dev`, `server/.env.test`, `client/.env` all **git-ignored** ✅ |

The uncommitted working-tree work (AI assistant perfect-plan P0–P4) is green and safe to commit.

**One caveat on that client build:** it was built with the current `client/.env`, where
`VITE_BACKEND_API_URL` is **empty**. That `dist/` is **not deployable** — see BLOCKER 5.

---

## 2. 🔴 BLOCKERS

### B1 — `npm start` cannot start the server
`server/tsconfig.json:7-8` has `rootDir: "./"` with `include: ["src/**/*.ts"]`, so `tsc` emits
**`dist/src/server.js`**. But `package.json:5,9` (`main`, `start` → `node dist/server.js`) and
`server/docker/prod/Dockerfile:29` (`CMD ["node","dist/server.js"]`) all point at
**`dist/server.js`**, which does not exist.

**Verified:** `Test-Path dist\server.js` → `False`; `Test-Path dist\src\server.js` → `True`.

Result: `npm start` and the prod container die instantly with `MODULE_NOT_FOUND`.

**Fix (pick one):** set `"rootDir": "./src"` in tsconfig so output lands at `dist/server.js`
(keeps package.json + Dockerfile correct), **or** change `main`/`start`/`CMD` to `dist/src/server.js`.
The first is cleaner. Whichever you pick, `Dockerfile:25` (`COPY … ./dist/db/migrations`) must match.

### B2 — under the compiled build, `.env` is never loaded, silently
`server/src/config/index.ts:5-7` loads `path.join(__dirname, "../../.env")`.

- Under `tsx` (`src/config/`) → `server/.env` ✅ — this is why dev has always worked.
- Under the compiled build (`dist/src/config/`) → **`server/dist/.env`**, which doesn't exist.

dotenv **fails silently**. The server boots with no DB credentials, no JWT secrets, no
`ENCRYPTION_KEY` — and the only visible symptom is a confusing crash or 500s. A bare-VM
`npm start` deploy hits this immediately.

**Fix:** either export every var in the real process environment (systemd `EnvironmentFile=`,
Docker `--env-file` — the Docker path already works this way), or make the dotenv path
build-aware. **If you deploy with pm2/systemd on a VM, this WILL bite you.**

### B3 — live-format encryption keys committed in two tracked docs
`ENCRYPTION_SETUP.md` (7 occurrences) and `PRE_DEPLOYMENT_CHECKLIST.md` (4 occurrences) contain
**11 paste-ready 64-hex `ENCRYPTION_KEY=` values** labelled dev / staging / **prod**, with
instructions to copy them into `.env.local` and Kubernetes secrets.

**Verified:** both files are `git ls-files`-tracked → already pushed to `origin/main`.

This key decrypts at-rest form-submission PII (`FormsService.ts:751`). This is **separate from**
the 2026-07-23 purge, which covered `ENCRYPTION_KEYS.txt` and `deploy.sh` only — these two files
were missed.

**Fix:** confirm none of the 11 is your live key → generate a fresh prod key → strip the values
from both docs → commit. History purge optional (private repo), rotation is the real protection.

### B4 — `db:seed:demo` will wipe production, and nothing stops it
`server/src/db/seed-demo.ts:63-70` enumerates `information_schema.tables` and **TRUNCATEs every
base table** in whatever database `server/.env` points at. There is no `IS_PROD` check, no
confirmation prompt, no DB-name allowlist.

The `cross-env NODE_ENV=dev` in the npm script is **cosmetic** — `config/index.ts:4-17` always
loads `server/.env` regardless of `NODE_ENV` (only `test` layers a second file). On a prod box,
one habitual `npm run db:seed:demo` = total data loss.

**Fix:** add a hard refusal when `Config.IS_PROD` (and ideally a DB-name check) before the truncate
loop. Same treatment for `db:setup:fresh` / `--drop`.

### B5 — the client bundle would call `https://<your-domain>:5501`
`client/src/http/client.ts:42-44` falls back to `${protocol}//${hostname}:5501/api/v1` whenever
`VITE_BACKEND_API_URL` is empty — and `client/.env:7` sets it **empty** on purpose (a deliberate
LAN-dev convenience). Vite bakes `.env` into the production build, so **today's `dist/` calls port
5501 on the prod domain** and every API call fails.

Second trap: `client/.env.example:1` hardcodes `http://localhost:5501/api/v1`. Copying the example
before building is worse — mixed-content-blocked on an HTTPS page.

**Fix at build time** (the value is baked in; editing after the build does nothing):
- Same domain: `VITE_BACKEND_API_URL=/api/v1`
- Separate API host: `VITE_BACKEND_API_URL=https://api.<domain>/api/v1`
- Must end in `/api/v1`, **no trailing slash** (a trailing slash produces `//auth/refresh`, which
  won't match the path-scoped `bb_refresh` cookie → users silently logged out on every reload).

Also fix `client/README.md:15`, which documents the URL **without** `/api/v1`.

### B6 — no SPA fallback = deep links and the public form URL 404
`client/src/router.tsx:70` uses `createBrowserRouter`; `client/public/` holds only `icon.svg`.
Nothing in the repo provides a rewrite rule. Without one, **every** refresh on `/reports/12`,
`/s/:id/l/:id`, `/settings/roles` 404s — and critically so does **`/forms/:slug`**, the public
form link your team copies to outsiders (`FormView.tsx:244`).

**Fix:** web-server rule — rewrite every non-file, non-`/api/v1` request to `/index.html`.
Serve at domain **root** (there is no vite `base` / router `basename`; a subpath deploy needs code
changes).

### B7 — the wrong DB provisioning command is one keystroke away
`npm run db:migrate` runs the Drizzle chain, which is **frozen at `0005_form_encryption`** and
predates both dept-review and RBAC. A prod DB provisioned that way silently lacks **6 tables**
(`task_reviews`, `department_reports`, `permissions`, `roles`, `role_permissions`, `user_roles`),
5 columns, and the new notification enum values. The server would still boot (catalog sync is
deliberately non-fatal, `server.ts:35-42`) and then 500 on every RBAC/dept-review query.

Worse: **`PRE_DEPLOYMENT_CHECKLIST.md:109-158`** (dated 2026-07-08) tells the operator the whole DB
migration is "apply 0005". It is the most deployment-shaped doc in the repo and it is wrong.

**The correct fresh-prod path is `npm run db:setup`** — see §6. Rewrite or delete that checklist.

---

## 3. 🟠 HIGH

**Exposure**
1. **`GET /metrics` is public** (`routes/health.ts:106`, mounted at `app.ts:113` — outside the v1
   limiter). Hands anyone your full route table, per-route traffic/latency, and MySQL pool
   saturation. Bind to localhost or block at the proxy.
2. **`GET /health/ready` is public and takes a real DB connection** (`health.ts:71-90`, 500 ms ping)
   against a **hardcoded 10-connection pool**. A trivial unauthenticated flood starves the pool and
   takes the app down. Rate-limit or restrict it.
3. **The global 600/min limiter is keyed on an *unverified* `jwt.decode()` of the Bearer `sub`**
   (`middlewares/rateLimit.ts:71-96`). Forging a random `sub` mints a fresh bucket, so an
   unauthenticated attacker's request *volume* is effectively uncapped. (Requests still 401 — this
   is a DoS-surface problem, not an auth bypass.) The code comment calls it "exactly like rotating
   IPs"; it is meaningfully cheaper than that.
4. **CORS reflects any localhost/RFC-1918 origin with `credentials: true`, in prod too**
   (`app.ts:80-91` — `LAN_ORIGIN` is not gated on `IS_PROD`). On an office LAN this neutralises
   CORS as a layer. Gate it on `!IS_PROD`.
5. **`DISABLE_RATE_LIMIT=1` disables *every* limiter including login** (`rateLimit.ts:23`), with no
   prod guard and no log line. Refuse it when `IS_PROD`.
6. **Dead cookie-auth path**: `middlewares/authenticate.ts:26` still accepts an `accessToken`
   cookie the server never sets. Harmless today (SPA is pure Bearer, so CSRF is genuinely n/a), but
   if anything ever sets that cookie, every body-less mutation becomes CSRF-able — there is no CSRF
   token anywhere. Delete the fallback.
7. **No account lockout anywhere**, and the password policy is length-only (8–200 chars). Login is
   protected solely by the 5/min/IP bucket that items 3 and 5 each weaken. bcrypt cost is 10.

**Operations**
8. **No `unhandledRejection` / `uncaughtException` handler and no supervisor config in the repo**
   (`server.ts:63-64`). Node 20 kills the process on any unhandled rejection and nothing restarts
   it → one stray floating promise is a full outage for 100 people. Add handlers **and** a systemd
   unit / pm2 config with a restart policy.
9. **`NODE_ENV` must be `prod` or `production`.** Under the dev value the 30-day refresh cookie
   ships **without `Secure`** and HSTS is never sent (`AuthController.ts:305-311`,
   `securityHeaders.ts:23-28`). Every run of this system so far has used `NODE_ENV=dev`.
10. **Winston writes `logs/combined.log` + `logs/error.log` with no rotation and no size cap**
    (`config/logger.ts:16-28`), cwd-relative. Every request is logged; at 100 users this fills the
    disk. Add logrotate or a size-capped transport.
11. **All 7 background jobs are external-cron only** — there is no in-process scheduler. Without
    crontab entries, the **weekly HR department report never generates**, sessions never purge,
    pending attachments and expired PII accumulate, and overdue tasks never alert their
    assignees. Cron lines in §6.
12. **`PORT` has no default and no validation** (`config/index.ts:77`, `server.ts:9,48`). Missing →
    `app.listen(undefined)` binds a random port and logs a cheerful "Listening on port undefined".
13. **No boot-time validation of secrets.** Only `ENCRYPTION_KEY` is checked. A `.env` copied from
    `.env.example` boots happily on the publicly-known `change-me-…` JWT secret. (Good news:
    there are **no hardcoded secret fallbacks** anywhere — everything is `undefined` if unset.)
14. **Mail is still Mailtrap, and misconfiguration is silent.** `MailService.ts:34-53` degrades to
    log-only if any `MAIL_*` var is missing — password-reset and invitations return success while
    no mail leaves the box. Also set `FRONTEND_URL`, or reset/invite emails contain unclickable
    relative links (`AuthService.ts:501`).

---

## 4. 🟡 MEDIUM (fix soon after launch)

1. **R2 attachments fail silently if any of the 4 R2 vars is missing** — uploads return fake
   `https://r2.fake/...` URLs and store nothing, with one boot-time `logger.error`
   (`R2Service.ts:58-76`). *(Your dev `.env` has all four set correctly — I checked. This is a
   prod-env risk, not a current bug.)*
2. **Timezone is unpinned and the docs disagree** — `database/README.md:116` says MySQL UTC,
   `GO_LIVE_GATE_REPORT.md:89` says Node `TZ=Asia/Dhaka`. Dev ran MySQL session tz +06.
   `OnCallRepo.ts:72` and `EngineeringRepo.ts:118` use DB-side `CURDATE()`, which `TZ=Asia/Dhaka`
   does **not** reach — under a UTC MySQL, on-call "today" flips at 06:00 Dhaka. Pick one combo and
   pin it in config.
3. **Pool size is hardcoded at 10** (`db/client.ts:18-19`) while `DB_POOL_MAX` /
   `DB_POOL_QUEUE_LIMIT` are read into Config and **never used** — an operator tuning them sees no
   effect. Likely tight for 100 users + jobs.
4. **`trust proxy` is hardcoded to `1`** (`app.ts:50`). Correct behind exactly one proxy. Behind
   Cloudflare→nginx, `req.ip` becomes the edge IP and every per-IP limiter throttles the whole
   company at once.
5. **Invitation tokens land in access logs** — `requestLogger.ts:31` logs `req.originalUrl` and
   `GET /auth/invitation/:token` carries the raw single-use token in the path. (Reset tokens are
   POST-body only — safe.)
6. **Attachment uploads buffer 30 MB in RAM before the 25 MB policy check**
   (`routes/attachments.ts:119`). Align the parser limit with `MAX_ATTACHMENT_BYTES`.
7. **Public form submit has no CAPTCHA and near-zero body validation** (`validators/forms.ts:343` —
   "is a plain object"). An anonymous caller can create tasks + encrypted-PII rows at 30/min/IP.
8. **Assistant history is caller-supplied and unreconciled** (`validators/assistant.ts:24-45`) — up
   to ~80 KB of client text into every prompt at 20/min/user, and a caller can forge
   `role:"assistant"` turns. Cost channel; tool scoping is unaffected (identity comes from the JWT).
9. **Forms/submissions cascade-delete with no retention stop** — deleting a list cascades
   `forms` → `form_submissions`, destroying encrypted PII (`schema.sql:897,956`). Tasks and
   department_reports are `RESTRICT`-protected; forms are not.
10. **`drizzle.config.ts:5-7` loads `.env.dev`, a different file than the runtime `.env`** —
    drizzle-kit may silently target a different database than the app.
11. **`X-Powered-By: Express` is not disabled**; no compression middleware (do gzip at the proxy).
12. **Bundle size:** the client main chunk is **1.45 MB (448 KB gzip)**. Fine to launch on, worth
    `manualChunks` later — `TaskDetailDrawer` alone is 547 KB.

**Dependency audit (`npm audit --omit=dev`):**
- **server — 7 findings.** `drizzle-orm` SQL-injection-via-identifiers (HIGH) is **not exploitable
  here** — the codebase's only `sql.raw()` (`EngineeringRepo.ts:247`) takes a module constant, and
  I verified no string concatenation into queries anywhere. `nodemailer` (HIGH) and the
  `tar`←`bcrypt` chain (CRITICAL) both need `--force` major bumps; the tar one is build-time only.
- **client — 5 findings**, all fixed by a plain `npm audit fix`: `axios`, `react-router`
  (open-redirect + DoS), `form-data`, `dompurify`. **Do this one before launch** — react-router and
  dompurify are on the request path.

---

## 5. ⚠️ THE RBAC REALITY CHECK — read this before go-live

This is not a bug, it is a **design decision that is about to meet a real company**, so it needs a
conscious sign-off rather than a discovery in week two.

Re-verified numbers (2026-07-28): **182 endpoints · 164 JWT-authenticated · 58 route-level
permission gates (~35%) · 12 unauthenticated (all intentional, all enumerated and correct)**.

The RBAC engine shipped and works — but per locked decision **D-8**, the seeded roles reproduce
pre-RBAC behaviour *exactly*, i.e. **dormant until an admin tightens them**. Consequences on day 1:

- **Every employee can read and edit every task in the company** — including HR, Finance and
  Management department tasks. `TasksRepo.ts:118` applies the scope filter correctly, but all
  seeded roles hold `space.view` at scope `all`, and `scope.ts:183` returns `undefined` for `all`
  → the SQL is byte-identical to unfiltered.
- **Guest is not read-only.** `bootstrap.ts:196` gives Guest everything in `EVERYONE`, including
  `task.create/edit/archive/delete` and `comment.create`. The entire Guest restriction surface is:
  no attachment upload, no hard-delete, guest-hidden custom fields redacted.
- **`/tasks` has zero route-level gates** (18 endpoints in `routes/tasks.ts`).
- **`assertCan()` is never called by any service** — RBAC P12–P15 are unbuilt, so the `own` scope
  is not honoured on writes.
- **There is still no UI to assign a role** (`MembersSettings.tsx` hardcodes the 3 legacy roles;
  nothing in the client calls the assignment API — RBAC P24/P27 open). Tightening is done from
  `/settings/roles` + the API by hand.

**Decision needed:** launch open (everyone sees everything — fine if that matches how the company
already works), or spend a session on RBAC P12–P15 + P27 first. There is no wrong answer, but it
should be chosen, not inherited.

---

## 6. ✅ FRESH-PROD PROVISIONING RUNBOOK

### 6.1 Database
1. MySQL **8.0.29+** (dev-tested 8.0.36), default charset `utf8mb4` / `utf8mb4_unicode_ci`.
   Decide the timezone combo now (MEDIUM 2) and pin it.
2. Deploy the repo so **`database/` sits next to `server/`** — `db/setup.ts:22` resolves
   `../../../database/schema.sql`.
3. `cd server && npm run db:setup` → creates the DB and applies `database/schema.sql` in full:
   **42 tables, 9 triggers, 5 views** *(F33 re-verified 2026-08-07 — was 41/7/5 when this scan was
   written; the fixing campaign folded `r2_purge_queue` (F16) and the `trg_comments_after_update` +
   `trg_form_submissions_after_delete` counter triggers (F15) into schema.sql per rule X4).*
   Dept-review and RBAC are already folded in — `database/upgrades/001–013` are **not** needed on a
   fresh DB (they are the upgrade path for already-provisioned ones).
4. `npm run db:seed` → workspace + owner login + starter task types + Engineering/Bug-Triage list +
   RBAC catalog and system roles. **Run exactly once** (it is additive, not idempotent).
5. Set up `mysqldump --single-transaction --quick --routines --triggers` on a schedule.
   *(F33 note, 2026-08-07: this gap is CLOSED — `deploy/backup/bbtasks-backup.sh` + its cron line
   exist, with 14-day retention, a free-disk guard that aborts rather than filling the shared box,
   and a dump-size sanity check.)*

**NEVER run on prod:** `db:migrate` (incomplete — B7) · `db:push` / `db:generate` / `db:drop`
(frozen chain, clobber risk) · `db:seed:demo` and `db:setup:fresh` (**destructive** — B4).

### 6.2 Server env — the checklist
**Required:** `NODE_ENV=prod` · `PORT` · `DB_HOST/PORT/USERNAME/PASSWORD/NAME` ·
**`DB_TIMEZONE=+00:00`** *(F33 addition, 2026-08-07 — F3 made this the canonical clock and prod
REFUSES TO BOOT without it; this list predates F3. On the MySQL 8.4 prod box also set
`DB_SOCKET_PATH` — TCP + caching_sha2 fails there; both are documented in `server/.env.example`.)* ·
`ACCESS_TOKEN_SECRET` · `REFRESH_TOKEN_SECRET` · `COOKIE_SECRET` (three *different* long randoms) ·
`ENCRYPTION_KEY` (**fresh 64-hex, never one from the docs**) · `INTERNAL_JOB_TOKEN` ·
`FRONTEND_URL` (real client origin) · `CORS_ALLOWED_ORIGINS` · `MAIL_HOST/PORT/USERNAME/PASSWORD/
FROM_ADDRESS/FROM_NAME` (real sender, not Mailtrap) · all four `CLOUDFLARE_R2_*` + `ACCOUNT_ID` ·
`OPENAI_API_KEY` · `TZ` (per your MEDIUM-2 decision — settled by F3: the app is session-UTC
regardless, so `TZ` is cosmetic for logs) · `GIT_SHA` (from the pipeline).

**Read but ignored by the code — don't rely on them:** `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`
(TTLs are hardcoded 15m/30d), `DB_POOL_MAX`, `DB_POOL_QUEUE_LIMIT`, `API_URL`,
`CLOUDFLARE_R2_PUBLIC_URL`, `R2_SIGNED_URL_TTL`, `SECRET_KEY`, `CLIENT_URL`, `REDIS_URL`.

**Must NOT be set:** `DISABLE_RATE_LIMIT`.

### 6.3 Web layer
- Serve `client/dist` at domain root with a **rewrite-all-to-`index.html`** fallback (B6).
- Reverse-proxy `/api/v1/*` → Express, **ordered before** the SPA fallback.
- For `/api/v1/assistant/chat`: **proxy buffering OFF, no compression, read timeout ≥ 120 s** (SSE
  streaming — the server already sends `X-Accel-Buffering: no`).
- Raise the body-size limit for `POST /api/v1/tasks/:id/attachments` (raw bytes, up to 30 MB).
- Block `/metrics` and `/health/ready` from the public internet (HIGH 1–2).
- Cache `/assets/*` immutable, `index.html` no-cache.
- If you add a CSP: `client/src/index.css:5` imports **Google Fonts** at runtime — allowlist
  `fonts.googleapis.com` + `fonts.gstatic.com`, or self-host them.

### 6.4 Cron (nothing runs without this)

*(2026-08-08: the canonical file is now `deploy/cron/bbtasks-jobs` — install per its header,
UTC times, all 7 jobs over HTTP via `deploy/cron/run-job.sh`. The sketch below is superseded;
`form-submission-expiry` HAS an HTTP route since F19-era wiring, and `overdue-alert` is new.)*
```
*/5 * * * *   run-job.sh snooze-wake
*/10 * * * *  run-job.sh overdue-alert                # email+in-app the moment a due date passes
10 2 * * *    run-job.sh session-cleanup
20 2 * * *    run-job.sh attachment-janitor
30 2 * * *    run-job.sh r2-purge
40 2 * * *    run-job.sh form-submission-expiry
0 3 * * 1     run-job.sh department-report            # Monday 09:00 Asia/Dhaka
```
All HTTP calls need `-H "X-Internal-Token: $INTERNAL_JOB_TOKEN"`. Dry-run any job first with
`npm run job <slug> -- --dry-run`. No MySQL `event_scheduler` is needed — there are no DB events.

---

## 7. ✅ VERIFIED PRODUCTION-SAFE (don't re-audit)

- **No hardcoded secret fallbacks anywhere** — every secret is `undefined` if unset.
- **Auth**: HS256 pinned · 15 m access / 30 d refresh on **different** secrets · refresh tokens
  stored as sha256, rotated on use, replay revokes all sessions · refresh cookie `httpOnly` +
  `secure` + `SameSite=strict` + path-scoped.
- **Error handler leaks nothing** — unknown errors return a flat envelope, stacks stay in logs.
- **Workspace isolation holds** — 5/5 diverse spot-checks (tasks, comments, attachments, activity,
  reports) filter on the JWT's workspace, never the body.
- **No SQL injection surface** — everything is Drizzle-parameterised, the single `sql.raw()` takes a
  constant, LIKE patterns are escaped, no `child_process` anywhere.
- **Uploads are structurally safe** — storage keys are server-built (never the client filename), so
  traversal is impossible; MIME allowlist + 25 MB cap; size re-verified against R2's `HEAD`;
  downloads via 5-minute signed URLs; client-supplied thumbnail keys confined to the caller's prefix.
- **Assistant** — identity injected from the JWT (the model cannot reach another user/workspace),
  all tools read-only, clean 503 without an API key, stream abort wired, 800-token cap + 20/min.
- **XSS** — DOMPurify on task descriptions, escaped search highlighting, react-markdown with no
  `rehype-raw`. Client access token is memory-only, never persisted.
- **Pagination cannot dump a table** — every list service clamps server-side (50–200).
- **User enumeration closed** — forgot-password always 202, dummy bcrypt compare on the not-found
  branch.
- **Security headers on every response**, including error paths; 1 MB JSON limit.
- **`/jobs/*` fails closed** with a constant-time token compare.
- **Charset**: all 41 tables `utf8mb4`/`utf8mb4_unicode_ci` — Bangla is safe.
- **Mock API is fully dead code**, excluded from typecheck and absent from the bundle.

---

## 8. SUGGESTED ORDER

1. **B1 + B2** — make `npm start` actually start (30 min, and everything else depends on it).
2. **B3** — rotate the key, strip the two docs (secrets first, always).
3. **B4** — guard the destructive seed before the prod DB exists.
4. **B5 + B6** — rebuild the client with the real API URL, configure the SPA fallback.
5. **HIGH 1–2, 8–9, 11** — close `/metrics` + `/health/ready`, add crash handlers + a supervisor,
   set `NODE_ENV=prod`, wire cron.
6. `npm audit fix` on the client.
7. **Decide the RBAC posture (§5)** — launch open, or tighten first.
8. Everything else can follow the first week.

*Compiled 2026-07-28 from four parallel read-only source scans plus builds, typechecks and test runs
executed on this machine. Every blocker independently re-verified against the code.*
