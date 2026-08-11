# 🔭 FULL SYSTEM SCAN — 2026-08-11

**Scanned state:** `main` @ `13eeaea`, working tree clean at the moment the scan
started. **Every finding below is against that committed snapshot.**
**Scope:** frontend + backend + database + requirements parity + tests + deploy posture.
**Method:** every claim below was produced by running something, not by reading a doc.
Raw artifacts are listed in [Appendix A](#appendix-a--how-each-claim-was-produced).

> ⚠️ **The tree changed while this scan was running.** A *team membership /
> team access* feature is now in progress and uncommitted — see
> [§10](#10-work-in-flight-not-part-of-the-scanned-snapshot). It does not
> invalidate anything above it, but it does explain two test-module failures and
> it means the endpoint / upgrade counts in §1 are the `13eeaea` numbers, not
> today's working-tree numbers.

---

## 0. Verdict in one paragraph

The **engine is in very good shape** — schema parity is exact, RBAC enforcement is
provably correct under live probing, both TypeScript projects compile clean, the
client↔server contract has zero broken calls, and there are no secrets, no SQL
injection surface and no TODO debt. **The gap is not correctness — it is reach.**
A large amount of shipped, tested backend is unreachable from the product: 37 of
169 client API functions have no caller, whole features (sprints, statuses,
templates, form submissions, role assignment, notification preferences) are
built and green in tests but have no button. Plus two provisioning traps that
would bite on the next deploy. Nothing here is a security hole; almost
everything here is *"we built it and nobody can use it."*

| Severity | Count | Theme |
|---|---|---|
| 🔴 HIGH | 7 | features that exist but cannot be reached / used |
| 🟠 MEDIUM | 13 | half-built features, doc drift, latent authz limit, no CI |
| 🟡 LOW | 6 | dead surface, cosmetic drift, repo bloat |
| ✅ Verified healthy | 12 areas | **do not re-audit these** |

> Every finding below was re-verified in this scan. Where it contradicted an
> earlier note, the earlier note lost: `space` scope **is** enforced for the
> roles that exist today (proved live), the dead-permission count is **4** not 3,
> and `task.editt` is not a real key — it is an example inside a comment in
> `rbac/catalog.ts:91`.

---

## 1. Inventory (measured, not remembered)

| Layer | Count |
|---|---|
| API endpoints | **187** (186 in route files + inline `GET /health`) |
| Route files / controllers / services / repos / validators | 32 / 34 / 43 / 39 / 30 |
| Background jobs | 7 (all 7 wired in `deploy/cron/bbtasks-jobs`) |
| DB tables / views / triggers | **43 / 5 / 9** (canonical, dev, and Drizzle all agree) |
| RBAC | 56 permissions · 5 roles · 144 grants · 28 assignments |
| Client pages / components | 40 / 94 |
| Server source / server tests / client source | 56,791 / 69,471 / 41,488 LOC |
| Server test files | 169, across 33 per-module jest configs |
| Client test files | 7 (44 tests) |

---

## 2. ✅ Verified healthy — do NOT re-audit

These were checked *this scan* and are clean. Skip them next time.

1. **Drizzle schema ↔ `database/schema.sql`** — 43/43 tables, exact both ways.
2. **Live dev DB ↔ canonical schema** — built a fresh reference DB from
   `schema.sql` and diffed `information_schema`: **columns, indexes and foreign
   keys are identical**. (One stale view — see L1.)
3. **Client ↔ server contract** — 165 client call sites vs 187 endpoints:
   **zero** calls to a non-existent route or wrong method.
4. **RBAC enforcement (as currently configured)** — probed live against the
   running API as `marketing.only@` (a space-scoped custom role):
   - cross-space `POST /tasks` into another department's list → **404**
   - cross-space `GET` / `PATCH` / comment on a foreign task id → **404** (non-disclosing)
   - `own`-scoped `task.edit` on someone else's task → **403 `not_own`**
   - own-space create / own-task edit → **201 / 200**

   The coarse `requirePermission` gate + repo-level SQL visibility + `can()`
   own-checks compose correctly for every role that exists today. See **M11**
   for the structural limit behind this result.
5. **TypeScript** — `tsc --noEmit` clean on server, `tsc -b` clean on client.
6. **Committed build artifact** — `server/dist/` (296 files) is **byte-identical**
   to a fresh `tsc`. No stale-deploy risk on the git-ships-artifacts path.
7. **Security headers** — verified on a live response: `X-Content-Type-Options`,
   `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP
   `default-src 'none'`, COOP/CORP, HSTS (prod), `x-powered-by` disabled.
8. **Secrets** — no secret-shaped literal in tracked source; `.gitignore` covers
   `.env`, `server/.env`, `client/.env`, `ROTATED_SECRETS*.txt`.
9. **SQL injection** — 89 raw `sql\`\`` sites, **zero** with unparameterised
   interpolation.
10. **Code debt markers** — 0 real `TODO`/`FIXME`/`HACK` in server or client.
11. **Client permission keys** — all 19 keys used in the UI exist in the
    56-key server catalog. No typo silently hiding a control.
12. **Client tests** — 7 files / **44 passed**.

---

## 3. 🔴 HIGH findings

### H1 — Recurring tasks are a lie the UI tells (req #16)
`tasks.recurrence_pattern / recurrence_days / recurrence_ends_at` exist in the
schema, the validators accept them, and `client/src/components/task/RecurrenceConfig.tsx`
lets a person choose Daily/Weekly. **No job ever spawns the next occurrence.**
`server/src/jobs/index.ts` registers 7 jobs; none is recurrence.
`server/src/routes/jobs.ts:41` admits it in a comment:
> `// recurrence-spawn and email-digest routes are registered here as each job is built`

So a person sets "repeat weekly", it saves, and nothing ever happens — with no
error to tell them. For a task manager this is the most visible broken promise
in the product.
**Fix:** build a `recurrence-spawn` job + cron line, or remove the UI control.

### H2 — Public-form submissions are a data black hole
`GET /forms/:id/submissions` exists, is gated by `form.view_submissions`, and is
covered by tests. **No client code calls it.** `FormsListPage` displays
`form.submissionCount` — so the product tells you *how many* submissions you have
and gives you no way to read them. Meanwhile the `form-submission-expiry` cron
job deletes them at 90 days.
For an ecom ops team using forms for outside intake, data is being collected,
counted, and then destroyed unread.

### H3 — Sprint management is read-only in the product (req E5)
`SprintBoardPage.tsx` (332 lines) calls exactly two functions: `sprintsApi.list`
and `sprintsApi.tasks`. Unreachable from the UI: **create, update, delete, start,
close, add tasks, remove task, active, getById** — 10 endpoints, all tested.
Engineering can look at a sprint board but cannot run a sprint.

### H4 — Statuses settings can only reorder (req #4)
`StatusesSettings.tsx` calls `statusesApi.byList` (read) and `statusesApi.reorder`.
`create`, `update`, `delete` have no caller. An admin can drag statuses around but
cannot add a status, rename one, or delete one — per-list status workflows are the
4th core requirement.

### H5 — Dynamic RBAC has no way to assign a role
The roles admin grid (`/settings/roles`) can create and edit roles and toggle all
56 permissions. There is **no UI to give a role to a person**. Unused:
`rbacApi.assign`, `revoke`, `assignmentsFor`, `spaceMembers`, `holders`, `updateRole`.
`MembersSettings.tsx` still writes the **legacy `users.role` column** through
`PATCH /users/:id/role`, with a hardcoded `["admin","member","guest"]` list.

Net effect: a custom role created in the UI can never be given to anyone from the
UI. The 28 rows in `user_roles` were placed by seed scripts. The RBAC feature is
half-reachable.

### H6 — `npm run db:migrate` silently provisions a broken database
**Proven live.** Ran it against an empty scratch DB: exit code 0, logs
`Drizzle migrations complete`, `Post-migration SQL applied.` Result:

| | canonical (`db:setup`) | `db:migrate` |
|---|---|---|
| app tables | 43 | **35** (+ `__drizzle_migrations` bookkeeping = 36 rows in `information_schema`) |
| views | 5 | 5 |
| triggers | 9 | **7** |

Missing tables: `permissions`, `roles`, `role_permissions`, `user_roles` (**all of
RBAC**), `task_reviews`, `department_reports`, `push_subscriptions`,
`r2_purge_queue`. Missing triggers: `trg_comments_after_update`,
`trg_form_submissions_after_delete`.

The server boots on this DB and then 500s the moment anything touches RBAC,
reviews, reports or push. The command is still in `package.json` and reports
success.
**Fix:** make `db:migrate` refuse to run (or delete it) and point everything at
`db:setup` + `database/upgrades/001–015`.

### H7 — `PRE_DEPLOYMENT_CHECKLIST.md` describes a different system
It is a Phase-0/1 checklist for one migration (`0005_form_encryption`), written
around AWS Secrets Manager / GCP / Kubernetes `deployment.yaml` / systemd
`EnvironmentFile`. It contains **zero** mentions of pm2, nginx, the actual host,
`db:setup`, `schema.sql`, or `database/upgrades/`. Its "Apply Migration" step
runs a single Drizzle SQL file.

Anyone following it to bring up production provisions nothing usable. The real
deploy knowledge lives in `deploy/` (nginx vhost, pm2 ecosystem, cron, logrotate,
backup) and is not referenced from the checklist at all.

---

## 4. 🟠 MEDIUM findings

### M1 — `API_DESIGN.md` does not document two shipped subsystems
Zero occurrences of `me/permissions`, `roles/catalog`, or `assistant/chat`.
Undocumented: the **11 RBAC endpoints** (`/roles*`, `/users/:id/roles`,
`/spaces/:id/members`, `/me/permissions`) and the **3 Assistant endpoints**.
Worse, **Appendix B still prints the superseded static Owner/Admin/Member/Guest
matrix** — the thing the 56-permission catalog replaced. A reader of the spec gets
the wrong authorization model.

### M2 — 4 permission toggles gate nothing
`report.generate`, `review.perform`, `review.read` and `report.note` appear
**only** in `rbac/catalog.ts` (definition), `rbac/bootstrap.ts` (seed grants) and
one explanatory comment in `rbac/can.ts`. No route, service or repo ever checks
them. (`report.note` is the one seeded owner-only — so the strictest-looking
grant in the catalog is also inert.)

Those endpoints are **not** open — `ReviewsService` enforces
head-of-space-or-owner/admin (403 `review.not_head`) and `ReportsService` enforces
owner/admin-or-current-head. But it is enforced by **hardcoded legacy role checks**,
so the three switches an admin sees in `/settings/roles` do nothing. Same class of
bug as the old H1 "admin toggles lie", now down to 3 of 56.

### M3 — Client action-gating covers 19 of 56 permissions
Nav and settings routes are gated. Action buttons largely are not — there is not a
single client reference to `form.manage`, `list.create`, `list.manage`,
`task.create`, `comment.create` or `space.archive`. Concretely, `FormsListPage`
renders **"New form" unconditionally**: a member without `form.manage` sees the
button, fills the modal, and gets a 403. Not a security hole (server enforces) —
a UX defect, repeated across the app.

### M4 — Notification preferences have no UI
`user_notification_prefs` table + `NotificationPrefsRepo` +
`GET`/`PUT /notifications/preferences` + passing tests. `ProfileSettings.tsx`
only exposes the **browser push permission** toggle. Nobody can choose which
notifications they receive.

### M5 — Custom task IDs per list are effectively unbuilt (req #6)
`schema.sql:435` describes deriving `custom_id` from `<list.prefix>-<task_number>`
— but **`lists` has no `prefix` column**, no service derives one, and the client has
no input for it (it only ever *reads* `customId`, falling back to `T-<n>`). The API
does accept a manually-supplied `custom_id` with a uniqueness check; 3 of 49 dev
tasks have one, all seeded. So req #6 (`ORD-1042`, `FEAT-220`) does not exist in
the product, and req #15's "search by custom ID" has almost nothing to match.

### M6 — SLA can be seen but never set (req #19)
`SLABadge` renders `task.slaDueAt`, `/sla` lists breaches. `PATCH /tasks/:id/sla`
has **no caller** and there is no SLA field in the task drawer. Half the
requirement ("set due window") is unreachable.

### M7 — Templates can be authored but never applied (req #18)
`POST /templates/:id/apply` is built and tested; `templatesApi.apply` exists in
`api.ts`. `TemplatesSettings.tsx` calls only `list`, `create`, `update`, `delete`.
There is no "Apply template" button anywhere. Same for `templatesApi.byType` and
`getById`.

### M8 — No CI, and no single trustworthy test command
No `.github/workflows` at all. `npm test` runs the **root** jest config; the
trustworthy path is the 33 per-module configs (private DB each), which take hours
run sequentially. Nothing gates a commit, and no one command answers "is main
green?".

### M9 — Main JS chunk is 1,215 kB (373 kB gzip)
Over Vite's 1,200 kB warning threshold, on top of separate `editor` (375 kB) and
`react` (284 kB) chunks. The audience is ~100 people in Bangladesh, largely on
mobile networks.

### M11 — object-level scope is enforced in 7 of 18 write services
Authorization is deliberately two-halved: `requirePermission` proves the **verb**
at the route, and `assertScoped` (`rbac/scopeGuard.ts`) proves the **reach**
against the resolved row. Only these import the guard: `TaskWriteService`,
`TaskMembershipService`, `AttachmentsService`, `CommentsService`,
`ReviewsService`, `ReportsService`, `UserService` — with `assertScoped` actually
called at **5 sites, all task-related**.

No guard at all in: `ChecklistsService`, `ListService`, `SpacesService`,
`StatusesService`, `TagService`, `CustomFieldsService`, `FormsService`,
`SprintsService`, `OnCallService`, `TemplatesService`, `TaskDependenciesService`.

For those 11 domains a grant narrowed to `space` or `own` behaves as `all`,
bounded only by what the **visibility** layer (driven solely by `space.view`)
lets the actor see.

**Latent today, not exploitable** — all 5 seeded roles grant everything at scope
`all`, and the one narrowed role ("Department Only") also has `space.view` at
`space`, so visibility contains it. That is exactly why the live probes in §2.4
all returned 404. The hole opens the first time someone builds a role with
`space.view: all` plus a `space`-scoped write grant (e.g. `list.manage: space`)
— the admin UI happily offers that combination.

### M12 — the 33 jest configs are not a clean partition
Three separate defects in the one thing that is supposed to tell you whether the
system works:

1. **3 test files run under no per-module config.** `jest.lists.config.cjs`
   enumerates 5 files explicitly; `tests/lists/` contains 8. `get-by-id`,
   `list-all` and `list-by-space` are matched only by the root `jest.config.js`
   — the config nobody runs. Confirmed by the sweep: the lists module reported
   5 suites, not 8.
2. **`jest.tagscheck.config.js` is broken and reports false failures.** It runs
   `tests/auth/**` *and* `tests/tags/**` against the **tags** DB setup
   (`global-setup-tags` / `setup-each-tags`), which does not truncate
   `password_reset_tokens` between tests. Result: 2 failures in
   `tests/auth/forgot-password.test.ts` — `countAllResetTokens()` returns 34 and
   36 instead of 0 and 1. **The exact same two tests pass under
   `jest.auth.config.cjs`.** A config artifact masquerading as a product bug.
3. **`jest.tags.config.js` and `jest.tagsreview.config.cjs` are duplicates** —
   identical `testMatch` (`tests/tags/**`), differing only in DB setup. Both
   reported 4 suites / 149 tests. One of them is redundant work on every sweep.

### M14 — a "killed" background sweep does not stop running
Discovered the hard way during this scan. When the harness reports a background
shell as *killed*, the `bash` script can survive and keep looping — spawning a
fresh `jest` for the next module. Two orphaned sweeps plus a foreground run ended
up on the same private DBs and produced **48 fake failures** across `statuses`
(42) and `taskTypes` (6), all `Deadlock found when trying to get lock`. Both
modules pass **209/209** and **184/184** when re-run alone.

**Detection:** `Get-CimInstance Win32_Process | Where CommandLine -match 'jest'`
— if killing a child produces a *new* PID moments later, the parent script is
still looping. **Fix:** find the parent `bash.exe` running the sweep script and
`taskkill /PID <pid> /T /F` that, not the jest children.

### M13 — the deployed build cannot be identified
`GET /health/version` returns `git_sha: process.env.GIT_SHA ?? "unknown"`
(`routes/health.ts:98`). **`GIT_SHA` is only ever read — it is set nowhere**: not
in `package.json` scripts, not in `deploy/pm2/ecosystem.config.js`, nowhere in
the repo. So production always answers `"unknown"`. The other field, `version`,
is read from `package.json` and has been a static `1.0.0`. The endpoint that
exists to answer "which build is live?" structurally cannot.

### M10 — 5,844 lines of dead mock code ship in `src`
`client/src/lib/mock-api.ts` (2,496) + `client/src/mocks/**` (3,348) are imported
by nothing outside themselves. Tree-shaken out of the bundle, but they are live
maintenance surface and a standing source of stale "truth" (e.g. they are the only
place `deployedAt` is ever written).

---

## 5. 🟡 LOW findings

**L1 — `v_open_tasks` is stale in every upgraded database.**
Diffing a fresh `schema.sql` build against the live dev DB: the live view is
missing `overdue_notified_at`, `review_status`, `reviewed_at`, `reviewed_by`.
Cause: upgrades `002` and `014` add columns to `tasks` but never
`CREATE OR REPLACE VIEW`, and MySQL freezes a view's column list at creation.
Production has the same drift. **Impact: none today** — no application code reads
any of the 5 views. Either drop them or add a view-refresh step to the upgrade path.

**L2 — Deploy/rollback timestamps are display-only (req E12).**
`deployed_at` + `rollback_reason` are in the schema, writable through the API
(validators + `TaskWriteService`), and rendered in `TaskDetailDrawer`. The only
place they are ever *set* is mock data.

**L3 — Dead server surface (no client caller):** `GET /activity` (full workspace
feed — only `/activity/recent` is used), `GET /assistant/conversations` and
`/conversations/:id` (chat history), `GET /home/agenda`, `POST /uploads/sign` +
`POST /attachments/:id/finalize` (the direct-to-R2 path; the client uses the
multipart `POST /tasks/:id/attachments` instead).

**L4 — `API_DESIGN.md` documents invitation endpoints that do not exist.**
Spec says `GET /auth/invitations/:token` and `POST /auth/invitations/:token/accept`;
the code serves `GET /auth/invitation/:token` and `POST /auth/accept-invitation`.

**L6 — `.git` is 74 MB, and ~all of it is the decommissioned Cloudflare port.**
Packfile is 60.75 MiB. The ten largest blobs in history total **149 MB
uncompressed** and are *every one* dead `node_modules` from the scrapped
Astro/Cloudflare/Turso branch:

| Size | Path |
|---|---|
| 86.3 MB | `node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe` |
| 18.2 MB | `node_modules/@img/sharp-win32-x64/lib/libvips-42.dll` |
| 14.1 MB | `node_modules/wrangler/wrangler-dist/cli.js` |
| 11.1 MB | `node_modules/@esbuild/win32-x64/esbuild.exe` |
| 6.1 MB | `node_modules/miniflare/dist/src/index.js.map` |
| …6 more | all miniflare / workerd / wrangler |

Every clone pays for this forever. Recovering it needs a history rewrite +
force-push — destructive, so it is a **decision, not a task**. Worth doing at the
same time as any other history work; not worth doing alone.

**L5 — Smaller "no UI" gaps.** `spacesApi.delete` / `unarchive`,
`listsApi.unarchive`, `usersApi.resetPassword`, `commentsApi.update`,
`tasksApi.watch` / `unwatch`, `checklistsApi.rename` / `bulkAddItems` /
`deleteItem`, `onCallApi.delete`, `authApi.logoutAll`. Note that **archive exists
without unarchive** for spaces and lists — a one-way trip in the product.

---

## 6. Requirements parity — `FINAL_REQUIREMENTS.md`

### §5 Core features (every team)

| # | Feature | Status |
|---|---|---|
| 1 | Auth + invitations + password reset | ✅ |
| 2 | Admin / Member / Owner roles | ✅ (+ dynamic RBAC, see H5) |
| 3 | 6 spaces + lists | ✅ |
| 4 | Per-list status workflows, 4 groups | ⚠️ **reorder only** — H4 |
| 5 | Tasks: name/desc/status/priority/assignees/due/tags | ✅ |
| 6 | Custom task IDs per list (`ORD-1042`) | ❌ **not built** — M5 |
| 7 | Comments — flat + 1-level thread + delete | ✅ (edit has no UI, L5) |
| 8 | Checklists | ✅ (rename/bulk/delete-item no UI, L5) |
| 9 | Attachments (R2) | ✅ |
| 10 | Workspace-wide tags | ✅ |
| 11 | Generic custom field types | ✅ |
| 12 | List / Board / Calendar / Form views | ✅ all 4 present |
| 13 | Public intake form | ⚠️ submissions unreadable — H2 |
| 14 | Notifications: in-app bell + email | ✅ (+ SSE + Web Push; prefs no UI, M4) |
| 15 | Global search by name + custom ID | ⚠️ custom-ID half is moot — M5 |
| 16 | Recurring tasks (Daily/Weekly) | ❌ **no spawn job** — H1 |
| 17 | Per-task + light workspace activity log | ✅ |
| 18 | Task templates | ⚠️ **cannot be applied** — M7 |
| 19 | SLA — set window, surface breaches | ⚠️ **surface only, cannot set** — M6 |
| 20 | Mobile-responsive web | ✅ |

### §6 Engineering features

| # | Feature | Status |
|---|---|---|
| E1 | Subtasks (2 levels) | ✅ |
| E2 | Task dependencies | ✅ |
| E3 | Rich text (TipTap) | ✅ |
| E4 | @mentions + #task refs | ✅ |
| E5 | Sprint system | ⚠️ **read-only UI** — H3 |
| E6 | On-call rotation | ✅ (delete no UI) |
| E7 | Reviewer field | ✅ |
| E8 | Git branch / PR fields | ✅ |
| E9 | Bug fields (S0–S3, repro, env) | ✅ |
| E10 | Cross-team "Report a bug" | ✅ |
| E11 | Postmortem checklist | ✅ |
| E12 | Deploy / rollback timestamp | ⚠️ **display-only** — L2 |

**Score: 13 of 20 core ✅ · 5 ⚠️ · 2 ❌ — 10 of 12 engineering ✅ · 2 ⚠️**

---

## 7. Test results

33 per-module jest configs run sequentially (each has a private DB).
Client: `vitest run` → **7 files / 44 tests, all passing**.

Server sweep results are appended to
`scratchpad/suites/_summary.txt`; the modules completed at the time of writing
are recorded in [§9](#9-test-sweep-log).

One failure was investigated and dismissed: `tests/attachments/finalize.test.ts`
→ *"200 flips pending→complete"* hit the 30 s jest timeout during the sweep, but
**passes in 8 s when re-run in isolation**. `R2Service` is a no-network stub in
test, so this is load contention, not a defect.

---

## 8. Recommended order of work

1. **H6 + H7** — kill the `db:migrate` trap and rewrite the deployment checklist.
   These are the only findings that can break a *production* bring-up.
2. **H1** — build the recurrence-spawn job (or remove the control). Most visible
   broken promise to actual users.
3. **H2** — a submissions view. Data is being collected and deleted unread.
4. **H5** — role-assignment UI. Unlocks the whole RBAC investment.
5. **H4 + H3 + M7 + M6** — the "no button" cluster: statuses CRUD, sprint actions,
   apply-template, set-SLA. All backend is done and tested; this is UI wiring.
6. **M8 + M12** — a CI workflow (even just `tsc` + client vitest + 3 jest
   modules), and fold the 3 orphaned `tests/lists` files into
   `jest.lists.config.cjs`. Right now nothing gates a commit and 3 test files
   never run.
7. **M11** — either call `assertScoped` in the remaining 11 write services, or
   stop offering `space`/`own` scope on permissions those services own. Do this
   *before* anyone creates a role with `space.view: all` + a narrowed write grant.
8. **M1 + M2** — make the spec and the permission catalog honest.
9. **M3** — gate action buttons so people stop meeting 403s.
10. **M13** — set `GIT_SHA` at build time so `/health/version` can answer.

---

## Appendix A — how each claim was produced

| Claim | Method |
|---|---|
| 187 endpoints, guards, dead surface | AST-ish scan of `routes/*.ts` + `app.ts` mounts, diffed against every client call site (`scratchpad/report.txt`) |
| spec parity | `API_DESIGN.md` `### METHOD \`path\`` headings vs implemented routes (`scratchpad/spec_parity.txt`) |
| schema parity | fresh `tms_scanref` DB built from `schema.sql`, `information_schema` diff of columns / indexes / FKs vs `taskmanagement` |
| `db:migrate` produces 36/5/7 | ran it against an empty `tms_migref` DB and counted |
| RBAC enforcement | live HTTP probes against `localhost:5501` as `marketing.only@` and `owner@` |
| 37 unused API functions | every `xxxApi.method` export vs all non-api client files (`scratchpad/dead_api.txt`) |
| 3 dead permissions | 56 catalog keys from the DB vs all string literals in `server/src` excluding `rbac/catalog.ts` + `bootstrap.ts` |
| dist not stale | `npx tsc` then `git status server/dist` → 0 of 296 changed |
| headers | `curl -D -` against the running API |
| bundle size | `npx vite build` |

Scratchpad: `C:\Users\Tanvir\AppData\Local\Temp\claude\E--Task-Management-System\2a1b7a37-70f6-42e4-addf-2da661f1c6c1\scratchpad\`

---

## 9. Test sweep log

Runner: `scratchpad/run-suites.sh` — every `jest.<module>.config.*` in turn,
`--runInBand`, private DB per config. **Still running at the time this report was
written**; live tally in `scratchpad/suites/_summary.txt`.

| Module | Verdict | Suites | Tests |
|---|---|---|---|
| assistant | ✅ PASS | 8/8 | 127 |
| attachments | ⚠️ 1 FAIL | 5/6 | 105 pass, 1 fail — **verified flake**, passes in 8 s in isolation |
| auth | ✅ PASS | 9/9 | 341 |
| collab | ✅ PASS | 2/2 | 49 |
| customfields | ✅ PASS | 7/7 | 102 |
| deptreview | ✅ PASS | 14/14 | 122 |
| eng | ✅ PASS | 3/3 | 79 |
| forms | ✅ PASS | 8/8 | 85 |
| health | ✅ PASS | 2/2 | 14 |
| home | ✅ PASS | 1/1 | 23 |
| jobs | ✅ PASS | 6/6 | 41 |
| lists | ✅ PASS | 5/5 | 187 — **only 5 of the 8 files in `tests/lists/`, see M12** |
| membership | ✅ PASS | 6/6 | 102 |
| notifications | ✅ PASS | 8/8 | 102 |
| oncall | ✅ PASS | 4/4 | 81 |
| rbac | ✅ PASS | 11/11 | 289 |
| search | ✅ PASS | 1/1 | 32 |
| sla | ✅ PASS | 2/2 | 24 |
| spaces | ✅ PASS | 7/7 | 246 |
| sprints | ✅ PASS | 10/10 | 164 |
| sse | ✅ PASS | 1/1 | 12 |
| … 12 modules remaining | _running_ | | |

**Subtotal after 21 of 33 modules: 120 of 121 suites green, 2,327 tests passed,
0 real failures.**

Client: `vitest run` → 7 files / 44 tests, all green.

---

## 10. Work in flight (NOT part of the scanned snapshot)

Partway through this scan the working tree stopped being clean. A **team
membership / team access** feature is being built and is currently uncommitted:

**New files:** `TEAM_ACCESS_AND_AUDIT_PLAN.md` · `database/upgrades/016_team_membership.sql`
· `server/src/routes/teams.ts` · `controllers/TeamsController.ts` ·
`services/TeamMembershipService.ts` · `serializers/teamSerializer.ts` ·
`validators/teams.ts`

**Modified:** `database/schema.sql` · `database/upgrades/README.md` ·
`server/src/app.ts` · `db/schema/auth.ts` · `repositories/UsersRepo.ts` ·
`repositories/UserRolesRepo.ts` · `services/SpacesService.ts` ·
`services/UserService.ts` · `types/users.ts`

**What upgrade 016 does:** adds `users.primary_space_id VARCHAR(64) NULL`, an
index `idx_users_primary_space`, and an FK to `spaces(id)`
`ON DELETE SET NULL ON UPDATE CASCADE`. No new tables — so the table count stays
43. It is written idempotently (each DDL gated on `information_schema`), which is
the right pattern.

**4 new endpoints** in `teams.ts`: `GET /teams`, `POST /spaces/:id/members`,
`DELETE /spaces/:id/members/:userId`, `PATCH /users/:id/team`.

### Checked: no route collision
`roles.ts` already declares `GET /spaces/:id/members`; `teams.ts` declares
`POST` and `DELETE` on the same path. Different methods, and `rolesRouter` mounts
first (`app.ts:158`) with `teamsRouter` after (`app.ts:161`), so the GET resolves
in roles and the POST/DELETE fall through to teams. **Correct as written.**

### This explains 2 test-module failures — they are not product defects
`UsersRepo` now selects `users.primary_space_id`. **50 of the 51 test databases
on this box were provisioned before upgrade 016 and do not have that column**
(only `tms_tasks_test` does). Every affected test dies with the same error:

```
Unknown column 'primary_space_id' in 'field list'
```

- `users` → 58 failed / 282, all in `deactivate`, `reactivate`, `reset-password`.
  The other 5 files in the module pass.
- `tasks10` → expected to fail identically (`tms_t10_test` lacks the column).

**Fix before trusting those modules again:** re-provision the per-module test
DBs, or apply `016_team_membership.sql` to each. This is also a good argument for
M8/M12 — a schema change silently invalidates 50 hand-made test databases and
nothing tells you.

### Note for whoever is building this
Requirement §2 of `FINAL_REQUIREMENTS.md` and the existing dynamic-RBAC design
already model membership as **role assignments scoped to a space**
(`user_roles.scope_type='space'`), which is what `GET /spaces/:id/members` reads
today. `users.primary_space_id` introduces a *second*, single-valued notion of
"which team is this person on". Both can be legitimate — a person's *home* team
vs the spaces they can reach — but it is worth writing down which one is
authoritative before more code depends on either. This is exactly the sort of
decision that H5 (no role-assign UI) has been deferring.
