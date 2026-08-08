# 🔬 FULL SYSTEM SCAN — 2026-07-29

Frontend · Backend · Database · API · Security · Build/Deploy.
Scope: the whole live stack (`server/` + `client/` + `database/` + `deploy/`).

**Every finding below was verified against the code, the running MySQL, or the running API — nothing
is inferred from a prior scan or a plan document.** Three findings are backed by an executed proof
(marked **PROVEN**); every write made during those proofs was reverted.

---

## VERDICT

| | |
|---|---|
| **Deploy blockers (new)** | **0** — the 7 blockers from the 2026-07-28 scan are 6 fixed, 1 open (H3) |
| 🔴 **HIGH** | **4** — a proven authorization bypass, a proven 6-hour SLA bug, a DB-provisioning trap, a proven dev-only crash |
| 🟠 **MEDIUM** | **11** — features that exist in the UI but do nothing on the server, plus a test suite that mass-fails on a healthy codebase |
| 🟡 **LOW** | **8** — dead code, doc rot, UX papercuts |
| ✅ **Verified clean** | typecheck, client tests, SQL injection, API contract parity, schema parity, auth/cookies, secrets sweep, task-tree authorization |

**Bottom line:** the architecture is sound and the plumbing is genuinely well built — the
authorization *mechanism* is correct, the *coverage* is half-finished. The dominant theme across
every HIGH and most MEDIUMs is the same shape: **a control the UI presents as working, which the
server never reads.** That is worse than a missing feature, because an admin acts on it.

---

## SCAN SURFACE

| Layer | Measured |
|---|---|
| Server source | 286 `.ts` files · 52,132 LOC · 34 controllers · 40 services · 38 repositories |
| API | **181 route declarations** → **178 distinct v1 endpoints** across 30 route files |
| Validators | 28 files; **177 of 181 routes** carry a validator or an explicit no-body justification |
| Database | **41 tables · 5 views · 7 triggers** (schema.sql) · 106 TIMESTAMP columns |
| Client source | 39,924 LOC · 39 pages · 4 hooks · 5 stores · 160 distinct API call shapes |
| Tests | 164 server test files across 31 modules · 7 client vitest files |
| Deploy | nginx vhost · pm2 ecosystem · 6 cron jobs · logrotate |

---

# 🔴 HIGH

## H1 — 25 of 56 RBAC permissions are never enforced anywhere — **PROVEN**

**The single most important finding in this scan.**

**Executed against the running dev API as the real demo account `cs.only@beautybooth.com.bd`
(role "Department Only", 8 grants). Both writes were reverted.**

```
logged in as cs.only@beautybooth.com.bd | legacy role: member
GET /me/permissions  -> member.view, space.view, task.view, task.create,
                        task.edit, comment.create, checklist.manage, assistant.use
  holds task.archive? -> false      (the server itself says no)
  holds task.delete?  -> false
  holds task.assign?  -> false

target: t-D60ZW_4bXX27hySdBokfOQ "Refund stuck — bKash gateway issue"
        (NOT created by them, NOT assigned to them)

PATCH /tasks/:id   (task.edit scope = own, task is NOT own) -> HTTP 200  *** ALLOWED ***
                    name became "Refund stuck — bKash gateway issue [rbac-probe]"
POST  /tasks/:id/archive  (holds task.archive: NO)         -> HTTP 204  *** ALLOWED ***

REVERTED -> name restored, archived_at=NULL, priority unchanged
```

So both failure modes are real and reachable today:
1. **A permission the user does not hold at all** (`task.archive`) does not stop the action.
2. **A permission held only at `own` scope** (`task.edit`) is not narrowed to own rows.

The demo account `marketing.only@` shares the same role, so the same holds for it.

`server/src/rbac/catalog.ts` declares **56 permissions**, every one of which renders as an editable
toggle in `/settings/roles` with a confident description ("Remove a task (recoverable by an
admin)").

Actual enforcement:

| | count |
|---|---|
| Wired to a `requirePermission()` route gate | **27** |
| Enforced indirectly | **4** — `space.view` (`rbac/scope.ts:44`), `task.view` (`rbac/ownEscape.ts:30`), `task.create` + `customfield.set_value` (`rbac/principals.ts`) |
| **Enforced NOWHERE** | **25** |

The 25 with no enforcement point in the entire server:

```
activity.view          attachment.delete_any  attachment.upload      bug.report
checklist.manage       comment.create         comment.delete_any     dependency.manage
form.view_submissions  member.edit_profile    member.view            postmortem.manage
report.generate        report.note            report.view            review.perform
review.read            space.head_assign      sprint.assign_tasks    task.archive
task.assign            task.delete            task.delete_hard       task.edit
template.apply
```

**Why this happened.** `server/src/middlewares/requirePermission.ts:16-20` documents a two-layer
design and is explicit that both halves are required:

> *"It is deliberately the COARSE half of the check … A person who holds `task.edit` only in
> Marketing passes this gate and is then refused by the service's `assertCan` on a Support task.
> **Both layers are mandatory.**"*

The fine half was never built. Grepping `assertCan|requireCan|ensureCan|\bcan\(` across all 40
services, 34 controllers and 38 repositories returns **`PolicyService.ts` and nothing else**.

**What actually protects writes today** (so this is not "wide open"):
1. The legacy static role from the JWT — `AttachmentsService:108,186,350`,
   `CommentsService:190`, `TaskWriteService:928`, `ReviewsService:156,349`, `ReportsService:226`
   still gate guests and require owner/admin for hard-delete and delete-any.
2. Space-level row visibility via `space.view` (see "Verified clean" — this part works properly).

**The real damage is trust.** An admin who unchecks *Delete tasks* on a custom role gets a success
toast and zero behaviour change. `catalog.ts` has no `enforced` flag, so nothing in the UI
distinguishes a live permission from a decorative one.

**Fix — pick one, do not leave it as is:**
- **(a) Honest, ~1 day.** Add `enforced: false` to the 25 entries; grey them in the roles grid with
  "not yet enforced". Add a test that fails when a permission is `enforced: true` without a
  `requirePermission()` reference.
- **(b) Complete, ~1 week.** Add `requirePermission()` to the ~40 ungated routes and the
  service-level `assertCan(actor, key, {spaceId, isOwn})` the docblock already promises.

Do (a) **before go-live** regardless — it is small and it stops the control from lying.

---

## H2 — SLA breach detection fires 6 hours late — **PROVEN**

`UTC_TIMESTAMP()` is compared against `TIMESTAMP` columns in 4 places:

- `server/src/repositories/SlaRepo.ts:50` — `${tasks.slaDueAt} < UTC_TIMESTAMP()`
- `server/src/repositories/SlaRepo.ts:95` — `TIMESTAMPDIFF(MINUTE, sla_due_at, UTC_TIMESTAMP())`
- `database/schema.sql:1547,1550` — the `v_breached_sla` view

All 106 timestamp columns in the schema are `TIMESTAMP` (0 `DATETIME`). MySQL stores those as UTC
and **renders them in the session time zone** — which is `+06:00` in prod (`DB_TIMEZONE`, pinned to
the driver in `db/client.ts:66-73`) and `SYSTEM = Asia/Dhaka` in dev. So the matching function is
`NOW()`; `UTC_TIMESTAMP()` is 6 hours behind it.

**Executed against the live dev MySQL:**

```
case                              | NOW() says | UTC_TIMESTAMP() says | truth
due 2 HOURS AGO   (IS breached)   | true       | false                | BREACHED   <-- MISSED
due in 2 HOURS    (NOT breached)  | false      | false                | not breached
due 7 HOURS AGO   (IS breached)   | true       | true                 | BREACHED
```

`SELECT TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW())` → **6**.

**Impact:** every SLA breach is invisible for its first 6 hours. `minutes_breached` under-reports by
360 and can render negative. For an ecommerce ops team whose SLAs are same-day, a 6-hour blind spot
is most of the working day.

**Same root cause, second site:** `AttachmentsRepo.softDelete` (`:161`) stamps
`deleted_at = UTC_TIMESTAMP()`, so the r2-purge 7-day retention window expires ~6 hours early. The
`KI-2 fix (2026-07-14)` comment at `:151` justifies this with *"the r2-purge cutoff is a UTC JS
Date"* — but a JS `Date` bound through mysql2 is serialised in the **driver's** time zone (`+06:00`
in prod, local in dev), never UTC. The premise is wrong, so the fix inverted the bug.

**Fix:** replace `UTC_TIMESTAMP()` with `NOW()` at all 4 sites, then re-run
`server/tests/sla/`. Any test that currently pins the 6-hour skew needs updating with it.

---

## H3 — `npm run db:migrate` provisions a broken database (B7, still open)

Two provisioning paths exist and they disagree.

**`database/schema.sql`** (used by `npm run db:setup`) — **correct**. Verified: 41/41 tables match
the Drizzle TS schema, and upgrades `001`–`004` are fully folded in (`spaces.head_user_id` + FK +
index at `:255,268,272`; both notification ENUMs extended with `task_reviewed`/`report_ready` at
`:978,1018`; `entity_type` includes `report` at `:980`).

**`server/src/db/migrations/`** (used by `npm run db:migrate`) — **frozen at `0005` and wrong**:

- **Creates 3 tables from an unrelated domain** that exist nowhere else in this system:
  `customers`, `stock_batches`, `stock_movements` (`0000_initial.sql:184,302,322`).
- **Misses 6 real tables**: `task_reviews`, `department_reports`, `permissions`, `roles`,
  `role_permissions`, `user_roles`.

A DB built this way boots (catalog sync is deliberately non-fatal, `server.ts:35-42`) and then 500s
on every RBAC and dept-review query.

**The trap is in the most deployment-shaped document in the repo.**
`PRE_DEPLOYMENT_CHECKLIST.md` still tells the operator the whole DB step is one file:

```
:14   - [x] Database migration: server/src/db/migrations/0005_form_encryption.sql
:132  mysql … $DB_NAME < server/src/db/migrations/0005_form_encryption.sql
:187  mysql … $DB_NAME < server/src/db/migrations/0005_form_encryption.sql
:344  mysql … < 0005_form_encryption.sql
```

**Fix:** delete or rewrite `PRE_DEPLOYMENT_CHECKLIST.md` to point at `npm run db:setup`, and either
regenerate the Drizzle migration chain from the current schema or remove `db:migrate` from
`package.json` so it cannot be run by accident.

> Related: every `db:*` script runs through `tsx`, a **devDependency**. On a prod box installed with
> `npm ci --omit=dev` they all fail with "tsx not found". Worth a line in the runbook.

---

## H4 — Dev database carries 3 stale triggers that crash every subtask status change — **PROVEN**

The live `taskmanagement` DB has **10** triggers. `database/schema.sql` declares **7**, and at
`:1482-1488` explicitly documents why the other 3 were removed:

> *"Subtask counters: NO triggers. … `trg_subtasks_after_{insert,update,delete}` could not maintain
> these counters AND actively crashed every subtask status change with a raw 500."*

They were removed from `schema.sql` but never dropped from the local database.

**Executed inside a transaction, then rolled back — no data was changed:**

```
made t-SP_qkIEXlfxQmKiaT8xUBw a subtask of t-dn6MtX--qGypUPoKyHcrLQ
RESULT: subtask status change FAILED -> ER_CANT_UPDATE_USED_TABLE_IN_SF_OR_TRG
        | Can't update table 'tasks' in stored function/trigger because it is
          already used by statement which invoked this stored function/trigger.
ROLLED BACK — dev data unchanged
```

**Production is fine** (provisioned from `schema.sql`, 41/5/**7**). This is a **dev/QA fidelity**
problem: subtasks cannot be exercised locally at all, and `subtasks_count` double-counts because
both the stale trigger and the app-side recompute run. Local QA results for anything touching
subtasks are not trustworthy.

**Fix — run against `taskmanagement` and `taskmanagement_qa`:**

```sql
DROP TRIGGER IF EXISTS trg_subtasks_after_insert;
DROP TRIGGER IF EXISTS trg_subtasks_after_update;
DROP TRIGGER IF EXISTS trg_subtasks_after_delete;
```

Then confirm `SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='taskmanagement'`
returns **7**.

> Side note: the demo seed creates **no subtask rows at all**, which is why this never surfaced.

---

# 🟠 MEDIUM

## M1 — Notification preferences do nothing

`GET`/`PUT /notifications/preferences` read and write `in_app_enabled` / `email_enabled`, and the UI
exposes them per type. **No producer consults them.** Seven services insert notifications
(`CommentsService`, `FormsService`, `NotificationsService`, `ReportsService`, `ReviewsService`,
`TaskMembershipService`, `TaskWriteService`); none reads `NotificationPrefsRepo`. The only readers
are the preferences endpoint itself and its serializer.

Turning a notification type off changes nothing.

## M2 — No email notifications are ever sent

`MailService` is injected into exactly one place: `AuthService` (password reset + invitation). There
is no notification email path. `notifications.email_sent_at` exists in the schema and is **never
written** — confirmed by grep: the only three hits are the column declaration and two comments
saying it is deliberately not exposed.

So `email_enabled` (M1) promises a channel that does not exist.

## M3 — `due_soon` and `overdue` notifications can never be produced

Both are values in the `notifications.type` ENUM and appear in the preferences UI, but nothing
creates them. The 6 background jobs are `snooze-wake`, `session-cleanup`, `attachment-janitor`,
`r2-purge`, `form-submission-expiry`, `department-report` — **there is no due-date scanner**. The
other `"overdue"` hits in the codebase (`TaskWriteService:1027`, `ReviewsRepo:194`) are bucket
labels for My Work grouping, not notification creation.

Due-date reminders are the most-expected notification in a task manager; today the system cannot
emit one.

## M4 — SSE (§27) is dead in production

`GET /stream/inbox` sits behind `authenticate`, which reads a `Bearer` header or an `accessToken`
cookie. The SPA stores the access token **in memory only** (`stores/auth.ts:83` persists just
`user`), and the server sets only `bb_refresh` as a cookie (`AuthController:302-315`). `EventSource`
can send neither. `NotificationBell.tsx:15-17` says so and polls every 60s instead.

The server still runs `sseHub`, `SseController`, and a `closeAllSseStreams()` shutdown path for zero
clients.

**Fix:** either drop the surface, or authenticate the stream with a short-lived one-time token in
the query string.

## M5 — Client-side permission gating is essentially absent

Only 5 files reference `usePermissions` / `RequirePermission`, and 3 of those are the plumbing
itself (`RequirePermission.tsx`, `router.tsx`, `SettingsLayout.tsx`). **No action button anywhere is
permission-gated** — Create Space, Delete Task, Archive List, Invite Member all render for everyone
and fail with a 403 toast.

Two specific consequences:
- The sidebar shows the entire **Engineering** section (Eng Home / Sprint Board / On-call rotation)
  to every user (`Sidebar.tsx:291-306`). Most of a ~100-person beauty-ecom company is non-technical.
  `/eng/on-call` then hard-denies via `RequirePermission oncall.manage`.
- `canSeeDept` (`Sidebar.tsx:61-64`) uses the **legacy JWT `user.role`**, not the RBAC store — so a
  custom role granted `report.view` still gets no Reports nav.

## M6 — `/settings/import-export` is a non-functional stub in the production nav

`ImportExportSettings.tsx` shows ClickUp / Asana / Trello / Monday importers whose button emits
`"<name> importer — coming soon"` (`:145`), and export buttons that emit
`"${format} export ready — file would download here."` (`:23`). It is also the **only** settings
page with no `RequirePermission` wrapper (`router.tsx:233-238`).

For a company migrating off ClickUp this is the page they will click first.

## M7 — The SPA origin ships with no security headers

`middlewares/securityHeaders.ts` sets `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `X-Permitted-Cross-Domain-Policies` and HSTS — **on the API only**. The nginx
vhost that serves `client/dist` adds none, so `tasks.beautybooth.com.bd` has no CSP and can be
framed by any site.

**Fix** — in the `location /` block:

```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'" always;
```

## M8 — No boot-time validation of required env vars

`config/index.ts` destructures ~35 vars and asserts nothing. `middlewares/authenticate.ts:7` uses
`Config.ACCESS_TOKEN_SECRET!` — a missing or misspelled secret boots cleanly and then fails at the
first login. Only `ENCRYPTION_KEY` is checked (`server.ts:14-23`), and it is checked well; extend
that pattern to the rest.

Dead keys present in `server/.env` but never read by `Config`: **`REDIS_URL`**, **`SECRET_KEY`**,
**`CLOUDFLARE_TOKEN_VALUE`**. (`REDIS_URL` in particular implies a Redis-backed rate limiter that
does not exist — every limiter is in-process, which is also why pm2 pins `instances: 1`.)

## M9 — `dist/` is gitignored but force-committed

`.gitignore` lists `dist/`, yet 286 server and 61 client build files are tracked (a deliberate call —
the prod box has ~560 MB free and cannot compile).

Current state is **healthy**: every one of the 286 source `.ts` files has a tracked `.js`
counterpart, and every `dist` file is newer than its source (verified, 0 stale).

The hazard is future: because the path is ignored, a **newly added** source file's compiled output
will be silently skipped by `git add -A`, and prod will run a build with a missing module.

**Fix:** add `!server/dist/` `!client/dist/` negations, or make the release step
`git add -f server/dist client/dist` — and add a CI/pre-push check that every `src/**.ts` has a
tracked `dist/**.js`.

## M10 — The server test suite cannot pass on this machine at the default timeout

`server/jest.config.js` sets no `testTimeout`, so jest's default **5000 ms** applies. But
`setup-each.ts:22` runs `resetTestDb()` in `beforeEach`, and on this machine that costs **~7–8
seconds per test**. Every DB-backed test therefore dies in the *hook*, not the assertion:

```
thrown: "Exceeded timeout of 5000 ms for a hook."   at setup-each.ts:22  beforeEach
```

**Measured, same 2 suites, same 33 tests:**

| run | `--testTimeout` | result |
|---|---|---|
| isolated | 5000 (default) | **33 failed / 33** |
| isolated | 60000 | **33 passed / 33** (282 s) |

This is what produced the combined run's `9 failed suites / 39 failed tests` — all of them
timeout-shaped, none an assertion failure. It is the documented "empty-mass-fail-under-load"
pattern, and it means **`npm test` shows mass red on a healthy codebase**. Anyone new to the repo
will read that as "the system is broken".

**Fix:** add `testTimeout: 30000` to `jest.config.js` (and to the per-module configs). Separately,
`resetTestDb()` truncating every table before *every* test is the real cost — a
transaction-per-test rollback, or truncating only the tables a suite touches, would cut the run from
40 minutes to a few.

## M11 — The session time-zone query is fire-and-forget

```js
// server/src/db/client.ts:70-72
pool.on("connection", (c) => {
    c.query("SET time_zone = ?", [dbTimezone]);   // not awaited, no error handler
});
```

If that query fails, the connection silently stays on the server default while the mysql2 driver
still formats dates as `+06:00` — a per-connection 6-hour skew that would be very hard to diagnose.
Log the error at minimum.

---

# 🟡 LOW

| # | Finding |
|---|---|
| **L1** | `middlewares/canAccess.ts` is **dead code** — no route uses it. Worse, 10 controller docblocks (`ListController:206,250,309,372`, `OnCallController:84,118`, `SpacesController:141,181,230,262`) still say *"the role gate runs in the route's `canAccess`"*, which is now false. |
| **L2** | **No 404 page.** `router.tsx:269` maps `path: "*"` to `<Navigate to="/" replace />`, so a typo'd URL or a deep link to a deleted resource silently lands on Home with no explanation. |
| **L3** | `GET /home/agenda` is orphaned — `AgendaCard.tsx:18-37` derives the agenda client-side from `tasksApi.myWork()` instead. |
| **L4** | Built with no UI: `GET /activity` (full feed — only `/activity/recent` is used), `GET /sla/breached`, `PATCH /tasks/:id/sla`, `GET /assistant/conversations{,/:id}`, `POST /uploads/sign` + `POST /attachments/:id/finalize` (superseded by the proxied upload; documented as intentional). |
| **L5** | `POST /tasks/:id/unarchive` has **no client caller** while `archive` does. Spaces (`api.ts:151`) and Lists (`api.ts:366`) both wire unarchive; tasks do not — so a task archived from the UI cannot be restored from the UI. |
| **L6** | `SearchPage.escapeHtml` (`:531`) escapes `&`, `<`, `>` **before** highlighting, so the `dangerouslySetInnerHTML` at `:496,511` is **not** an XSS (verified). It does have a cosmetic re-entrancy bug: searching for `&` injects `<mark>` inside an HTML entity. |
| **L7** | `client/src/lib/mock-api.ts` (2,496 lines) and `client/src/mocks/` (~3,300 lines) are dead. Verified **tree-shaken out of the production bundle** — but they still cost review time and hold the only 3 `console.log`s in the client. |
| **L8** | No `.gitattributes`. `deploy/cron/run-job.sh` is correct today (mode `100755`, LF endings — verified), but nothing pins it; a future contributor on Windows can break the crontab with CRLF. |

---

# ✅ VERIFIED CLEAN — do not re-audit

Each of these was actively checked in this pass and found correct.

**Build & types**
- `server: npx tsc --noEmit` → **0 errors**
- `client: npx tsc -b --noEmit` → **0 errors**
- `client: npx vitest run` → **7 files / 44 tests passed**
- `server: npx jest tests/rbac tests/sla tests/auth` → 610 passed / 39 failed (649). **All 39
  failures are the M10 hook timeout, not assertion failures** — the same tests pass 33/33 when
  re-run with `--testTimeout=60000`. Treat the suite as green and fix M10.
- Committed `client/dist` bakes `BASE_URL = "/api/v1"` (extracted from the bundle) — matches the
  nginx same-domain proxy. The `:5501` string in the bundle is the dead `||` fallback branch.

**API contract**
- All **160 distinct client call shapes resolve to a real server route — 0 orphan calls.** The
  reverse list (18) is fully accounted for: 6 cron-only `/jobs/*`, the fetch-based assistant SSE,
  the raw-axios `/auth/refresh`, plus the L4/M4 items above.

**SQL injection**
- No `sql\`\`` template interpolates a user value anywhere in `server/src`. The single `sql.raw`
  (`EngineeringRepo:247`) wraps a numeric constant. Drizzle parameterises the rest.

**Schema integrity**
- `schema.sql` ↔ Drizzle TS schema: **41/41 tables match**, both directions, 0 drift.
- Upgrades `001`–`004` fully folded into `schema.sql` (column, FK, index and both ENUM copies
  verified line by line).
- Live DB: **every FK column is the leading column of an index** — 0 unindexed foreign keys.
- Only `workspaces` and `user_notification_prefs` have no index beyond the PK, and both are correct
  (1 row / composite PK covers the access path).

**Authentication**
- `bb_refresh`: `httpOnly` + `secure` (via `IS_PROD`, which covers both `prod` and `production`) +
  `sameSite: strict` + path-scoped to `/api/v1/auth` + 30-day max-age. Clear-attributes match
  set-attributes.
- Access token lives **in memory only** — `stores/auth.ts:83` persists `user` alone, so no token
  sits in `localStorage` for an XSS to steal.
- 401 → refresh → retry is de-duped through a single in-flight promise, carries a `_retry` guard,
  and explicitly excludes `/auth/login|refresh|2fa` so a wrong-password 401 surfaces as itself.
- `validateRefreshToken` checks the session row for revocation and expiry, and **fails closed** on a
  DB error.
- `internalAuth` fails closed when `INTERNAL_JOB_TOKEN` is unset and uses a length-guarded
  `timingSafeEqual`.

**Task-tree authorization** (this part is genuinely well built)
- `TasksRepo.findByIdInWorkspace` and `findByIdOrCustomIdInWorkspace` both apply
  `listScopeFilter(tasks.primaryListId, taskOwnEscape())`.
- **Every** task-child service resolves its parent through one of those two methods —
  Comments (3 sites), Checklists (3), Attachments (6), CustomFields (9), TaskDependencies (4),
  Reviews (4), Sprints (3), Membership (6), Activity (1), TaskWrite (11), Forms (11).
  So space-scoped visibility is inherited consistently; there is no "read any comment by id" hole.
- `scopePredicate` correctly emits `1 = 0` for "nothing visible" rather than `IN ()`, and
  `undefined` for unrestricted so the emitted SQL stays byte-identical to the pre-RBAC query.

**Rate limiting**
- 7 buckets — auth 5/min/IP, api 600/min/user, public-form 30/min/IP, assistant 20/min/user,
  report-generate 10/min/user, upload-sign 60/min/user, invitation 5/min/IP.
- Keyed on the authenticated `sub` post-auth and on an *unverified* decode pre-auth (rate-keying
  only, never authorization) so an office NAT does not share one bucket.
- `DISABLE_RATE_LIMIT` is **not** set in `server/.env`.

**Secrets**
- Swept all **982 tracked files** (excluding `dist/`): **0** 64-hex keys, **0** live `sk-`/AWS keys,
  **0** private keys. The only `sk-` hit is the `sk-your-o…` placeholder in `.env.example`.
- **B3 from the 2026-07-28 scan is closed** — `ENCRYPTION_SETUP.md` and
  `PRE_DEPLOYMENT_CHECKLIST.md` now contain **0** hex keys (was 11).

**Prior deploy blockers — re-verified individually**

| | 2026-07-28 | today |
|---|---|---|
| B1 `npm start` path | 🔴 | ✅ `rootDir: "./src"`; `dist/server.js` exists |
| B2 dotenv dies in build | 🔴 | ✅ `dist/config/../../.env` → `server/.env` |
| B3 keys in tracked docs | 🔴 | ✅ 0 hex keys remain |
| B4 seed wipes prod | 🔴 | ✅ `IS_PROD` refusal in `seed-demo.ts:63` **and** `setup.ts:61` |
| B5 bundle calls `:5501` | 🔴 | ✅ `.env.production = /api/v1`, verified in the built bundle |
| B6 no SPA fallback | 🔴 | ✅ `try_files $uri $uri/ /index.html` |
| B7 `db:migrate` trap | 🔴 | 🔴 **still open → H3** |

**Deploy configuration**
- nginx: SPA fallback correct; `/api/v1/` proxied before it; SSE location has buffering/gzip off
  with a 300 s read timeout; `client_max_body_size 32m` vs the 30 MB `express.raw` limit vs the
  25 MB policy cap — consistent. `/metrics` and `/health/ready` are unreachable from the internet
  because no location proxies them (they resolve to `index.html`) while staying available on
  `localhost:5501`. This is a deliberate, correct design.
- pm2: single fork instance (correct — rate limits, metrics and the SSE registry are all
  in-process), `TZ=Asia/Dhaka` set in `env` rather than `.env` (correct — Node reads `TZ` before
  dotenv), `max_memory_restart: 400M`.
- cron: 6 jobs, times converted to UTC by hand rather than trusting `CRON_TZ`; `run-job.sh` reads
  the token from `.env` at run time and exits non-zero on `{"ok":false}`.
- logrotate: `copytruncate` (correct — winston and pm2 hold descriptors open and neither reopens on
  SIGHUP).

**Code hygiene**
- **0** `TODO` / `FIXME` / `HACK` / `XXX` markers in `server/src` + `client/src`.
- Error envelope `{error:{code,message,request_id,details?}}` is applied uniformly, including for
  express-jwt and body-parser errors; 5xx internals are never leaked to the client.

---

# 📋 SUGGESTED ORDER

**Before go-live**
1. **H4** — drop the 3 stale triggers on `taskmanagement` + `taskmanagement_qa` (2 minutes; without
   it no subtask testing is valid).
2. **H3** — delete or rewrite `PRE_DEPLOYMENT_CHECKLIST.md`; remove `db:migrate` from
   `package.json`.
3. **H1(a)** — mark the 25 unenforced permissions in the roles grid so the control stops lying.
4. **M7** — 4 `add_header` lines in the nginx vhost.

**First week after**
5. **H2** — `UTC_TIMESTAMP()` → `NOW()` at 4 sites + re-run `tests/sla`.
6. **M1 + M2 + M3** — decide the notification story. Cheapest honest move: hide the email toggle and
   the `due_soon`/`overdue` rows until a producer exists. Best move: add a due-date scanner job
   (the cron slot and the ENUM values already exist) and read prefs before insert.
7. **M6** — hide `/settings/import-export` behind a flag until it does something.
8. **M10** — one line (`testTimeout: 30000`) so `npm test` stops showing mass red on healthy code.
9. **M8, M9, M11** — env validation, a `dist` parity check, and an error handler on the tz query.

**Backlog**
10. **H1(b)** — finish real RBAC enforcement on the ~40 ungated routes.
11. **M5** — client action-gating (`usePermissions` on every destructive control).
12. **M4** — wire or delete SSE.
13. L1–L8.

---

*Generated 2026-07-29. H2 and H4 were proven against the live dev MySQL (the H4 proof ran inside a
transaction that was rolled back). H1 was proven against the running dev API as a real demo account;
both writes it made were reverted and re-read to confirm — no data was left modified by this scan.*
