# FULL SYSTEM TEST PLAN — phase by phase, toward a signed "0 bugs"

**Created** 2026-08-29 · **Anchor commit** `6d9334a` (local; `origin/main` = `876e9cf`)
**Goal (the user's words):** *"ai system ekdom bugless, errorless, issueless thakte hobe …
frontend backend database api sob kichu … prottekta api valo moto test … kono issue bug jeno
na thake."*

This is the contract for that. It is deliberately split into phases so we run **one phase per
go** — never the whole thing at once. Each phase is a self-contained unit that ends in a written
sign-off, and only a fully green phase unlocks the next. When the last phase signs off, the
sentence *"the task management system has no known bug"* is backed by evidence, not hope.

---

## How each phase works (the loop)

Every phase runs the same four steps, and does not end until step 4 is clean:

1. **TEST** — run the existing suite for this subsystem, then add the NEW tests this plan lists
   (the gaps existing coverage misses: edge cases, cross-user permission probes, live API
   probes, real UI flows). Every endpoint in the phase is exercised at least once.
2. **FIND** — record every failure, wrong answer, 5xx, leak, crash, or dead-end. Nothing is
   waved through. A test that "passes but asserts the wrong thing" counts as a finding.
3. **FIX** — fix each finding **in this phase**, at its root, and add or correct the test that
   proves the fix. (This is the mode the user chose: test → fix → re-verify, not test-then-defer.)
4. **SIGN OFF** — re-run the whole phase suite; it must be 100% green. Then fill in the phase's
   **Execution record** at the bottom of this file with: what ran, counts, what was found, what
   was fixed, and the exact command to reproduce green. A phase with any red or any unexplained
   skip is NOT signed off.

**Rules that override convenience:**
- A finding is not "closed" by deleting the test. It is closed by fixing the product or by
  proving (in writing) the test asserted something false.
- If a fix in phase N would touch code owned by a later phase, note it and keep the change
  minimal; the later phase re-verifies it in full.
- Certification at the end (Phase 12) is allowed to say "0 bugs" **only** if every earlier phase
  is signed off AND its listed open-issue items are either fixed or explicitly accepted by the
  user as out of scope.

---

## Operating rules & known traps (read before running anything)

These are paid-for lessons. Ignoring one turns a green run into a false green.

- **Per-module jest, never the root config.** `npm test` (root) uses `--all` and reports FALSE
  failures from cross-suite DB collisions. Truth lives in the 33 `jest.<module>.config.cjs`
  files, each on its own private DB. Judge per module. (Phase 0 builds one honest aggregate.)
- **Never two jest runs on the SAME private DB concurrently.** Parallelize across modules only
  if each has its own DB name. The assistant `eval` and `role-matrix` harnesses in particular
  **must never run in parallel** with each other.
- **SSE ⇒ never `waitUntil: "networkidle"`** in Playwright. The inbox stream never goes idle;
  the test hangs to timeout. Wait on a concrete element instead.
- **Dev mail is `live.smtp.mailtrap.io` = REAL delivery.** NEVER run a test that emails an
  `@beautybooth.com.bd` user (assignment, mention, invite, reset, report). Use
  `owner@company.local` / disposable local accounts, or assert the outbox was *called* with the
  mail service stubbed. Every mutating Playwright spec is on this danger list.
- **The dev DB baseline is 47 tasks / 6 spaces / 9 comments / 27 notifications.** Any phase that
  writes to it restores this baseline before sign-off (delete fixture rows in FK order:
  notifications → tasks → lists → spaces). A phase that leaves the DB dirty is not signed off.
- **Load the PRODUCTION bundle before certifying UI.** Two crashes in the mobile work existed
  only in a prod build and never in the dev server. `client/playwright.config.ts` takes
  `E2E_BASE_URL` — serve `client/dist` behind a static+`/api` proxy and point the net at it.
- **Always `--list` a Playwright spec after editing it.** The ratchet cannot see a test that an
  edit accidentally deleted; `--list` proves the count.
- **`tsx watch`, not `nodemon`.** nodemon serves stale `.ts`; a "fix that didn't work" is often
  a server that never reloaded. Kill a stuck `:5501` via PowerShell `Get-NetTCPConnection`, not
  `pkill` (which misses it).
- **camelCase interceptor + decamelize request interceptor**: the wire is snake_case, the client
  sends/receives camelCase. A raw `curl` probe uses snake_case bodies (`user_ids`, not
  `userIds`). Mixing them up produces false 422s.
- **`DB_TIMEZONE=+00:00`**: raw SQL timestamps look 6h off unless the session sets
  `SET time_zone='+00:00'` first. Not corruption.

---

## The subsystem map this plan covers (nothing may be left out)

- **209 API endpoints** across 35 route files — every one gets at least: happy path, an auth/permission
  denial, and one malformed-input rejection.
- **47 DB tables**, 25 upgrade scripts, 9 cron jobs.
- **Client**: 193 API methods, 37 routes, ~35 currently called by no component (Phase 11 decides
  each: truly dead, or a reachable dead-end to wire/remove).
- **Existing tests**: 199 server files under 33 configs (~4,336 green, 4 known-red) + 7 client
  vitest files + 19 Playwright specs + the assistant `eval` and `role-matrix` harnesses.

---

## Phase ledger (check off as signed)

| # | Phase | Scope in one line | Status |
|---|-------|-------------------|--------|
| 0 | **Foundation & honest gate** | fix the 4 known-red, build a single green-run command, record every baseline | ☐ not started |
| 1 | **Auth & session** | 10 auth endpoints; token/refresh/logout lifecycle; password rules | ☐ |
| 2 | **RBAC & permissions** | 56-perm catalog, roles CRUD + the role-ASSIGN half, every role × endpoint = right answer | ☐ |
| 3 | **Workspace · spaces · lists · teams** | org structure, membership, visibility grants, private spaces | ☐ |
| 4 | **Tasks core** | 18 task endpoints, Assigned By, assignees/watchers/tags, statuses, types, custom fields, views | ☐ |
| 5 | **Task collaboration** | comments (+@mention, +edit), checklists, dependencies, delete-approval, attachments/R2 | ☐ |
| 6 | **Assistant / chatbot** | 3 endpoints + SSE, permission-scoped tools, anti-enumeration, the chat-privacy fix, retention | ☐ |
| 7 | **Engineering specials** | report-bug routing, eng-home leak, sprints, on-call, SLA | ☐ |
| 8 | **Notifications · email · push · SSE** | the whole delivery layer, incl. prefs and the once-per-deadline rule | ☐ |
| 9 | **Forms · reports · search · activity · home** | public form + submissions, dept reports, search, activity feed, KPIs | ☐ |
| 10 | **Jobs & scheduled work** | 9 cron jobs — idempotency, once-per-X, recurrence spawn | ☐ |
| 11 | **Frontend integration & E2E** | 19 Playwright specs, the 35 dead APIs, mobile net, desktop guard, prod-bundle console sweep | ☐ |
| 12 | **Production readiness & certification** | CORS, R2, deps, perf, timezone, deploy prompt — then sign the final "0 bugs" | ☐ |

---

## Standing open issues to fold in (from SYSTEM_SCAN_2026-08-25 + since)

Each is tagged with the phase that owns it. A phase is not signed off while its owned items are
open (unless the user accepts one as out of scope).

- **Phase 0**: 4 stale asserts in `lists/list-all` + `list-by-space` (pre-F23 contract);
  `jest.tagscheck` reset list omits `password_reset_tokens`.
- **Phase 2**: whole role-ASSIGN half of RBAC has no UI (`rbacApi.assign/revoke/assignmentsFor/
  holders/spaceMembers/updateRole` dead); `task.view` scope `own` offered by the roles UI but
  never narrows reads (S4); demo RBAC accounts (`guest@`, `marketing.only@`, `cs.only@`) missing
  — permission QA can't run without them (F4, one command).
- **Phase 4**: client never sends `If-Match` — task PATCH is last-write-wins (S3); `db:seed:demo`
  doesn't fill `tasks.assigned_by` (reseed tests the fallback, not the column).
- **Phase 5**: comment-**edit** and form-**submissions** views are the two dead-ends people will
  actually hit; `checklists.bulkAddItems`, `spaces.delete/unarchive`, `lists.unarchive` dead.
- **Phase 6**: chat kept forever in plaintext — no retention job, no delete, no history UI
  (F2); **2,197 conversations / 4,393 messages** in dev already. (The cross-user *leak* is
  fixed at `6d9334a`; this is the retention half.)
- **Phase 7**: `/eng/home` leaks Engineering's open-bug count to every workspace member —
  `openCountAndTopByType` has no scope filter (F3, one line + a test); `onCallApi.delete` +
  `sprintsApi.active/getById` dead.
- **Phase 8**: notification-prefs, watch/unwatch, and `logout-all` reachable in the API but not
  the UI.
- **Phase 11**: eager `TaskRedirect` drags TipTap into the entry bundle → real first load
  ≈670 KB gz (lazy-load it); `/forms` reachable only by typed URL; `useAssignmentRequests.ts:100`
  genuine rules-of-hooks violation.
- **Phase 12**: CORS reflects any private-LAN origin in prod, no env gate (S1); R2 unconfigured
  in prod = silent upload loss, `/health/ready` checks only the DB (S2); hardcoded `dhakaToday()`
  ×11 (S5, latent single-tz); 2 redundant indexes (S6); server deps 1 critical + 9 high, client
  8 high (`npm audit fix` away); no CI, no single green-test command, `npm run dev` still nodemon;
  the regenerated deploy prompt (`DEPLOY_PROMPT_2026-08-29.md`) needs a live-canary dry-run.

---

# PHASE 0 — Foundation & honest gate

**Why first:** you cannot certify "0 bugs" on a suite that already has 4 red tests and no way to
run everything with one command. This phase makes the measuring instrument trustworthy.

**Do:**
1. Fix the 4 stale lists-read asserts to the post-F23 contract (100-row default cap + cursor
   validation, `ListController.ts:108-110,160-162`); update the stale doc comments at
   `ListController.ts:75,125`; give `list-all.test.ts` + `list-by-space.test.ts` a per-module
   config so a gate actually runs them.
2. Fix `jest.tagscheck.config.js`'s table-reset list to include `password_reset_tokens` (or
   delete the throwaway runner — its sibling is already marked safe to delete).
3. Write **one aggregate test command** that runs all 33 module configs (+ the two new list
   configs) sequentially with per-module private DBs, plus client `vitest run`, and prints a
   single pass/fail summary. This becomes the phase gate for every later phase.
4. Record baselines in the execution record: server tsc `--noEmit` (clean), client `tsc -b`
   (clean), server eslint (**70** today), client eslint (**16**: 12 err + 4 warn), full suite
   counts.

**New tests:** none yet — this phase makes the harness honest.

**Gate:** the aggregate command prints **all green** (target 4,340/4,340, up from 4,336), tsc
clean both sides, eslint at or below the recorded baseline. Dev DB at baseline.

---

# PHASE 1 — Auth & session

**Endpoints (10):** `POST /login`, `/forgot-password`, `/reset-password`, `/refresh`, `/logout`,
`/logout-all`, `/change-password`, `/accept-invitation`; `GET /me`, `/invitation/:token`.

**Existing:** `jest.auth.config.cjs` (341), `e2e/auth.pw.ts`, `e2e/profile.pw.ts`.

**New tests to add:**
- Access-token expiry → interceptor refresh → retry-once succeeds; a second failure logs out
  cleanly (no double-POST of credentials, no session nuke of a still-valid user — H4).
- `logout-all` invalidates every device's refresh cookie (live: two tokens, one `logout-all`,
  the other's `/me` now 401).
- Password policy is exactly the 4 visible rules (8+ / A-Z / digit / symbol) and the server +
  client rule files still mirror each other — no hidden blocklist.
- forgot-password on an unknown email returns the same shape/timing as a known one (no user
  enumeration); the reset token is single-use and expires.
- accept-invitation with an expired/used/foreign token fails with a clear 4xx, not a 500.
- `/me` reflects role/status changes on the next call after an admin edit.

**Gate:** all auth tests green; every one of the 10 endpoints has happy-path + denial + malformed
coverage; no real email left the box (assert via stub/outbox).

---

# PHASE 2 — RBAC & permissions (the security core)

**Endpoints:** roles (11), `GET /me/permissions`, `GET /users/:id/roles`, `POST /users/:id/roles`,
`DELETE /users/:id/roles/:assignmentId`, `GET /spaces/:id/members`.

**Existing:** `jest.rbac.config.cjs` (346), `e2e/team-access.pw.ts`, plus the
`assistant-role-matrix.cjs` probe.

**New tests to add:**
- **The full role × endpoint matrix**: for every seeded role (owner, admin, member, guest, and
  the space-scoped custom roles) hit every one of the 209 endpoints and assert **no 5xx** and the
  *correct* verdict (200/201 where allowed, 403 where not, 404 for anti-enumeration where a
  foreign resource must look absent). This is the single most important test in the whole plan.
- The role-**assign** half (`POST/DELETE /users/:id/roles`, `roles/:id/holders`): grant a role,
  prove the grantee's `/me/permissions` changes, revoke, prove it reverts. (These endpoints work
  server-side but have no UI — Phase 11 decides the UI; Phase 2 proves the API.)
- `task.view` scope `own`/`space`/`all`: prove `space` actually narrows reads (it does — keep the
  proof), and confirm whether `own` narrows anything (S4 — the roles UI offers it; if it is
  decorative, the test documents that and the UI must stop offering it or the scope must bite).
- Repo-layer ALS scoping is load-bearing: a member of space A cannot read a task in private
  space B by direct id (404, not 403-with-leak).
- **F4**: recreate the demo RBAC accounts (`npx tsx scripts/demo-role-accounts.ts`) so this matrix
  can run at all; assert they exist and hold the documented permissions.

**Gate:** the role × endpoint matrix is 100% clean (0 unexpected 5xx, 0 wrong verdicts); the
role-assign lifecycle proven; demo accounts restored. This is the phase that most directly earns
"no permission bug".

---

# PHASE 3 — Workspace · spaces · lists · teams

**Endpoints:** spaces (9), lists (9), teams (6), workspace (2).

**Existing:** `jest.spaces.config.cjs` (250), `jest.lists.config.cjs`, `jest.membership.config.cjs`,
`jest.deptreview.config.cjs` (122 — overlaps head/membership), `e2e/sidebar-structure.pw.ts`.

**New tests to add:**
- Space head assignment (used by report-bug routing and dept reports) — set, clear, and the
  active-user filter.
- Visibility grants (team-access P4): a grant makes another team's tasks visible read-only; revoke
  removes it; the grant never confers write.
- Private space (`is_private`) behaviour — confirm it is decorative-by-design (documented) OR
  enforced, and the test states which; a non-member's direct-id read is 404.
- List archive/unarchive/delete lifecycle; a deleted list's tasks (FK `ON DELETE RESTRICT` —
  delete must be blocked while tasks exist, not cascade-destroy them).
- `PATCH /users/:id/team` reassigns primary team and the assignee picker's "your team" grouping
  follows.
- Membership add/remove and its effect on task visibility.

**Gate:** all structural suites green; every space/list/team endpoint covered; FK delete-guard
proven (no accidental cascade of task data).

---

# PHASE 4 — Tasks core (the heart)

**Endpoints:** tasks (18), statuses (5), taskTypes (4), customFields (7).

**Existing:** `jest.tasks.config.cjs` + `jest.tasks10.config.cjs` (**413, run twice on two DBs**),
`jest.statuses`, `jest.taskTypes`, `jest.customfields`, `e2e/tasks-views.pw.ts`,
`e2e/assignee-picker.pw.ts` (4 — new this session).

**New tests to add:**
- **Assigned By** end-to-end at every surface: create defaults `assigned_by` to the creator; the
  column is written (not just the fallback); the serializer feeds every view; editing it (P5 of
  that plan, if built) records history. **Reseed then run the backfill** so the column — not the
  `created_by` fallback — is what's tested (the seed gap).
- **Assignee = active-only + the leak fix** (this session): the picker offers only active people;
  the server 422s an inactive assignee; the ListView row's assignee change actually persists (it
  used to send a `PATCH` the API refuses); the "Me" button toggles.
- **Optimistic concurrency (S3)**: two clients PATCH the same task; today it is last-write-wins
  (no `If-Match`). Decide with the user: accept as documented, or add `If-Match`/version. The test
  pins whichever is chosen so it can't regress silently.
- Every task sub-action: assignees add/remove, watchers self add/remove, tags add/remove, review,
  archive/unarchive, delete (= archive), bulk update, subtasks, activity, dependencies-read.
- Views: List/Board/Calendar render the COMPLETE task list (the H1 pagination fix — follow
  `next_cursor` to exhaustion, never the oldest 50); filters (status/person/priority/date presets)
  narrow correctly on each view.
- Custom fields: create/edit/delete a field, set/clear a value, workspace-scoped field doesn't
  bleed onto unrelated tasks.
- Status reorder, status group semantics (not_started/active/done), and SLA/severity fields on Bug
  tasks.

**Gate:** tasks suites green on both private DBs; Assigned By proven at the column level; the
assignee leak fix proven; concurrency behaviour pinned; every task endpoint covered.

---

# PHASE 5 — Task collaboration

**Endpoints:** comments (4), checklists (9), taskDependencies (3), taskDeleteRequests (6),
attachments (6).

**Existing:** `jest.collab.config.cjs`, `jest.attachments.config.cjs`, `jest.taskdeps.config.cjs`,
`e2e/forms-search-inbox.pw.ts` (mentions deep-link).

**New tests to add:**
- **@mentions**: picker inserts a mention; the mentioned user gets an in-app notification + email +
  push; editing a comment notifies only NEWLY-added mentions. ⚠️ mention emails are REAL — stub or
  use local accounts only.
- **Comment edit** (`PATCH /comments/:id`): the API works; confirm whether any UI reaches it (dead
  function — Phase 11 wires or the plan says "API-only, accepted").
- Checklists: add/toggle/reorder/delete items, bulk-add, the per-list counter stays correct.
- Task dependencies: create a blocks/blocked-by edge, the cycle guard rejects a loop, delete an
  edge; a dependent task's state reflects its blocker.
- **Delete-approval flow (upgrade 023)**: a member requests permanent delete → Owner/Admin
  approve/reject → the task is actually gone on approve, restored/kept on reject; the two-step
  archive→unarchive→delete-request path; a non-approver cannot approve.
- Attachments: sign → finalize → download → delete; an unfinalized upload is janitored; **R2
  unconfigured must fail loudly, not silently lose the file** (ties to S2).

**Gate:** all collaboration suites green; the delete-approval state machine proven end to end; no
real mention email sent; attachment lifecycle incl. the R2-missing failure mode covered.

---

# PHASE 6 — Assistant / chatbot

**Endpoints:** `POST /chat` (+ SSE stream), `GET /conversations`, `GET /conversations/:id`.

**Existing:** `jest.assistant.config.cjs` (270), `e2e/assistant.pw.ts`,
`e2e/assistant-privacy.pw.ts` (3 — new this session), `scripts/assistant-eval.cjs` (needs live
stack + paid OpenAI), `scripts/assistant-role-matrix.cjs`.

**New tests to add:**
- **Cross-user privacy (this session's fix)**: a foreign conversation and an owner-less
  conversation are both dropped from localStorage on the next sign-in; your own survives a reload;
  the server 404s a foreign conversation id and starts a fresh thread rather than appending.
  (`assistant-privacy.pw.ts` — extend if any surface still shows another user's text.)
- **Permission-scoped tools**: `get_person_tasks` / `get_team_stats` answer only within the
  asker's view; a person or team outside that view is a plain "not found" (anti-enumeration, no
  leak); the SQL scoping (the load-bearing ALS layer) holds under a member, a guest, and a
  space-scoped role.
- **Bangla-script + link-repair** invariants from the deep plan (deterministic link repair, no
  invented "no tasks").
- Run `assistant-eval.cjs --assert` against the live stack (17/17 the last time) and the
  role-matrix (ALL-PASS) — **never in parallel**, exit codes piped.
- **Retention (F2)**: this is the open half. Decide with the user — build a `chat-retention` cron
  job + a clear-my-history action, then test both; or accept plaintext-forever in writing. The
  phase does not sign off on "issueless" while 2,197 conversations sit un-deletable unless the
  user accepts it.

**Gate:** privacy specs green; the tool-scoping matrix clean; eval + role-matrix pass; retention
either shipped-and-tested or explicitly accepted by the user.

---

# PHASE 7 — Engineering specials

**Endpoints:** engineering (4), sprints (11), onCall (4), sla (2).

**Existing:** `jest.eng.config.cjs` (report-bug 44 — new routing this session; home 16; postmortem
23), `jest.sprints.config.cjs`, `jest.oncall.config.cjs` (81), `jest.sla.config.cjs`,
`e2e/settings-eng.pw.ts`.

**New tests to add:**
- **Report-bug routing (this session's fix)**: S0/S1 → on-call; everything else → Engineering
  space head; lapsed-rota S0 → head; neither → filed + `eng.report_bug.unrouted` warning. Already
  44/44 — keep and extend with the "no Bug type / no Bug Triage list = 409 with a legible message"
  case (the literal "nobody can report" on a misconfigured workspace).
- **F3 — the `/eng/home` leak**: add `listScopeFilter` to `openCountAndTopByType` so a non-Eng
  member sees `count=0`, not `count=2`-with-0-previews. Live-probe as owner vs Marketing vs CS to
  prove the fix (the inconsistency is currently visible).
- Sprints: create/start/close, add/remove tasks, active-sprint resolution, story points roll-up;
  `sprintsApi.active/getById` are dead in the client (Phase 11 decides).
- On-call: assign a week, `GET /current` resolves it, clear a week (`DELETE /:weekStart` — dead in
  client), the rota-lapse case that broke report-bug.
- SLA: breach detection on the business clock (F28), `PATCH /tasks/:id/sla`.

**Gate:** eng suites green; the eng-home leak closed and proven; report-bug routing + misconfig
case covered; sprint/on-call/SLA lifecycles proven.

---

# PHASE 8 — Notifications · email · push · SSE

**Endpoints:** notifications (9), push (3), sse (1).

**Existing:** `jest.notifications.config.cjs`, `jest.sse.config.cjs`, plus email covered inside
task/eng/collab suites.

**New tests to add:**
- Notification lifecycle: create on assign/mention/status/overdue; mark read/unread/all-read;
  snooze → wake; delete; unread-count accuracy.
- Notification **preferences** (`GET/PUT /preferences`): a muted channel actually suppresses that
  channel; prefs UI is a dead function (Phase 11).
- Email: assignment email fires post-commit; overdue-alert fires once per deadline (not every
  run); mention email on add-only; report email weekly. ⚠️ ALL real-delivery — stub the mail
  service and assert it was *called*, never let it actually send to staff.
- Web push: subscribe → receive → the shared-computer teardown (a logout drops THIS device's
  subscription so the next person isn't pushed the previous account's tasks); VAPID withheld under
  `NODE_ENV=test`.
- SSE inbox stream: a new notification pushes a live event; the stream survives reconnect;
  ⚠️ never assert on networkidle.

**Gate:** delivery suites green; once-per-deadline proven; no real email/push sent to staff;
SSE live-update proven without a networkidle hang.

---

# PHASE 9 — Forms · reports · search · activity · home

**Endpoints:** forms (13), reports (5), search (1), workspaceActivity (2), home (2).

**Existing:** `jest.forms.config.cjs` (85), `jest.search.config.cjs`, `jest.home.config.cjs`,
`jest.workspaceActivity.config.cjs`, `jest.deptreview.config.cjs`, `e2e/forms.pw.ts`,
`e2e/forms-search-inbox.pw.ts`.

**New tests to add:**
- **Public form** (customer-facing, unauthenticated): `GET /public/forms/:slug` renders;
  `POST /public/forms/:slug/submit` creates a task; validation (BD phone, required fields) rejects
  cleanly; a submission notifies the owning team; field encryption (upgrade 005) round-trips.
- **Form submissions view** (`GET /forms/:id/submissions`) — the API works; it's a client
  dead-end (Phase 11 wires or accepts).
- Reports: generate a dept report, ack it, the weekly Mon-09:00-Dhaka schedule; a head sees only
  their department.
- Search: results are permission-scoped (a member can't find a task in a space they can't see);
  ranking/pagination.
- Activity feed: actor-hydrated, workspace-scoped, newest first.
- Home KPIs + agenda: the numbers match SQL truth for the calling user (my open / due today /
  overdue / awaiting review / team / SLA breaches).

**Gate:** all read/reporting suites green; the public form (the only unauthenticated surface)
hardened; search scoping proven; KPI numbers reconciled against SQL.

---

# PHASE 10 — Jobs & scheduled work

**Endpoints:** jobs (9 POST triggers) + the cron registry.

**Existing:** `jest.jobs.config.cjs` (54).

**New tests to add (each job, idempotency-first):**
- `recurrence-spawn`: spawns the next dated copy once per `*/15` window; a clean dated copy,
  nothing carried over; re-running the same window spawns nothing (idempotent).
- `overdue-alert`: once per task per deadline, not every `*/10` run.
- `session-cleanup`, `assignment-request-expiry`, `form-submission-expiry`, `snooze-wake`,
  `attachment-janitor`, `r2-purge`, `department-report`: each does its job exactly once, is safe
  to re-run, and no-ops on an empty set.
- The cron file (`deploy/cron/bbtasks-jobs`) lists every job that has a runtime need, and each
  line's `run-job.sh <name> --dry-run` returns `ok:true`.

**Gate:** every job proven idempotent and correctly gated; the cron file complete; no job double-acts.

---

# PHASE 11 — Frontend integration & E2E

**Existing:** 19 Playwright specs, the mobile net (26/26), the desktop guard, client vitest (7).

**Do:**
- Run the full Playwright suite against the DEV stack, then the read-only subset against a served
  **prod bundle** (`E2E_BASE_URL`) — console-error sweep must be clean on the prod build (catches
  the prod-only crash class).
- **Triage all ~35 uncalled client APIs**: for each, decide — (a) truly dead → remove, or (b) a
  reachable dead-end users hit → wire a UI or file it as accepted. Priority: comment-edit,
  form-submissions, the role-assign set, notification prefs.
- Fix `useAssignmentRequests.ts:100` (genuine rules-of-hooks violation).
- Lazy-load `TaskRedirect` → drop TipTap out of the entry bundle (first-load ≈670→~470 KB gz).
- Wire `/forms` into a menu (currently typed-URL only).
- Mobile net stays 26/26; desktop guard stays green (proves desktop untouched).

**Gate:** full E2E green on dev + prod-bundle console-clean; every dead API resolved (removed,
wired, or accepted in writing); mobile 26/26; desktop guard green; client tsc + eslint at/below
baseline.

---

# PHASE 12 — Production readiness & certification

**Do (the non-functional sweep):**
- **CORS (S1)**: gate the private-LAN origin reflection behind an env flag so prod doesn't reflect
  arbitrary origins.
- **R2 / readiness (S2)**: `/health/ready` should fail when R2 is unconfigured in prod (today it
  only checks the DB), so a silent upload-loss deploy is caught.
- **Deps**: client `npm audit fix` (8 high, non-breaking); schedule the 3 server majors
  (drizzle-orm, nodemailer, tar-via-bcrypt) behind a green run; record what's accepted.
- **Timezone (S5)**: the 11 `dhakaToday()` sites — latent while single-tz; document or
  parameterize.
- **Indexes (S6)**: drop the 2 redundant indexes.
- **CI & gate**: the Phase-0 aggregate command becomes a CI job; flip `npm run dev` → `tsx watch`.
- **Deploy prompt**: dry-run `DEPLOY_PROMPT_2026-08-29.md`'s canary against a served prod bundle;
  confirm the 025 pre-check + real-canary work.
- **Final regression**: re-run the Phase-0 aggregate one last time — 4,340+/all green — plus the
  full E2E, mobile net, desktop guard.

**Certification (the sign-off the user asked for):** with Phases 0–11 all signed and every owned
open issue either fixed or accepted in writing, record here:

> *As of `<sha>` on `<date>`: the full server suite is N/N green, the client suite M/M, E2E all
> green on both dev and a production bundle, the role × endpoint matrix shows 0 unexpected 5xx and
> 0 wrong verdicts, and every endpoint has happy-path + denial + malformed coverage. Known
> residual items, each accepted by the user: `<list, or "none">`. No open bug is known.*

That sentence is the deliverable. It is only true when every line above it is.

---

# Execution records (filled in as each phase signs off)

> One block per phase. Do not mark the ledger ✅ until this block is written.

### Phase 0 — Foundation & honest gate
- Ran:
- Found:
- Fixed:
- Green command:
- Baselines (tsc / eslint / suite counts):
- DB restored to 47/6/9/27:
- **Signed off:** ☐

### Phase 1 — Auth & session
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 2 — RBAC & permissions
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 3 — Workspace · spaces · lists · teams
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 4 — Tasks core
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 5 — Task collaboration
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 6 — Assistant / chatbot
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 7 — Engineering specials
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 8 — Notifications · email · push · SSE
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 9 — Forms · reports · search · activity · home
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 10 — Jobs & scheduled work
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 11 — Frontend integration & E2E
- Ran / Found / Fixed / Green command / DB restored / **Signed off:** ☐

### Phase 12 — Production readiness & certification
- Ran / Found / Fixed / Green command / DB restored / **Certified:** ☐
