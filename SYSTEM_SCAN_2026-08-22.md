# FULL SYSTEM SCAN — 2026-08-22 @ `c357ccf`

Scope: frontend, backend, database, API, security, performance, tests, deploy/ops.
Method: static analysis of 319 server + 223 client source files, live introspection of the dev
database (47 tables), **160 live role × endpoint API calls** against a booted server (4 roles ×
40 endpoints), and read-only probes of the production host.

Supersedes `SYSTEM_SCAN_2026-08-18.md`. Everything below was verified in this run; where a prior
scan's claim changed, it is called out explicitly.

---

## 0) Headline

The engine is in very good shape and got better since 08-18. **Zero 5xx across every endpoint
tried at every role**, zero data-integrity defects in the live database, sub-25ms p90 on every
read, and the permission model held under direct attack from four different accounts.

What is left is not broken code. It is **seven finished features with no way in from the UI**,
**one leaked number**, **one privacy hole that grows every day**, and **a deploy canary that
cannot fail** — plus the standing process gap that no single command proves the system green.

**Correction to the 08-18 scan:** its 🔴 BLOCKER ("prod DB at 022, HEAD needs 023+024, every task
read 500s") is almost certainly **already resolved** — production serves the exact client bundle
built by `89cafdb` and restarted ~2 days ago, i.e. after the insights work shipped. Verify with
the single query in §6 rather than assuming.

---

## 1) Verified healthy — do not re-audit

| Area | Evidence from this run |
|---|---|
| API surface | 209 endpoints across 35 route files; **0 unintentionally unauthenticated** — the 11 public ones are login/refresh/forgot/reset/invitation/public-form/health, all deliberate |
| Live behaviour | 40 endpoints × 4 roles = **160 calls, zero 5xx, zero timeouts** |
| Permission model | An outsider hitting another department's space/list/task gets **404, never 403** (anti-enumeration intact). Own-scope **writes are enforced**: a member PATCHing a teammate's task got `403 task.forbidden` |
| Database | 47 tables / 5 views / 9 triggers / 107 FKs. **Zero orphans** (7 checks), **zero counter drift** (6 counters incl. checklist, comments, attachments, submissions), **zero state contradictions** (completed_at vs status group, both directions) |
| Performance | p90: `/home/kpis` 21ms, `/eng/home` 20ms, `/users` 12ms, everything else under 10ms |
| Indexes | Every hot path covered (`idx_task_assignees_user`, `idx_tasks_list_active`, `idx_notifications_user_state`); only 2 redundant index pairs in the entire schema |
| Auth hardening | httpOnly + secure + `sameSite=strict` cookies; 5/min/IP on login and forgot-password; 15m access / 30d refresh; reset tokens hashed with a TTL |
| Code hygiene | **0 TODO/FIXME/HACK, 0 empty catch blocks, 0 stray console.log** in server src |
| Build output | No source maps shipped; `/metrics` is `deny all` in nginx; the dead `mock-api` is imported nowhere |
| Tests | 198 server test files across 31 directories — **every directory is claimed by a jest config**, no invisible suites |
| Jobs | 10 job modules, 9 routed and cronned, all behind `internalAuth`; backup + logrotate configs present in `deploy/` |

---

## 2) 🔴 Fix first

### F1 — The deploy canary cannot fail (it 404s by design)

`DEPLOY_PROMPT_2026-08-19.md` step 4 says `curl /api/v1/tasks` and treats **401 as healthy, 500 as
"upgrades did not apply"**. There is **no `GET /api/v1/tasks` collection route** — it returns 404
locally and 404 in production, healthy or not. Had 023/024 been missing, this check would still
print 404 and read as "fine" while every real task read 500s.

Replace it with checks that touch the new schema:

- `/api/v1/auth/me` must return **401** — proves the API is mounted
- then log in and read one list: `GET /lists/<id>/tasks` — that is the query that reads 024's columns

### F2 — Chat history is kept forever, in plaintext, with no way to delete it

`chat_messages` + `chat_conversations` have **no retention job, no DELETE endpoint, no UI**. Dev
alone holds **4,393 messages / 2,197 conversations / 848 KB accumulated in 10 days**. Now that the
assistant answers *"who is working on what"*, this table is a permanent record of **who asked what
about whom** — an HR-sensitive log nobody agreed to keep.

Fix: a `chat-retention` job on the existing cron pattern (90 days matches `form-submission-expiry`),
plus a "clear my history" action in the widget.

### F3 — `/eng/home` leaks Engineering's bug count to everyone (verified live)

`EngineeringRepo.openCountAndTopByType` is the one task query in that repo with **no
`listScopeFilter`**. Proved live:

| Asker | `open_bugs.count` | previews returned |
|---|---|---|
| owner | 2 | 2 |
| Customer Service member (arif) | **2** | 0 |
| Marketing head (nusrat) | **2** | 0 |

The previews are correctly filtered (the hydrator applies the scope filter), so the count and the
list openly disagree — a leak *and* a visible inconsistency. One-line fix: apply the same
`listScopeFilter(tasks.primaryListId, await taskOwnEscape())` every other repo uses.

### F4 — The two accounts that prove RBAC no longer exist

`DEMO_ACCOUNTS.md` documents `guest@`, `marketing.only@` and `cs.only@` — the guest and
space-scoped roles. **They are not in the database** (12 users, none of them these). `db:seed:demo`
truncates, and `scripts/demo-role-accounts.ts` was never re-run after the last reseed. The two most
permission-interesting roles therefore cannot be tested through the documented path, and any QA
that trusts that file silently skips them.

Fix: `npx tsx scripts/demo-role-accounts.ts`, or fold it into `db:seed:demo`.

---

## 3) 🟠 Built on the server, unreachable in the app

Of 250 client API functions, ~20 are never called by any component. These are not dead code — they
are **finished backend features with no way in**:

| Gap | Server side | Client side |
|---|---|---|
| **Edit a comment** | `PATCH /comments/:id`, including the mention-diff that notifies only newly-added people | `CommentsSection` calls only `byTask`/`create`/`delete`. It renders an **"(edited)" badge that can never appear** |
| **Read form submissions** | `GET /forms/:id/submissions` plus a dedicated `form.view_submissions` permission | The forms list shows **"N submissions"** with nothing to click |
| **Run a sprint** | create / update / start / close / addTasks / removeTask | none called — the sprint board is read-only |
| **Customise statuses** | create / update / delete | none called — every list is stuck with its seeded statuses |
| **Notification preferences** | get + update | no UI |
| **Watch a task** | `tasksApi.watch` / `unwatch` | no UI — watchers exist but cannot be changed |
| **Apply a template** | `byType` / `getById` / `apply` | no UI |
| Also unreachable | `usersApi.resetPassword`, `authApi.logoutAll`, `spacesApi.delete`/`unarchive`, `listsApi.unarchive`, `checklistsApi.bulkAddItems`, `foldersApi.listBySpace` | |

For a 100-person rollout the first two matter most: people **will** typo a comment, and a form that
collects answers nobody can read is a dead end.

---

## 4) 🟡 Security and correctness, smaller

| # | Finding | Where | Fix size |
|---|---|---|---|
| S1 | **CORS reflects any private-LAN origin in production too** — the dev-convenience regex is not env-gated | `server/src/app.ts:88` | gate behind `!IS_PROD` |
| S2 | **R2 unconfigured in prod = silent data loss** — uploads return `https://r2.fake/...` and store nothing; only a log line objects | `server/src/services/R2Service.ts:62-72` | refuse to boot, or surface it in `/health/ready` |
| S3 | **No optimistic locking from the UI** — the server honours `If-Match`, the client never sends it, so two people editing one task is silent last-write-wins | `client/src/http/api.ts:810` | send the ETag |
| S4 | **`task.view` scope `own` does not narrow reads** — inside a space you can see, you see every task (by design: `space.view` governs). But the roles UI offers `own` and `/me/permissions` reports `own:true`, so an admin tightening it gets no effect | permission catalog + `listScopeFilter` | drop `own` from that permission's scopes, or honour it |
| S5 | **Split-brain clock** — `ReviewsService`, `ReportsService`, `OnCallRepo`, `EngineeringRepo` and the assistant prompt hardcode `dhakaToday()`, while Home/TaskWrite/jobs/insights use `workspaces.timezone`. Latent only because the one workspace is Asia/Dhaka | 11 call sites | route them through the workspace clock |
| S6 | 2 redundant indexes: `idx_comments_task_time` inside `idx_comments_task_created_internal`, `idx_tcfv_field` inside `idx_tcfv_option` | schema | drop 2 |

---

## 5) 🟡 Process, dependencies, UX

- **`npm test` is not a gate.** The root jest config produces false failures; the real gates are 35
  per-module configs, and **there is no CI anywhere in the repo**. Nothing proves the whole system
  green in one command — every release rests on remembering which configs to run.
  *Fix: one runner script that executes each module config in sequence and prints a single verdict.*
- **`npm run dev` uses nodemon**, which ignores `.ts` changes and serves stale code. The recipe that
  actually works (`tsx watch`) lives only in the docs. One-line `package.json` fix.
- **Dependencies**: server **1 critical + 9 high**, client **8 high**.
  - Client's are all non-breaking — `npm audit fix` covers axios, react-router, vite, postcss,
    nanoid, form-data, js-yaml.
  - Server's need majors: `bcrypt@6` (clears the critical `tar` hardlink CVE), `drizzle-orm@0.45.2`
    (SQL-identifier injection advisory), `nodemailer@9`.
- **The app is desktop-only.** The whole client has **6 responsive rules** — Home, Engineering home,
  the auth layout, the sidebar's 640px collapse, and the assistant's mobile mode. List, Board,
  Calendar, the task drawer and all of Settings have none; board columns are fixed at 288px. For ops
  teams working from phones this is the biggest UX gap in the product.
- **1.4 MB main JS chunk** (444 KB gzip). Routes are already lazy-loaded; the vendor bundle (antd) is
  not split.
- **Filtering is client-side over the full list.** `listByList` loops 200-per-page until the list is
  exhausted, so filter results are always complete (good) — but the space browser fetches every list
  in parallel. Fine at 47 tasks, linear from here.

---

## 6) Production — what the outside world says

Read-only probes of `tasks.beautybooth.com.bd`:

- site **200**; `/health` **200** with `uptime 151471s` (≈42h ⇒ restarted ~2026-08-20 15:00 Dhaka)
- `/api/v1/auth/me` **401**, `/api/v1/delete-requests` **401**, `/api/v1/teams` **401** — the API is
  mounted and carries the 023-era routes
- serves **`assets/index-BTa8KcQk.js`** — the exact bundle introduced by **`89cafdb`** (2026-08-20 12:22)

Conclusion: **production is at `89cafdb` or later** (very likely `c357ccf`), so the insights
assistant, mentions, filters, calendar fix, delete-approval and recurrence are all live — and the DB
upgrades must have been applied, because the code would 500 on every task read otherwise.

Confirm once before trusting it:

```sql
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE table_schema='taskmanagement' AND table_name='tasks'
   AND COLUMN_NAME IN ('recurrence_time','recurrence_last_spawned_on','recurring_source_id');
-- must be 3
```

Also confirm on the box that `/etc/cron.d/bbtasks-backup` and `/etc/logrotate.d/bbtasks` are
installed — the repo ships both, the deploy prompt never checks them, and the host is shared and was
79% full.

---

## 7) Suggested order of work

1. **F1** deploy-canary fix — 5 minutes, protects every future deploy
2. **F4** restore the RBAC demo accounts — one command
3. **F3** `/eng/home` scope filter — one line plus a test
4. **F2** chat retention job + clear-history — half a day, and it stops growing today
5. **Comment edit**, then **form submissions** — the two dead-ends users will actually hit
6. `npm audit fix` on the client; plan the three server majors behind a test run
7. The single-command test gate, then CI
8. Mobile: List and Board first, then the task drawer

Everything in §4 is a small self-contained edit and can ride along with any of the above.
