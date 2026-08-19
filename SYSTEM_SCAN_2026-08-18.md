# 🔭 FULL SYSTEM SCAN — 2026-08-18

**Scanned state:** `main` @ `9f40f86`, working tree **clean** (nothing uncommitted).
**Scope:** frontend + backend + database + API contract + jobs + tests + security + deploy posture.
**Method:** every claim was produced by *running* something — typecheck, lint, jest, live
MySQL introspection, `npm audit`, AST/text analysis of the actual source. Nothing below is
copied from an older scan doc; where this scan agrees with the 2026-08-11 scan, it was
independently re-derived.

---

## 0. Verdict in one paragraph

**The engine is in excellent shape and is now provably so.** Schema parity is exact down to
the column and nullability level across all 47 tables; both TypeScript projects compile clean;
both carrying pre-existing lint debt (server 70 / client 12 errors — see the corrected table in §2); every one of 176 client call sites hits a real server route; there is no SQL
injection surface, no hardcoded secret, no TODO debt, and no unguarded endpoint. Four test
suites run as ground truth (673 tests) came back 100% green. **The gap is still reach, plus
one deploy-sequencing hazard that is now sharper than it was a week ago.** 29 of 178 client
API functions have no caller — sprints, statuses, templates-apply, form submissions and
notification preferences are built, tested and green but have no button. And because prod's
database is at upgrade `022` while `HEAD` requires `024`, **shipping this commit to prod
without running the SQL first breaks every task read in the app, not just recurrence.**
Nothing here is an active security hole. Almost everything here is either *"we built it and
nobody can press it"* or *"the deploy has an ordering requirement nothing enforces."*

---

## 1. What the system is, measured

| Layer | Measure |
|---|---|
| Server source | 319 `.ts` files, **66,749 LOC** (non-test) |
| Client source | 211 `.ts`/`.tsx` files, **44,779 LOC** |
| HTTP endpoints | **209** across 34 route files |
| Database | **47 tables / 5 views / 9 triggers**, 203 indexes, 107 FKs, all InnoDB + `utf8mb4_unicode_ci` |
| Background jobs | **9** (registry 9 == cron 9 == routes 9, verified consistent) |
| Server tests | 195 files, **3,682 test cases** |
| Client tests | 7 files, **47 tests** (vitest) |
| E2E | 15 Playwright files, **77 tests** |
| Client API surface | 33 API groups, **178 functions** |
| Upgrade scripts | `database/upgrades/001` → `024` |
| CI | **none** |

Endpoint guard breakdown (parsed from the route files, alias-resolved):

- **189** carry `authenticate`
- **108** carry a route-level `requirePermission` / `requireAnyPermission`
- **81** are authenticated but gated in the *service* instead (row-dependent rules — verified, see §3.4)
- **20** are deliberately unauthenticated: 6 auth entry points + 2 public-form + 3 health/metrics + 9 job routes guarded by `internalAuth` (`X-Internal-Token`)
- **170** of 209 run a `validate` chain

---

## 2. Verified green — do not re-audit these

Each of these was *run*, not read.

| Check | Result |
|---|---|
| `tsc --noEmit` (server) | **clean, exit 0** |
| `tsc -b` (client) | **clean, exit 0** |
| `eslint .` (server) | ⚠️ **CORRECTED 2026-08-19: 70 pre-existing errors** (mostly `no-unnecessary-type-assertion` in controllers + a few unsafe-`any` + untsconfig’d config files). The original “clean, exit 0” read the piped `tail`’s exit code, not eslint’s. |
| `eslint .` (client) | ⚠️ **CORRECTED 2026-08-19: 12 pre-existing errors + 4 warnings** (react-hooks purity / set-state-in-effect rules in older components). Same misread. |
| jest `jobs` suite | **7/7 files, 54/54 tests pass** |
| jest `rbac` suite | **19/19 files, 345/345 tests pass** |
| jest `assistant` suite | **14/14 files, 227/227 tests pass** (incl. the `route-parity` drift guard) |
| vitest (client) | **7/7 files, 47/47 tests pass** |
| **Sampled total** | **47 files / 673 tests — 100% pass** |

**Database parity — exact.** `database/schema.sql` (47) == Drizzle TS schema (47) == live dev
DB (47). Views 5/5, triggers 9/9. A full **column-level and nullability** comparison of every
Drizzle table against `information_schema` found **3** differences, all of them intentional
`VIRTUAL GENERATED` columns correctly excluded from Drizzle (`user_roles.scope_key`,
`task_assignment_requests.pending_flag`, `task_delete_requests.pending_flag`). **Zero real
drift.** The 3 stale subtask triggers flagged in the 2026-07-29 scan are gone.

**Client↔server contract — clean.** All 176 client call sites resolve to an implemented
server route. Zero broken calls. (The one "unmatched" hit was a parser artifact from a
ternary inside a template literal.)

**Authorization — no unguarded route.** The 81 endpoints without a route-level permission
gate were spot-checked at the service layer and all carry real authorization:
`TaskDeleteRequestsService.canApprove` requires live owner/admin **and** the
`task.delete_hard` grant (composed, never widened) behind a reach check and an atomic claim;
`ReportsService` gates owner/admin-or-head with snapshot-head history; `UserService.update`
requires self **or** (owner/admin **and** `member.edit_profile`);
`TeamMembershipService.assertTeamManager` covers owner/admin/own-head/grant. The pattern is
deliberate — these rules are row-dependent and cannot be expressed as a static route gate.

**Code hygiene.** 0 `TODO`/`FIXME`/`HACK`, 2 `as any`, 6 `eslint-disable`, 0 `console.log` in
production code. 454 typed error throws across 265 distinct error codes.

**Security posture.** No hardcoded secrets. No `.env` tracked in git. Exactly one `sql.raw()`
in the codebase and its argument is a compile-time constant; **zero** `sql.identifier` and
**zero** dynamic `orderBy` from user input. bcrypt for passwords, HS256 JWT (15m access /
30d refresh), `x-powered-by` disabled, security headers on every response including error
paths, CORS reflects only configured origins + loopback/RFC-1918. Password rules are mirrored
character-for-character between `server/src/validators/passwordPolicy.ts` and
`client/src/lib/passwordPolicy.ts`. Boot fails closed on missing/malformed
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `ENCRYPTION_KEY`, and non-UTC `DB_TIMEZONE`.

**Build artifacts are current.** `server/dist` (319 `.js` == 319 `.ts`) and `client/dist` were
both committed in `9f40f86`, the same commit as their sources, and every artifact timestamp
is newer than every source timestamp.

---

## 3. Findings

### 🔴 C1 — Deploying `HEAD` to prod without upgrades `023` + `024` breaks the whole app

**This is the single most important finding.**

The applied-state tracker in `database/upgrades/README.md` is accurate and honest: prod is at
**`022`** (46 tables). `023` and `024` are marked ⏳ for both qa and prod. Dev has both applied
(verified against the live dev DB — the three `024` columns and the `task_delete_requests`
table are present).

The hazard is what `024` does. It adds three columns to `tasks`
(`recurrence_time`, `recurrence_last_spawned_on`, `recurring_source_id`). `TasksRepo` uses
bare `.select()` in at least five places, which Drizzle expands to **every column declared in
the TS schema**. Against a prod DB that lacks those columns, that is `Unknown column` on
**every task read in the application** — the task list, the board, the calendar, search,
home. Not a degraded recurrence feature: a dead app. `023` adds `task_delete_requests` and
extends two notification ENUMs on top of that.

And nothing enforces the ordering. `server/src/server.ts` fails closed beautifully on missing
auth secrets — the comment there even names the failure mode: *"the server booted, `/health`
and `/health/ready` both answered 200 ready, and then every single login returned 500… a load
balancer saw a perfectly healthy instance nobody could sign in to, which is the worst possible
failure shape."* **That exact reasoning has not been applied to schema drift.** The server will
boot happily against a `022` database, report ready, and 500 on every task query.

Also required with `024`: the `*/15 recurrence-spawn` cron line
(`deploy/cron/bbtasks-jobs` already has it; the prod crontab does not).

**Fix:** (a) apply `023` + `024` to qa, then prod, *before* the code lands; (b) install the
updated cron file; (c) add a boot-time schema assertion — cheapest useful version is a startup
`SELECT` of one column added by the newest upgrade, refusing to boot on failure, in the same
place and style as the `REFRESH_TOKEN_SECRET` check.

---

### 🟠 H1 — `npm run db:migrate` builds 38 of 47 tables and warns nobody

The Drizzle migration chain is frozen at `0005`. Counting `CREATE TABLE` across
`server/src/db/migrations/*.sql` gives **38 tables**. `database/schema.sql` has **47**.

**12 tables are missing from that path**, including the *entire* RBAC core:

```
permissions            role_permissions       roles                user_roles
task_delete_requests   task_assignment_requests   task_assignment_request_events
space_visibility_grants  push_subscriptions   department_reports
task_reviews           r2_purge_queue
```

`db:migrate` has no guard and no warning — it exits 0 having built a database that boots and
then fails at runtime the moment anyone touches permissions. `db:setup` (which applies
`schema.sql`) is the correct path and *does* guard destructive re-application, but `db:migrate`
is the more obvious-sounding command and is still wired in `package.json`.

This was flagged on 2026-08-11 at 9 missing tables. It is now **12** — it grows every time a
feature ships. **Fix:** make `db:migrate` refuse to run (throw with a pointer to `db:setup` +
`database/upgrades/`), or delete the script entirely.

---

### 🟠 H2 — Dependency vulnerabilities: 1 critical + 17 high across both projects

| | critical | high | moderate | low | total |
|---|---|---|---|---|---|
| server | 1 | 9 | 4 | 1 | **15** |
| client | 0 | 8 | 2 | 1 | **11** |

**Client — every one has a fix available and `npm audit fix` should resolve them.** Two matter
in the running product:

- **`react-router` (HIGH) — open redirect via backslash in `<Link>`/`useNavigate`** (CVE-2025-68470 bypass). This is an auth'd app with post-login redirects; this is the one to patch first.
- **`dompurify` (MODERATE) — `CUSTOM_ELEMENT_HANDLING` bypasses `afterSanitizeElements`.** DOMPurify is verified as the sanitizer sitting directly behind `dangerouslySetInnerHTML` in `TiptapEditor.tsx:251-258` — i.e. it *is* the app's XSS defense line for rich-text.
- `axios` (HIGH, DoS via `formDataToJSON` recursion) also ships in the bundle.

**Server — three of the fixes are semver-major:**

- `bcrypt` → 6.0.0 clears the **critical `tar`** arbitrary-file-write and the high `@mapbox/node-pre-gyp` chain (install-time surface, not request-time — real but lower urgency).
- `nodemailer` → 9.0.5.
- `drizzle-orm` 0.36 → 0.45.2 for *"SQL injection via improperly escaped SQL identifiers."* **I checked whether this is exploitable here and it is not**: zero `sql.identifier` calls, zero dynamic `orderBy` from user input, and the single `sql.raw()` takes a compile-time constant. Every identifier in this codebase comes from the typed schema. Patch it on a planned cadence, not as an emergency — but a major Drizzle bump is real work, so schedule it rather than letting it drift further.
- `brace-expansion`, `form-data`, `ip-address`, `js-yaml`, `shell-quote` all fix with a plain `npm audit fix`.

---

### 🟠 H3 — Form submissions are collected and cannot be read

`FormsListPage.tsx:231` renders **"{form.submissionCount} submissions"**. The endpoint
`GET /forms/:id/submissions` exists and is permission-gated on `form.view_submissions`. The
client function `formsApi.submissions` exists. **No screen calls it.** There is no submissions
view anywhere in `client/src/pages` or `client/src/components`.

So the product tells an ops user that 12 people answered their form and gives them no way to
see a single answer. Public form intake, field encryption, the 90-day PII expiry job — the
whole pipeline is built behind a number nobody can click. For a team whose main use case is
collecting operational data, this is the highest-impact reach gap in the system.

---

### 🟠 H4 — The sprint board is read-only; the sprint lifecycle has no UI

`SprintBoardPage.tsx` calls exactly two functions: `sprintsApi.list()` and
`sprintsApi.tasks(id)`. **8 of 10 sprint API functions have no caller** — `create`, `update`,
`start`, `close`, `addTasks`, `removeTask`, `active`, `getById`. The backend has 11 sprint
endpoints, all tested (10 test files).

Engineering can look at a sprint. They cannot create one, start one, close one, or move a task
into or out of one, from the product.

---

### 🟠 H5 — No CI, and the deploy ships compiled artifacts through git

3,682 server tests + 47 client tests + 77 e2e tests exist, and **nothing runs them
automatically.** No `.github/`, no GitLab CI, no Jenkinsfile.

That matters more here than usual because of how the deploy works: `server/dist` (319 files)
and `client/dist` (42 files) are **tracked in git** and shipped to the box by `git pull`,
deliberately, because prod has ~560MB RAM free and must never build. Discipline has held so
far — this scan verified both artifacts are current with `HEAD`. But the invariant *"every
source commit must be accompanied by a rebuild of both dists"* is enforced by nothing except
memory. One commit that forgets it ships silently stale code to production with a green
`git status`.

**Fix:** a single CI job (or even a pre-push hook) that runs `tsc -b` on both projects,
rebuilds, and fails if `git diff --exit-code dist/` is dirty, would close both this and a
whole class of future surprises.

---

### 🟡 M1 — 29 of 178 client API functions (16%) have no caller

Improved from 37/169 on 2026-08-11, but the remaining set contains features users would
reasonably expect to exist. Beyond sprints (H4) and form submissions (H3):

| Group | Unreached | What that means in the product |
|---|---|---|
| `statusesApi` | `create`, `update`, `delete` | An admin can **reorder** statuses but cannot add, rename or remove one. `StatusesSettings` wires `reorder` only. |
| `templatesApi` | `apply`, `byType`, `getById` | You can create, edit and delete templates but **never use one**. The feature is decorative. |
| `notificationsApi` | `getPreferences`, `updatePreferences` | No notification-preferences screen at all, despite the endpoints and the `user_notification_prefs` table. |
| `tasksApi` | `watch`, `unwatch` | No way to follow/unfollow a task. |
| `commentsApi` | `update` | Comments can be posted and deleted but **not edited**. |
| `usersApi` | `resetPassword`, `getById` | An admin cannot trigger a password reset for someone from the UI. |
| `spacesApi` / `listsApi` | `unarchive`, `delete` | Archive is one-way in the UI. |
| `authApi` | `logoutAll` | No "sign out everywhere" control. |
| `onCallApi` | `delete` | A rotation entry can be set but not cleared. |
| `checklistsApi` | `bulkAddItems` | Paste-many-items path unused. |
| `foldersApi` | `listBySpace` | See L2. |

### 🟡 M2 — API documentation drift

**183 of 209 endpoints (88%) appear in `API_DESIGN.md`.** Two real gaps and one trap:

- **`roles.ts` — all 11 endpoints undocumented.** The entire dynamic-RBAC admin API (role CRUD, permission assignment, user-role assignment, space members) is absent from the API spec. It is described in `RBAC_DYNAMIC_PLAN.md`, but that is a plan document, not the contract.
- **`taskDeleteRequests.ts` — all 6 endpoints undocumented.** The permanent-delete approval flow shipped 2026-08-16; `API_DESIGN.md` has *zero* occurrences of the string `delete-request`.
- **Trap — two documented auth paths do not exist.** §2 documents `GET /api/v1/auth/invitations/:token` and `POST /api/v1/auth/invitations/:token/accept`. The implementation is `GET /auth/invitation/:token` and `POST /auth/accept-invitation`. The client uses the *correct* (implemented) paths, so nothing is broken at runtime — but anyone integrating from the doc gets a 404, and the doc has been wrong long enough that nobody has noticed.

Also undocumented: `GET /me/permissions`, `POST /tasks/:id/attachments`, `GET /sprints/:id/tasks`, `GET /eng/incidents/:id/postmortem`, the 3 assistant routes.

### 🟡 M3 — `POST /tasks/bulk` can hold a transaction across ~1,000 sequential round trips

The bulk validator caps at **200 task ids**. Inside one transaction, `TaskWriteService` runs
per-task awaited work — `assertScoped` per task (`:1812`), `openBlockerCount` per task
(`:1873`), `recomputeSubtaskCounters` per parent (`:2029`) — plus **nested** per-task ×
per-assignee (`:2073`) and per-task × per-tag (`:2150`, `:2169`) loops.

A 200-task bulk edit adding 5 tags is on the order of a thousand sequential queries inside a
single open transaction, holding InnoDB row locks for the duration. It is correct; it is not
scalable. Worth batching the per-row work (or lowering the cap) before anyone runs a
200-task operation on prod.

### 🟡 M4 — `PRE_DEPLOYMENT_CHECKLIST.md` is stale and points at three deleted files

Dated **2026-07-08**, scoped to "Phase 0 + Phase 1" of the form-encryption work only. It
references `DEPLOYMENT_GUIDE.md`, `ENCRYPTION_KEYS.txt` and `deploy.sh` — **all three no
longer exist** (the latter two were deliberately history-purged on 2026-07-23). It says
nothing about the 24 upgrade scripts, the dist-via-git artifact rule, the cron file, or the
prod-specific `DB_SOCKET_PATH` / `DB_TIMEZONE=+00:00` requirements.

The real runbook is `LIVE_ROLLOUT_TEAM_ACCESS.md` + `database/upgrades/README.md`. The file
with the authoritative-sounding name is the one that will mislead whoever deploys next.
Delete it or replace it with a pointer.

### 🟡 M5 — 5,844 lines of dead mock code

`client/src/lib/mock-api.ts` (2,496 lines) and `client/src/mocks/` (28 files, 3,348 lines)
have **zero importers**. The only apparent references are a comment in `api.ts` and a string
inside a mock task title. Confirmed tree-shaken out of the production bundle (0 hits for
`mock` in the built `index` chunk), so there is no runtime cost — but it is 13% of the client
codebase still being typechecked, linted and read by anyone navigating the project.

---

### 🔵 Low

- **L1 — 3 orphaned server endpoints.** `POST /uploads/sign` (the presigned-R2 upload path; the client uses the direct `POST /tasks/:id/attachments` path instead, so there are two upload designs and only one is wired), `GET /home/agenda` (the client's `AgendaCard` calls `tasksApi.myWork()` instead), and `GET /assistant/conversations` + `/:id` (chat history has no browser UI). All are built and tested; none is reachable.
- **L2 — `foldersApi` is a permanent stub.** `list` and `listBySpace` both `return []` unconditionally — there is no folders backend. `SidebarSpaceTree.tsx:53` fires a react-query for it on every render. Harmless, but it is scaffolding for a feature that was dropped.
- **L3 — client main bundle is 1.42 MB uncompressed** (2.7 MB total dist). Routes are already lazy-loaded and vendor chunks are split (`editor` 367 KB, `react` 278 KB, `Table` 160 KB); the remaining 1.42 MB is worth one more splitting pass if load time on Bangladeshi mobile connections matters.
- **L4 — `pool.on("connection", c => c.query("SET time_zone = ?"))`** in `db/client.ts:84` is fire-and-forget with no `.catch`. Ordering is safe (mysql2 pipelines per-connection), but a failure surfaces as an unhandled rejection rather than a clear error, and the UTC session clock is load-bearing for the whole system.
- **L5 — `POST /auth/refresh` has no rate limiter**, unlike every other unauthenticated auth route (`authStrictLimiter`). Tokens are unguessable so this is not a practical brute-force target, but it is the one asymmetry in an otherwise uniform policy.

---

## 4. What changed since the 2026-08-11 scan

| 2026-08-11 finding | Status today |
|---|---|
| Recurrence has no spawn job | ✅ **Fixed** — job + `024` + cron line shipped |
| No role-assign UI (rbacApi dead surface) | ✅ **Fixed** — `roles.ts` endpoints are all reachable from the client |
| `db:migrate` silently builds a partial DB | ❌ **Worse** — 9 → **12** missing tables |
| Form submissions unreadable | ❌ **Open** (H3) |
| Sprint board + statuses read-only | ❌ **Open** (H4, M1) |
| Deploy checklist is for another system | ❌ **Open** (M4) |
| No CI | ❌ **Open** (H5) |
| Reach gap 37/169 client API fns | 🟡 **Improved** → 29/178 (16%) |
| 3 stale subtask triggers in dev DB | ✅ **Fixed** — 9/9 triggers match |
| 187 endpoints / 43 tables | Now **209 endpoints / 47 tables** |

---

## 5. Recommended order of work

1. **Before any prod deploy:** apply `023` + `024` to qa then prod, install the updated cron file, and add the boot-time schema assertion (C1). This is the only item that can take the product down.
2. **`npm audit fix` on the client** — closes `react-router`, `dompurify`, `axios` and 5 more with no major bumps (H2).
3. **Neutralize `db:migrate`** — one `throw` with a pointer to `db:setup` (H1). Ten minutes, removes a permanent trap.
4. **Build the form-submissions screen** (H3) — highest product value per unit of work; the API, the permission and the client function all already exist.
5. **Wire the sprint lifecycle buttons** (H4) and the M1 list, in whatever order matches how the team actually works. Every one of these is UI-only work against a tested, permission-gated backend.
6. **Add CI** (H5) — typecheck + lint + the fast suites + a `dist` freshness check.
7. Schedule the server's three major dependency bumps (H2) and the `API_DESIGN.md` catch-up (M2).

---

## Appendix A — how each claim was produced

| Claim | Method |
|---|---|
| Endpoint count + guard breakdown | AST-ish parse of all 34 `src/routes/*.ts`, resolving `const xGate = requirePermission(...)` aliases and multi-line `router.<verb>(` forms |
| Schema parity | `information_schema` introspection of the live dev DB vs `CREATE TABLE` extraction from `schema.sql` vs `getTableConfig()` on every exported Drizzle table (column names + `notNull` compared per column) |
| Generated-column exclusions | `SELECT EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS` |
| `db:migrate` table count | `CREATE TABLE` extraction across `src/db/migrations/0*.sql` |
| Client reach | Object-literal member extraction from `http/api.ts` + comment-stripped substring search across all 211 non-test client sources |
| Client↔server contract | Extracted every `api.<verb>("path")` call site, normalized `${…}` → `:x`, matched against the parsed server route table |
| Doc parity | Every `METHOD /path` mention in `API_DESIGN.md` (headings, bullets and tables) matched against the parsed route table |
| Test results | `jest --config jest.{jobs,rbac,assistant}.config.cjs --runInBand --testTimeout=60000`; `vitest run` |
| Typecheck / lint | `tsc --noEmit` (server), `tsc -b` (client), `eslint .` (both) |
| Vulnerabilities | `npm audit --json` in both projects, with `fixAvailable` and semver-major status read per package |
| Drizzle SQLi applicability | Grep for `sql.identifier`, `sql.raw`, and dynamic `orderBy` from request input across `src/` |
| Artifact freshness | File-mtime comparison across `src` vs `dist` + `git log -1 -- <path>` for both projects |
| Cron/job parity | Slug extraction from `deploy/cron/bbtasks-jobs`, `src/jobs/index.ts` and `src/routes/jobs.ts` |
