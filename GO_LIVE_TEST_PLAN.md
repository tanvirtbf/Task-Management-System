# GO-LIVE TEST PLAN — BeautyBooth Task Management (astro-app)

**Created:** 2026-07-11 · **Target:** `astro-app/` (Astro 5 + Cloudflare Workers + Turso) — the system going live at beautybooth-tasks.tanver018765.workers.dev
**Goal:** zero known issues at go-live. Every existing functionality verified; every bug found → fixed → re-verified. No new features — only bug fixes and restoring intended-but-unwired behavior (e.g. job scheduling per API_DESIGN §28).
**Method:** 48 phases (0–47). Each phase is run ON DEMAND — the user says **"run phase N"** and only that phase executes. No phase is skipped; the final gate (Phase 47) requires all 46 prior phases green.

---

## How a phase runs (protocol — applies to every phase)

1. **Preconditions:** test environment up (see Phase 0), `npm run dev` in `astro-app/` serving http://localhost:4321 against the ISOLATED TEST DB (never prod). Login: `owner@company.local` / `Owner@12345`; demo users all `Test@12345`.
2. **Execute:** API tests via curl/scripts (scratchpad, throwaway); UI spot-checks via Playwright/Chrome where the feature has UI. Cover: happy path → validation errors → authz (each role) → workspace/user isolation → edge cases → regression checks listed in the phase.
3. **Log:** results appended to `GO_LIVE_TEST_LOG.md` (created on first phase run): phase header, cases run, issues found with severity (BLOCKER / HIGH / MEDIUM / LOW), root cause, fix commit, re-verify result.
4. **Fix-in-phase:** every issue found is fixed immediately (astro-app code; if the same bug exists in `server/` note it in the log), then the failing case + the phase's critical cases re-run.
5. **Cross-phase regression rule:** if a fix touches shared code (shim, middleware, db client, serializers), re-run the quick checks of already-passed phases that share it (listed in the log entry).
6. **Status:** flip the phase's ⬜ → ✅ in the table below only when the phase exits clean.

**Severity gate:** BLOCKER/HIGH must be fixed in-phase. MEDIUM fixed in-phase unless it needs a product decision (then logged as OPEN-DECISION). LOW may be batched but must be closed before Phase 47.

---

## ⚠️ CRITICAL — environment isolation (read before Phase 0)

`astro-app/.dev.vars` almost certainly points at the **PRODUCTION** Turso DB (prod secrets were generated FROM `.dev.vars` by `scripts/make-secrets.mjs`). Running destructive tests against local dev **without isolation would mutate the live DB**. Phase 0 creates a dedicated **TEST database** and swaps `.dev.vars` (with backup). No test phase may run before Phase 0 is green.

---

## Phase status

| # | Phase | Stage | Status |
|---|-------|-------|--------|
| 0 | Test environment isolation & baseline | A Foundation | ✅ 2026-07-11 |
| 1 | Health, diagnostics & boot | A Foundation | ✅ 2026-07-11 |
| 2 | Auth — login, sessions, refresh rotation | B Identity | ✅ 2026-07-11 |
| 3 | Auth — password flows (forgot/reset/change) | B Identity | ✅ 2026-07-11 (P3-1 email-quota open) |
| 4 | Auth — invitations lifecycle | B Identity | ✅ 2026-07-11 (P4-1 resend open) |
| 5 | Users, roles & member administration | B Identity | ✅ 2026-07-11 |
| 6 | Workspace settings | C Structure | ✅ 2026-07-11 |
| 7 | Spaces | C Structure | ✅ 2026-07-11 |
| 8 | Lists | C Structure | ✅ 2026-07-11 |
| 9 | Statuses & reorder | C Structure | ✅ 2026-07-11 |
| 10 | Task types | C Structure | ✅ 2026-07-11 |
| 11 | Tags | C Structure | ✅ 2026-07-11 |
| 12 | Tasks — create & read | D Tasks core | ✅ 2026-07-11 (P12-1 fixed) |
| 13 | Tasks — update, lifecycle, archive/delete | D Tasks core | ✅ 2026-07-11 (P13-2/3 fixed, P13-1 open) |
| 14 | Assignees & watchers | D Tasks core | ✅ 2026-07-11 |
| 15 | Task tags & dependencies | D Tasks core | ✅ 2026-07-11 |
| 16 | Task activity feed | D Tasks core | ✅ 2026-07-11 |
| 17 | Comments | E Task content | ✅ 2026-07-11 |
| 18 | Checklists & items | E Task content | ✅ 2026-07-11 |
| 19 | Custom fields — definitions & options | E Task content | ✅ 2026-07-11 (P19-1 open) |
| 20 | Custom fields — values on tasks | E Task content | ✅ 2026-07-11 (P20-1 drift) |
| 21 | Attachments — R2 presigned flow | E Task content | ✅ 2026-07-11 (real bytes→P46) |
| 22 | Attachments — proxied upload & janitor | E Task content | ✅ 2026-07-11 |
| 23 | Forms — builder (forms & fields) | F Forms/Templates | ✅ 2026-07-11 |
| 24 | Public form — render, submit, encryption | F Forms/Templates | ✅ 2026-07-11 (P24-1 note) |
| 25 | Submissions view & 90-day retention | F Forms/Templates | ✅ 2026-07-11 (P25-1 fixed) |
| 26 | Templates & apply | F Forms/Templates | ✅ 2026-07-11 |
| 27 | Sprints lifecycle | G Engineering | ✅ 2026-07-11 |
| 28 | Engineering specials (bug, home, postmortem) | G Engineering | ✅ 2026-07-11 (P28-1 setup) |
| 29 | On-call rotation | G Engineering | ✅ 2026-07-11 |
| 30 | SLA (breached list & override) | G Engineering | ✅ 2026-07-11 |
| 31 | Notifications — inbox & preferences | H Notifications | ✅ |
| 32 | Notifications — generation rules matrix | H Notifications | ✅ 2026-07-13 (P32-A/B/C/D + due/overdue gap) |
| 33 | SSE & streaming realtime | H Notifications | ✅ 2026-07-13 (workerd re-verify → P46) |
| 34 | Search | I Discovery | ✅ 2026-07-13 |
| 35 | Home dashboard (KPIs & agenda) | I Discovery | ✅ 2026-07-13 (P35-1 tz open) |
| 36 | Workspace activity feed | I Discovery | ✅ 2026-07-13 |
| 37 | AI assistant | I Discovery | ✅ 2026-07-13 (built+working, real gpt-4o-mini) |
| 38 | Background jobs + cron wiring (pre-live fix) | J Cross-cutting | ✅ 2026-07-13 (5 jobs + scheduler BUILT & workerd-verified; deploy→P46) |
| 39 | Security sweep (authz, isolation, limits, XSS) | J Cross-cutting | ✅ 2026-07-13 (2 shim bugs fixed; P39-3 headers→gate) |
| 40 | Browser E2E — auth journeys | K Browser | ✅ 2026-07-13 (Playwright, 10/10; P40-1 branding) |
| 41 | Browser E2E — shell & navigation | K Browser | ✅ 2026-07-13 (20 routes clean; P41-1 ⌘K) |
| 42 | Browser E2E — task views (List/Board/Calendar) | K Browser | ✅ 2026-07-13 (21/21, DnD persists) |
| 43 | Browser E2E — task drawer deep interaction | K Browser | ✅ 2026-07-13 (21/21, XSS SAFE) |
| 44 | Browser E2E — settings (all 9 tabs) | K Browser | ✅ 2026-07-14 (20/20; P44-1 export honesty) |
| 45 | Browser E2E — forms, engineering, inbox, search, home | K Browser | ✅ 2026-07-14 (15/15; P45-1 SSE-unused, P27-1) |
| 46 | Production (deployed worker) verification | L Final | ✅ 2026-07-14 (read+R2 done; cron/deploy→P47; P46-1/2/3) |
| 47 | Final regression & go-live gate | L Final | ✅ 2026-07-14 (regression green; verdict: functionally-ready, deploy+cleanup blockers remain) |

---

# STAGE A — FOUNDATION

## Phase 0 — Test environment isolation & baseline
**Scope:** safe, repeatable test environment; no production data at risk.
**Do:**
- Prove/disprove that `.dev.vars` DB == prod DB (create one marker row via local API, check its visibility via the deployed API, then delete the marker).
- Create a dedicated **TEST Turso DB**. Preferred: install Turso CLI + `turso auth login` + `turso db create beautybooth-test` + token. Fallback: user creates DB in Turso dashboard and supplies URL + token (the ONLY credential possibly needed in this whole plan). Last-resort fallback: local `sqld` in Docker.
- Backup `.dev.vars` → `.dev.vars.prod.bak`; swap `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` to the test DB. Document restore step in the log.
- Provision schema: `npm run db:push` → `npx tsx scripts/apply-post-sql.ts` (views + 11 triggers) → `npm run db:seed` → `npx tsx scripts/seed-demo.ts` (~1,958 rows, 436 tasks).
- Boot `npm run dev`; baseline smoke: `/health` 200, login owner, GET /spaces returns 6 demo spaces, SPA loads at :4321.
- Tooling ready: curl scripts dir in scratchpad; Playwright reachable (client/ install, v1.60).
**Watch:** `drizzle-kit push` chokes on existing views/triggers — on re-push, drop views+triggers first (known gotcha). `ck_tasks_dates` CHECK when crafting data.
**Exit:** marker test proves prod untouched; test DB fully seeded; smoke green; log file created.

## Phase 1 — Health, diagnostics & boot
**Scope:** `GET /health` (inline), `GET /health/ready`, `GET /health/version`, `GET /metrics`.
**Cover:** liveness 200 no-auth no-DB; ready 200 with DB up + 503 semantics (timeout path); version fields (pkg version, GIT_SHA absent-tolerant, uptime); /metrics Prometheus text format parses, `http_requests_total` & duration histogram increment after traffic, `sse_connections_open` gauge moves in Phase 33; routes are OUTSIDE apiLimiter; request-id header present & propagated to logs.
**Watch:** first-request-after-cold-start 503 on /health/ready (known: Turso ping timeout) — quantify and decide retry/timeout tune.
**Exit:** all 4 endpoints correct incl. error paths; metrics counters verified moving.

# STAGE B — IDENTITY & ACCESS

## Phase 2 — Auth: login, sessions, refresh rotation
**Scope:** POST /auth/login, /auth/refresh, /auth/logout, /auth/logout-all, GET /auth/me.
**Cover:** login happy (owner + demo member); wrong password; unknown email (same error shape — no user enumeration); deactivated user blocked; email case-insensitivity (ciText: `OWNER@COMPANY.LOCAL`); `bb_refresh` cookie flags (httpOnly, path-scoped, signed, Secure behavior w/ FORCE_SECURE); access token TTL honored; refresh rotates the session (old refresh invalid after use); **reuse detection** → all sessions revoked; logout clears cookie + kills session; logout-all kills every session (multi-login test); /auth/me shape & 401 without token; malformed/expired/wrong-signature JWTs → 401 not 500.
**Watch:** PBKDF2 WebCrypto hashes (`pbkdf2$v1$...`) — verify demo users (bcrypt-era seeds should not exist in test DB; all seeded as PBKDF2).
**Exit:** full session lifecycle correct incl. rotation + reuse detection.

## Phase 3 — Auth: password flows
**Scope:** POST /auth/forgot-password, /auth/reset-password, /auth/change-password.
**Cover:** forgot → REAL email lands in Mailtrap inbox (fetch via Mailtrap API/UI) with valid link; unknown email → 200-silent (no enumeration); token single-use; token expiry; invalid/garbage token; reset sets new password + old sessions revoked; change-password: wrong current 422/401, weak password policy, success re-login; rate limiting deferred to Phase 39 (NODE_ENV note).
**Watch:** Mailtrap free-tier rate limit — pace sends; forgot-password lock-ordering deadlock was fixed in old stack (73bd202) — confirm no deadlock/hang under 5 rapid parallel requests here too.
**Exit:** end-to-end reset via real email verified; all edges correct.

## Phase 4 — Auth: invitations lifecycle
**Scope:** POST /users/invite, GET /auth/invitation/:token, POST /auth/accept-invitation.
**Cover:** invite (admin/owner only) → REAL Mailtrap email; invited user row exists with placeholder empty hash + status; invitation GET: valid/expired/consumed/garbage token; accept: sets password, activates, role honored, invitation consumed (second accept fails); re-invite existing active member → proper error; invite deactivated user's email; duplicate pending invite behavior; accepted user can login and sees workspace data.
**Watch:** `INVITED_PLACEHOLDER_HASH=""` rows must never be loginable pre-acceptance.
**Exit:** full invite→accept→login journey incl. every token edge.

## Phase 5 — Users, roles & member administration
**Scope:** GET /users, GET/PATCH /users/:id, PATCH /users/:id/role, POST deactivate/reactivate/reset-password.
**Cover:** list pagination/filters `{data,pagination}` envelope; self profile PATCH (name/avatar fields) vs other-user PATCH (admin only); role change matrix (member↔admin, owner protections — cannot demote/deactivate last owner; member cannot change roles); deactivate → login blocked + existing sessions revoked? (verify actual behavior & assert design intent) + user hidden/flagged in pickers; reactivate restores; admin reset-password forces new password + revokes sessions; each admin endpoint 403 for member role.
**Exit:** role/permission matrix documented & correct; no privilege escalation path.

# STAGE C — WORKSPACE STRUCTURE

## Phase 6 — Workspace settings
**Scope:** GET /workspace, PATCH /workspace.
**Cover:** GET shape (timezone, business hours, week config); PATCH each field with validation (bad tz, start>=end hours, invalid week start); member 403 / admin+owner allowed; `workspace_activity` row written per update; UI Settings→Workspace reflects change without reload artifacts.
**Exit:** all fields update correctly with validation + audit row.

## Phase 7 — Spaces
**Scope:** GET/POST /spaces, GET/PATCH/DELETE /spaces/:id, archive/unarchive.
**Cover:** CRUD happy; duplicate name (ciText) rejected; icon/color validation; archive → space hidden from default list + its lists' behavior defined; unarchive restores; delete rules (with lists/tasks — cascade or block? assert actual + sensible); member vs admin permissions; 404 unknown id; UI sidebar updates.
**Exit:** hierarchy root solid incl. archive semantics.

## Phase 8 — Lists
**Scope:** GET /spaces/:spaceId/lists, GET/POST /lists, GET/PATCH/DELETE /lists/:id, archive/unarchive, GET /lists/:listId/tasks.
**Cover:** create under space (default statuses auto-created? default_task_type honored); rename/move; duplicate name within space; archive/unarchive; delete with tasks; /lists/:listId/tasks — pagination, sort, filters (status, assignee, priority, due), envelope; wrong-space listId isolation; UI list nav + task table render.
**Exit:** list CRUD + task-listing filters all correct.

## Phase 9 — Statuses & reorder
**Scope:** GET/POST /lists/:listId/statuses, PATCH .../reorder, PATCH/DELETE /statuses/:id.
**Cover:** per-list status CRUD; group semantics (todo/in-progress/done buckets); reorder with full + partial + invalid permutations; rename; color; delete a status that has tasks (block or migrate — assert actual); cannot delete last/done status?; cross-list status id isolation; board columns reflect order.
**Exit:** status workflows stable incl. reorder + delete-with-tasks.

## Phase 10 — Task types
**Scope:** GET/POST /task-types, PATCH/DELETE /task-types/:id.
**Cover:** CRUD; system-type protections (cannot delete/rename system + dev types?); icon validation; delete type in use by tasks; engineering dev-type alias behavior (used by SLA/eng modules); duplicate names.
**Exit:** type registry correct incl. protections.

## Phase 11 — Tags
**Scope:** GET/POST /tags, PATCH/DELETE /tags/:id.
**Cover:** CRUD; duplicate name (ci); color validation; delete tag attached to tasks → association removed, tasks intact; long names/emoji; permissions.
**Exit:** tags fully correct.

# STAGE D — TASKS CORE

## Phase 12 — Tasks: create & read
**Scope:** POST /tasks, POST /tasks/bulk, GET /tasks/my-work, GET /tasks/:id, GET /tasks/:id/subtasks.
**Cover:** minimal create (defaults: status, type, position); full create (dates, priority, assignees, tags, parent, sprint, eng fields, SLA); `ck_tasks_dates` (start≤due) rejected cleanly; parent-child (subtask): counters via triggers, deep nesting rules; custom task key `t/:taskKey` resolution (custom_id ciText); bulk create — mixed valid/invalid rows behavior + N+1-fix regression (batched membership ops, ddbcfcc); my-work buckets (assigned to me, due dates) correctness vs seeded data; GET hydration (assignees users, tags, counts, checklist/comment/attachment counters); 404/isolation.
**Exit:** create/read solid; counters match trigger-maintained values exactly.

## Phase 13 — Tasks: update, lifecycle, archive/delete
**Scope:** PATCH /tasks/:id, POST archive/unarchive, DELETE /tasks/:id.
**Cover:** PATCH every field group (title/desc rich text, status→completed_at set/cleared, priority, dates incl. clearing, type change, list move — statuses remap?, sprint assign, position); optimistic concurrency/last-write semantics documented; archive → hidden from lists/board, sub-behavior; unarchive; delete → children/dependencies/attachments/comments cleanup (verify DB rows + R2 objects); activity rows per mutation; **recurrence fields:** set/patch recurrence — then verify actual behavior: NO spawner exists (known gap) — if UI exposes recurrence, either wire the recurrence-spawn job in Phase 38 or hide the UI (OPEN-DECISION logged; user chooses; "existing functionality" = fields exist but never functioned).
**Exit:** full mutation surface correct; deletion leaves zero orphans.

## Phase 14 — Assignees & watchers
**Scope:** POST/DELETE /tasks/:id/assignees(+/:userId), POST/DELETE /tasks/:id/watchers/self.
**Cover:** add/remove single + multiple; duplicate add idempotence; assign deactivated/nonexistent user; assignee auto-watch?; self-watch add/remove; notification generated on assign (not to self-assigner); counters/hydration; permissions (member can assign?).
**Exit:** membership edges + notification side-effects correct.

## Phase 15 — Task tags & dependencies
**Scope:** POST /tasks/:id/tags, DELETE /tasks/:id/tags/:tagId, GET /tasks/:id/dependencies, POST/DELETE /task-dependencies(/:id).
**Cover:** tag attach/detach/duplicate; dependency create blocks/blocked-by; self-dependency rejected (app + DB trigger `RAISE(ABORT)` both fire — test API and direct-SQL); cycle detection (A→B→C→A); duplicate edge; cross-list deps allowed?; delete edge; dependent-task delete cleans edges; hydration both directions.
**Exit:** dependency graph integrity guaranteed at app + DB layer.

## Phase 16 — Task activity feed
**Scope:** GET /tasks/:id/activity.
**Cover:** events recorded for create/status/assign/dates/priority/comment/attachment/checklist mutations (drive each, assert feed); cursor pagination stability (no skips/dupes across pages while new events arrive); actor hydration; isolation; ordering.
**Exit:** feed complete & stable under concurrent writes.

# STAGE E — TASK CONTENT

## Phase 17 — Comments
**Scope:** GET/POST /tasks/:id/comments, PATCH/DELETE /comments/:id.
**Cover:** create (rich text/tiptap JSON), 1-level thread reply (reply-to-reply rejected?); edit own only (author guard), admin/other delete rules; soft-delete display shape; `comments_count` trigger sync on add/delete; pagination; XSS payload in body sanitized on render (DOMPurify regression, P0 fix); mentions if supported → notification (cross-check Phase 32).
**Exit:** comment CRUD + counters + sanitization correct.

## Phase 18 — Checklists & items
**Scope:** GET/POST /tasks/:id/checklists, PATCH/DELETE /checklists/:id, POST items(+/bulk), PATCH /checklist-items/:id, POST toggle, DELETE item.
**Cover:** checklist CRUD; item add single/bulk (bulk partial-invalid behavior); toggle done/undone; item assignee (valid member only — regression 68a5b76: invalid assignee/parent validation); reorder/position; delete cascade; counts on task hydration; UI drawer interactions.
**Exit:** checklists fully correct incl. bulk + validation regressions.

## Phase 19 — Custom fields: definitions & options
**Scope:** GET /custom-fields, GET /lists/:listId/custom-fields, POST /custom-fields, PATCH/DELETE /custom-fields/:id.
**Cover:** create every type (text, number, dropdown, date, phone/BD-phone, checkbox, url... per config enum); scope resolution (list vs space vs workspace) & visibility in /lists/:listId/custom-fields; dropdown options add/rename/delete (option in use by values!); PATCH type-change rules (blocked or migrates); DELETE definition with existing values → values cleaned; **list-scope isolation guard** (P0 fix 8ac32aa regression — field from list A unusable on list B).
**Exit:** definition layer airtight incl. option lifecycle.

## Phase 20 — Custom fields: values on tasks
**Scope:** PUT/DELETE /tasks/:id/custom-fields/:fieldId.
**Cover:** set/overwrite/clear per type with type validation (number rejects text, date format, **BD phone validation**, dropdown requires valid option_id of THAT field); generated-column `option_id` filter query works (filter tasks by dropdown value via list-tasks filters if exposed); wrong-list field rejected; values in task hydration + board/list UI chips.
**Exit:** value layer type-safe + isolated.

## Phase 21 — Attachments: R2 presigned flow
**Scope:** POST /uploads/sign, POST /attachments/:id/finalize, GET /attachments/:id/download, DELETE /attachments/:id, GET /tasks/:id/attachments.
**Cover:** sign → REAL R2 PUT (real bucket, test-prefixed keys) → finalize → row `complete` → download signed GET actually serves bytes (hash-compare) → soft-delete hides + schedules purge; policy: >25MB rejected at sign, disallowed MIME rejected, extension derived from MIME not filename; pending (unfinalized) attachments EXCLUDED from counters (P0 fix regression); list hydration.
**Watch:** test-DB R2 keys must be namespaced (e.g. `test/`) so Phase-38 purge tests can't touch prod objects.
**Exit:** full R2 round-trip verified with real bytes.

## Phase 22 — Attachments: proxied upload & janitor
**Scope:** POST /tasks/:id/attachments (raw body server-proxied path), attachment-janitor interplay.
**Cover:** direct upload ≤30mb via shim `express.raw` (regression: shim body-bytes pre-read fix) → stored in R2 + finalized in one step; oversized rejected; janitor: craft pending row >1h old → `POST /jobs/attachment-janitor?dry_run=true` reports it, real run deletes row + best-effort R2 object; fresh pending row survives.
**Exit:** both upload paths + cleanup correct.

## Phase 23 — Forms: builder
**Scope:** GET /forms, GET /lists/:listId/forms, POST /forms, GET/PATCH/DELETE /forms/:id, POST /forms/:id/fields, PATCH /forms/:id/fields/reorder, PATCH/DELETE /form-fields/:id.
**Cover:** form CRUD; slug uniqueness (ciText) + slug format validation; list binding (wrong list isolation); field CRUD every field type incl. custom-field-mapped fields; reorder full/partial/invalid; delete field with submissions existing; publish/unpublish state honored by public GET; branding fields; "New form" button flow (prior QA item) in UI.
**Exit:** builder API + UI stable.

## Phase 24 — Public form: render, submit, encryption
**Scope:** GET /public/forms/:slug, POST /public/forms/:slug/submit (both UNauthenticated).
**Cover:** public GET only when published (draft → 404); submit happy → task created in bound list with field→task mapping incl. custom-field values (prior QA regression); required-field validation; **task_attr bypass regression (47d8a30)** — crafted `task_attr` injection rejected; garbage/oversized payloads; **encryption at rest:** DB row has `encrypted_at` set, raw payload column unreadable ciphertext (direct SQL check), decrypts correctly in submissions view; `expires_at` = +90d; submission counter trigger; no auth leakage (endpoints work with zero cookies/headers).
**Exit:** public intake safe, encrypted, correctly mapped.

## Phase 25 — Submissions view & 90-day retention
**Scope:** GET /forms/:id/submissions + `form-submission-expiry` job logic.
**Cover:** submissions list decrypted for authorized roles only, pagination; craft rows with `expires_at` past/future → run expiry job **directly** (currently unreachable: no route/CLI — Phase 38 wires it; here validate the job function via a one-off script invoking `runJob("form-submission-expiry")`) → expired hard-deleted, others intact, dry_run counts only; encrypted blob truly gone.
**Exit:** retention logic proven; wiring dependency noted for Phase 38.

## Phase 26 — Templates & apply
**Scope:** GET/POST /templates, GET/PATCH/DELETE /templates/:id, POST /templates/:id/apply.
**Cover:** template CRUD, JSON structure integrity (tasks + checklists + fields captured); apply into target list → tasks/subtasks/checklists instantiated correctly (counts, statuses mapped, no orphan references); apply to different space/list; permissions; large template.
**Exit:** templates round-trip lossless.

# STAGE G — ENGINEERING & SLA

## Phase 27 — Sprints lifecycle
**Scope:** GET /sprints(+/active,+/:id,+/:id/tasks), POST /sprints, PATCH /sprints/:id, POST start/close, POST /sprints/:id/tasks, DELETE /sprints/:id/tasks/:taskId.
**Cover:** create planned; start → single-active enforced (starting second → error or auto-close? assert); close → incomplete tasks handling (moved out/kept — assert design); attach/detach tasks (cross-workspace/list guards); committed vs completed points derivation exact vs seeded data; /sprints/active with none active; date validation; sprint board UI DnD in Phase 45.
**Exit:** lifecycle rules + points math exact.

## Phase 28 — Engineering specials
**Scope:** POST /eng/report-bug, GET /eng/home, POST /eng/incidents/:id/postmortem.
**Cover:** report-bug → task with dev fields (severity, environment) resolved by-name (type+list resolution — unknown names → clean 422); eng/home aggregates (open bugs, sprint snapshot, on-call) exact vs seed; postmortem create + update (PK=task_id upsert), items JSON shape, non-incident task rejected?, permissions (eng-only?).
**Exit:** all 3 endpoints match API_DESIGN behavior.

## Phase 29 — On-call rotation
**Scope:** GET /on-call/current, GET /on-call/schedule, PUT/DELETE /on-call/:weekStart.
**Cover:** PUT with Monday-key validation (non-Monday → 422), assign member, overwrite week, delete week; schedule range query bounds; current — epoch-ms/tz correctness (Dhaka +6 regression: old NOW() bug class) at week boundaries (test around Mon 00:00 Dhaka); `v_current_on_call` view agreement; eng/home + UI reflect.
**Exit:** rotation exact at boundaries; view parity.

## Phase 30 — SLA
**Scope:** GET /sla/breached, PATCH /tasks/:id/sla.
**Cover:** craft tasks with sla_due_at past/future → breached list membership exact; hydrated assignees User[]; team=engineering alias filter; PATCH override (extend/clear) → drops off breached list; permissions; `v_breached_sla` view vs endpoint agreement (endpoint queries tasks directly — both must match); epoch-ms tz correctness (UTC bug class regression).
**Exit:** SLA math provably correct.

# STAGE H — NOTIFICATIONS & REALTIME

## Phase 31 — Notifications: inbox & preferences
**Scope:** GET /notifications(+/unread-count), POST mark-all-read, GET/PUT /preferences, POST /:id/read|unread|snooze, DELETE /:id.
**Cover:** feed pagination/filters; unread-count exact; read/unread flip; mark-all; snooze until T → hidden from default feed, appears after wake (job in Phase 38; here verify query-level behavior with crafted snoozed_until); soft-delete; prefs upsert per type/channel + defaults; another user's notification id → 404 (isolation).
**Exit:** inbox state machine exact.

## Phase 32 — Notification generation rules matrix
**Scope:** cross-feature: which events create notifications for whom.
**Cover:** matrix drive+assert: task assigned (→assignee, not self-action), comment on task (→assignees+watchers, not author), watcher added, status/dates changed?, mention (if supported), invitation/password emails NOT in-app; prefs OFF suppresses that type; deactivated users receive nothing; no duplicates on repeated action; payload deep-links correct (task key/URL).
**Exit:** documented matrix, every cell verified.

## Phase 33 — SSE & streaming realtime
**Scope:** GET /api/v1/stream/inbox, assistant SSE (transport only — content in Phase 37).
**Cover:** connect (cookie auth), heartbeat cadence (SSE_HEARTBEAT_MS), new-notification event arrives ≤ poll interval (3s), multiple tabs = independent streams, disconnect cleans `sse_connections_open` gauge, reconnect resumes, unauthenticated → 401 pre-stream; long-hold behavior on Workers-local dev vs deployed (document duration limits, verify FE reconnect/polling fallback actually recovers missed events).
**Watch:** per-connection Turso poll cost — measure queries/min per connection, log as capacity note.
**Exit:** realtime UX reliable incl. reconnect; limits documented.

# STAGE I — DISCOVERY & INTELLIGENCE

## Phase 34 — Search
**Scope:** GET /search.
**Cover:** tasks/lists/spaces hits by title/desc; result shape + type tags; workspace scoping; case-insensitivity (ASCII — LIKE fallback known); partial-word behavior documented (weaker than MySQL fulltext — assert acceptable, log as known-behavior); special chars `% _ ' "` escaped (no LIKE-injection/500); empty/1-char query validation; pagination/limits; archived/deleted excluded; deep-link from UI results.
**Exit:** search correct + injection-safe; semantics documented.

## Phase 35 — Home dashboard
**Scope:** GET /home/kpis, GET /home/agenda.
**Cover:** each KPI recomputed independently vs test data (open/overdue/due-today counts etc.) exact; agenda buckets (overdue/today/upcoming) Dhaka-tz-correct at day boundaries; role/user scoping (my numbers vs others); PR/review KPI placeholder returns 0 (known) → OPEN-DECISION: hide tile or leave (no fake data at go-live); `SKIP_CAMELIZE_URLS` /home/kpis mapping regression (keys arrive correctly in FE).
**Exit:** every number on Home provably right (or removed).

## Phase 36 — Workspace activity feed
**Scope:** GET /activity/recent, GET /activity.
**Cover:** events for workspace-level mutations (space/list/user/workspace changes) present; actor hydration; pagination cursor stability; recent vs full consistency; member visibility rules; volume test (100+ events).
**Exit:** audit feed complete & consistent.

## Phase 37 — AI assistant
**Scope:** POST /assistant/chat (stream + non-stream), GET /assistant/conversations(+/:id).
**Cover:** chat with real OPENAI_API_KEY: reply streams (SSE chunks) + non-stream JSON; conversation created/persisted, history retrievable, continues context; 3 tools fire on right prompts (`get_my_task_counts`, `get_my_agenda`, `search`) with caller-scoped data only (user B's prompt cannot read user A's tasks — try prompt-injection to cross scope); bad key → clean AppError (no 500 crash — regression ddf0d12); unset key branch → all routes 503 `assistant.not_configured` (temporarily unset in dev); token cap honored; Bangla prompts sane.
**Exit:** assistant safe, scoped, degradable.

# STAGE J — CROSS-CUTTING

## Phase 38 — Background jobs + cron wiring (pre-live fix phase)
**Scope:** POST /jobs/session-cleanup | attachment-janitor | r2-purge | snooze-wake, `form-submission-expiry`, internalAuth, **and the missing scheduler (fix + test)**.
**Cover:** internalAuth: missing/wrong token → 401/403, constant-time; every job dry_run vs real on crafted data (expired sessions >30d; pending attachments >1h; soft-deleted attachments >7d + real R2 object removal in test prefix; snoozed-past notifications wake; expired form submissions delete);
**FIX (restores API_DESIGN §28 intended behavior — not a new feature):** add `form-submission-expiry` route; add wrangler `triggers.crons` + a `scheduled()` handler dispatching `runJob` per documented cadence (5min/hourly/daily); deploy-side verified in Phase 46. Re-run all 5 jobs through the scheduled path locally (`wrangler dev --test-scheduled` / direct handler invoke).
**Also decide+implement here if Phase 13 chose to wire recurrence-spawn (else UI hidden there).**
**Exit:** every job proven on real data + a scheduler exists and fires.

## Phase 39 — Security sweep
**Scope:** authz, isolation, rate limits, headers, injection.
**Cover:** **authz matrix:** for each mutating endpoint family — anonymous → 401, member vs admin vs owner per design (sample exhaustively across all 28 route files); **isolation fuzz:** other users' resource ids (notifications, sessions, comments-author, submissions) + nonexistent/malformed ids (400/404 never 500, no data leak in error bodies); **rate limits** with non-test NODE_ENV: auth 5/min, invitation 5/min, public form 30/min, assistant 20/min, api 600/min — verify 429 + reset; note per-isolate weakness (single isolate in dev = deterministic; log DO/KV upgrade as OPEN-DECISION for prod hardening); CORS: allowed origins pass, foreign origin blocked, credentials flag; cookie flags end-to-end; XSS: script/style payloads via task desc, comments, names → stored but neutralized on render (TiptapReadOnly DOMPurify); JSON body >1mb → 413/400; prototype-pollution keys (`__proto__`) in bodies; header injection in filenames; verify no secrets in error messages/logs.
**Exit:** documented matrix all green; zero 500s from hostile input.

# STAGE K — BROWSER E2E (Playwright + real Chrome, against :4321)

## Phase 40 — Auth journeys (browser)
Login (valid/invalid + error toasts), logout, session restore on hard reload (refresh cookie bootstrap), route guards (deep-link while logged out → login → return-to), forgot-password full journey clicking the REAL Mailtrap email link, reset, re-login, invitation email → accept page → first login, guest-only redirects. **Exit:** all auth UX flows clean, no console errors.

## Phase 41 — Shell & navigation (browser)
Sidebar (spaces/lists tree, active states, scroll behavior — prior sidebar-scroll fix regression), topbar, breadcrumbs, route transitions + lazy-load fallbacks, 404 catch-all redirect, error boundary (force one API 500 → graceful), theme/tokens render, no layout breakage at 1366×768 and 1920×1080, browser back/forward integrity, direct-URL deep links to every route (~25 screens render without crash). **Exit:** every route mounts clean; zero console errors on navigation sweep.

## Phase 42 — Task views (browser)
ListPage table: render 436-task dataset (perf: interaction latency acceptable), sort/filter/group controls, inline edits, multi-select bulk actions (useMultiSelect); Board view: columns per status, DnD card across columns (status actually persists), reorder within column, quick-add; Calendar view: tasks on due dates, month/week nav, drag to reschedule persists; view switching preserves state; empty-list states. **Exit:** all three views correct against real API incl. DnD persistence.

## Phase 43 — Task drawer deep interaction (browser)
Open from board/list + direct `t/:taskKey` URL; edit title/desc (TipTap: bold/lists/links/mention UI), status/priority/dates/type pickers, assignee/watcher pickers, tags, dependencies UI (create/see blocked-by), comments (add/edit/delete, thread), checklists (full CRUD + toggle + assignee), attachments (upload real file via UI → download it back, progress/error states, >25MB rejection UX), custom fields section (each type's widget incl. BD phone + dropdown), activity tab, subtask create/navigate, archive/delete flows with confirmations. **Exit:** the single most-used surface is flawless.

## Phase 44 — Settings UI, all 9 tabs (browser)
Profile (name/password change UX), Workspace, Members (invite modal → real email, role change, deactivate/reactivate UX), Task types, Tags, Statuses (per-list picker + reorder DnD), Custom fields (builder per type + options editor), Templates (create from task/apply UX), Import-Export (expected "coming soon" state renders honestly — no dead buttons pretending to work). ARIA/labels spot-check (P1 fix regression). **Exit:** every settings surface functional + honest.

## Phase 45 — Forms, engineering, inbox, search, home (browser)
FormsList (create/"New form" regression), FormBuilder (field palette, reorder DnD, settings, publish, share link); PublicFormPage in a clean incognito context (no auth): render, validate, submit incl. custom fields → task appears in bound list; EngineeringHome widgets; SprintBoard DnD + start/close flows; OnCallRotation week editor; Inbox: live SSE update when another session triggers a notification (two browser contexts), snooze/read UX; SearchPage: query→results→deep-link; HomePage: KPIs/agenda render, dark corners (empty states). **Exit:** every remaining screen verified live.

# STAGE L — PRODUCTION & FINAL

## Phase 46 — Production (deployed worker) verification
**Scope:** https://beautybooth-tasks.tanver018765.workers.dev with PROD DB — careful mode.
**Cover:** read-heavy smoke of every GET family with a dedicated prod test user; ONE reversible write-journey (create task in a designated "QA" list → comment → attach small file (real prod R2) → complete → archive → delete; send one password-reset email → Mailtrap); cold-start behavior (/health/ready after idle); **cron triggers live** (Phase 38 deploy): verify `wrangler tail` shows scheduled runs at cadence + `background_job_runs_total` increments; /metrics sane; latency from Dhaka measured (p50/p95 for 5 key endpoints); wrangler tail clean of errors during the whole phase; secrets present (26/26 — already verified 2026-07-11); assistant + SSE quick check on prod.
**⚠️ P33-1 (DOWNGRADED to LOW — see P45-1: the frontend does NOT consume SSE, so this is moot for the shipped UI; only matters if SSE is ever wired to the frontend):** SSE (`GET /stream/inbox`) is 100% correct in the NODE dev runtime (Phase 33: connected/notification/heartbeat, Bearer+cookie auth, Last-Event-Id resume, isolation — 17/17). The express-shim DOES implement true streaming on workerd (first `res.write` resolves a `Response` with a `ReadableStream` body + enqueues each write + `cancel()` disconnect handler), so architecture is prod-sound. BUT confirm on the DEPLOYED worker with a REAL browser `EventSource`: (a) the platform doesn't buffer the stream (events arrive incrementally, not all-at-once on close); (b) how long a connection stays open before Cloudflare cuts it — and that the browser auto-reconnects with `Last-Event-Id` and resumes cleanly (the code supports this, so a capped connection degrades gracefully). Also sanity-check `setInterval` poll/heartbeat survive in workerd (code uses optional `.unref?.()`).
**Exit:** production behaves identically to test env; scheduler proven live; SSE streams incrementally on workerd (or reconnect-resumes cleanly); zero errors in tail.

## Phase 47 — Final regression & go-live gate
**Cover:** re-run the compressed critical-path suite (one scripted pass: auth → structure → task lifecycle → content → forms → eng → notifications → search/home) on BOTH test env and prod; verify EVERY issue logged in GO_LIVE_TEST_LOG.md is status=FIXED+RE-VERIFIED, all OPEN-DECISIONs resolved by user; pre-live checklist: ⬜ **cron wiring DEPLOYED** — scheduler is BUILT + workerd-verified locally in Phase 38 (`src/worker.ts` `scheduled()` + `wrangler.jsonc triggers.crons` 5min/hourly/daily; all 5 jobs dispatch .ok through `wrangler dev --test-scheduled`), but the LIVE worker won't have it until the next `wrangler deploy` → jobs stay dormant IN PROD until Phase 46 deploys + `wrangler tail` confirms scheduled runs fire · ✅ ENCRYPTION_KEY rotated + git history cleaned + pushed (from repo-hygiene findings) · ✅ **P13-1 recurrence decision implemented** — recurrence fields persist but NO spawner exists; either build recurrence-spawn job+cron OR hide the recurrence UI so it doesn't advertise a dead feature. **(Phase 38 update: the cron scheduler now EXISTS — `src/worker.ts` CRON_JOBS + wrangler crons — so building this = write the job + add one CRON_JOBS line; the job itself is NOT built and remains a decision.)** · ✅ **P19-1 dropdown-options decision** — options are create-only (no add/rename/delete API); accept for V1 + document, or add option-lifecycle endpoints · ✅ Home placeholder decision · ✅ **P28-1 eng-space setup** — create a "Bug Triage" list + "Incident" task type (report-bug/eng-home/postmortem resolve by name; not in default seed) OR add to seed / eng-space onboarding · ✅ demo/test data policy on prod DB decided (keep/clean) · ✅ `.dev.vars` restored to intended state · ✅ rollback plan documented (previous worker version via `wrangler rollback`) · ✅ **P3-1: Mailtrap email delivery — quota upgraded/confirmed so password-reset + invitation emails actually deliver (free-tier daily limit was exhausted during Phase 3; sends silently fail-open); positive inbox delivery re-confirmed** · ✅ consider a monitorable alert on mail/R2 send failures (silent fail-open) · ✅ **P20-1 schema drift** — `option_id_generated` VIRTUAL column + `idx_tcfv_option` index declared in schema but not created by `drizzle-kit push`; add to `_post.sql` or remove from schema (currently unused, so latent) · ✅ **P4-1: invitation resend decision — a failed invite email currently has NO resend path (re-invite pending email → 409); decide whether to add resend/regenerate-token or accept (resolved once P3-1 mail is reliable).** · ⬜ **P32-C: notification preferences `in_app_enabled` is a DEAD toggle** — the per-type in-app on/off in Settings→Notifications persists + round-trips but is read ONLY by the serializer; the generation path (`NotificationsRepo.createMany`) never checks it, so a user who disables in-app for a type STILL receives it. Decide: (a) honor it — filter recipients by pref before `createMany` at all 4 emit sites, or (b) hide the in-app column in the prefs UI. A visible control that does nothing is a go-live-visible issue. · ⬜ **P32-D: notification emails are NEVER sent + `email_enabled` is also a dead toggle** — no code path stamps `email_sent_at`/sends mail for notifications (MailService only wired for password-reset + invitation). Decide: (a) build a notification-email dispatch job honoring `email_enabled` (scheduler now exists — Phase 38 — so it's: write the job + a CRON_JOBS line + Phase 47 mail-quota), or (b) hide the email column in prefs UI. **NOT built in Phase 38 (product decision).** · ⬜ **P32-E: `due_soon` + `overdue` reminders are NEVER generated** — no scanner job exists (jobs/ has janitor/expiry/purge/sessionCleanup/snoozeWake only); the types are seeded in demo data but no live/job path emits them, so due-date reminders silently never fire. Decide: build a due-date scanner job OR accept absence + remove the demo-seeded illusion. **(Phase 38: scheduler now exists — building this = write the scanner + one CRON_JOBS line; the scanner is NOT built and remains a decision, and it depends on P32-C/D notification-delivery decisions since it just generates notification rows.)** · ⬜ **P32-A/B: no `status_change` and no watcher-`comment` notifications** (product decision, LOW) — changing a task's status notifies nobody; commenting without an @mention notifies no watcher/assignee. Internally consistent (only assigned/mentioned/form_submitted emit live). ClickUp notifies watchers of both; decide whether to add or accept as intentional low-noise V1. · ⬜ **P46-3 (HIGH — go-live blocker): PROD is running the DEMO seed + the demo `owner@company.local / Owner@12345` account logs into the PUBLIC prod URL** (verified: 200, KPIs 287/17 identical to the demo baseline). Anyone with the (repo/doc-known) demo creds can log into prod as owner right now. Before real go-live: clean the demo data OR at minimum delete/rotate all demo accounts + change known passwords. (Ties to "demo/test data policy on prod DB decided".) · ✅→⬜ **P46-1 (MEDIUM, FIXED in code, PENDING DEPLOY): `/health/ready` returns a persistent 503 on prod** — the DB-ping's 500ms timeout is too tight for the real Turso round-trip (500-900ms from the CF edge), so the readiness probe false-negatives while real queries (login etc.) succeed → any uptime monitor / LB health-check thinks the worker is DOWN. Fixed in `health.ts` (500ms→2500ms); takes effect on the next deploy — verify /health/ready→200 on prod after deploy. · ⬜ **P46-2 (LOW-MEDIUM): `/metrics` is PUBLICLY exposed on prod** (no auth → 200 Prometheus dump) — leaks internal route names + request/latency counts. Protect it (internalAuth / IP allow-list / drop from the public worker) before go-live. · ⬜ **P45-1 (MEDIUM): the SSE realtime stack is UNUSED by the frontend** — `NotificationBell` comment says it plainly: "SSE is auth-blocked (EventSource can't send the in-memory Bearer); poll the badge as the realtime substitute." So `/stream/inbox` + `sseHub` + `NotificationStreamRepo` (all built + tested Phase 33) are effectively DEAD CODE from the UI's perspective. Realtime = the notification-bell **badge polling unread-count every 60s**; the inbox LIST updates on navigation/reload, NOT live (verified in-browser: a new notification did not appear without reload; after reload it's there). Impact: notifications lag ≤60s (badge) / until-navigation (list) — acceptable for V1 but NOT "realtime". **This also makes P33-1 (SSE-on-workerd) MOOT/low-priority** — nothing consumes SSE, so whether it streams on workerd doesn't affect the shipped UI. Decide: accept 60s polling for V1 (common, fine — just don't advertise "realtime"), OR wire the frontend to SSE (needs an auth mechanism EventSource can use: an accessToken cookie or a `?token=` query param on the stream). · ⬜ **P27-1 (LOW, confirmed in Phase 45): Sprint Board shows no completed/velocity points** — the board header shows "N tasks · X pts · Y pts committed" but no live COMPLETED/done-points counter (completed_points is only snapshotted at sprint close). Decide whether a live done-points/velocity indicator is wanted on the active-sprint board. · ⬜ **P44-1 (LOW-MEDIUM): Import/Export "Export" buttons fake success** — Settings→Import/Export has JSON/CSV/SQL "Export" buttons whose handler shows a toast **"{format} export ready — file would download here."** but NO file ever downloads (verified in-browser: zero `download` events). This is a dead button pretending to work — exactly what the phase warns against. The "Start import" buttons are honest (toast "{source} importer — coming soon"). Decide: implement export, OR make Export honest too (a "coming soon" toast / disabled+badge) so no control fakes a result. · ⬜ **P41-1 (LOW): advertised ⌘K shortcut is a DEAD shortcut** — the sidebar Search item shows a "⌘K" hint AND the search page says "Press ⌘K anywhere to open the command palette", but there is NO ⌘K/Ctrl+K keydown handler anywhere (only AssistantWidget binds Escape) and there is no command-palette modal (`CommandPaletteTrigger` just `navigate("/search")` on click). Pressing ⌘K does nothing; the search works only by clicking the topbar pill → `/search`. Decide: wire ⌘K → open search/palette, or remove the ⌘K hints (and the "command palette" wording). Also minor: the `/search` route appears to create a duplicate history entry (browser-back from /search needs two presses) — low, worth a manual look. · ⬜ **P40-1 (LOW, branding): login page is branded "TaskHub", the in-app sidebar/workspace is "BeautyBooth"** — inconsistent product naming (login shows the generic product name, the app shows the workspace name). Decide whether the login should also say BeautyBooth (or the intended product name). Cosmetic. (Also noted: an antd `Alert message` deprecation warning appears in the browser console — DEV-ONLY, stripped from prod builds, but tidy up the `message`→`title` prop when convenient.) · ⬜ **P39-3 (LOW-MEDIUM): missing security response headers** — API/HTML responses carry NO `X-Content-Type-Options: nosniff`, `X-Frame-Options`/CSP `frame-ancestors` (clickjacking), `Referrer-Policy`, or HSTS (no helmet in the express app; `X-Powered-By` IS correctly absent). Add a small header middleware for the safe set (nosniff + X-Frame-Options: SAMEORIGIN + Referrer-Policy); CSP needs care with the SPA (defer/test in Phase 43); HSTS may be added by the Cloudflare edge on the deployed worker — verify in Phase 46. · ℹ️ **JWT design note (not a bug):** access tokens are stateless — validated by signature only, authorizing per their claims (`sub`/`workspaceId`), NOT re-checked against user existence/status per request. Forging needs the server secret; a deactivated user's access token stays valid ≤15m (refresh revoked immediately). Standard tradeoff; isolation holds (a token scopes to its own `workspaceId` claim). If tighter revocation is wanted, add a per-request user-status check or a short deny-list — decide at gate. · ⬜ **P35-1 (MEDIUM): "today" day-boundary uses SERVER-LOCAL date — on the deployed worker (UTC) every day-bucketed read shifts 6h for Dhaka users.** `ymd(new Date())` is the `today` source for **/home/kpis dueToday+overdue, /home/agenda default, and /tasks/my-work buckets** (HomeService + TaskWriteService.myWork). On the dev box (Asia/Dhaka) this equals Dhaka-today (all Phase 35 checks exact), but workerd runs UTC: between 00:00–06:00 Dhaka, prod "today" = Dhaka's YESTERDAY — Due Today/agenda show yesterday's tasks, today's appear only after 6am. Unreproducible locally; verify/fix before go-live. Suggested fix: derive today from `workspace.timezone` via `new Date().toLocaleDateString("en-CA",{timeZone})` (Intl available on workerd) in ONE shared helper used by both services. Related cosmetic note: sparkline day-buckets use UTC `date(created_at/1000,'unixepoch')` while `today` is server-local — same-day tasks near midnight can land in the adjacent sparkline bucket (LOW, cosmetic).
**Exit:** sign-off — system is go-live ready with zero known issues.

---

## Notes
- **Old stack (`server/`+`client/`) is NOT under test** — it's legacy; its ~2,930 Jest tests remain the regression net for shared business logic. If a bug found here also exists in `server/`, log it (fix optional there).
- **Test data:** all crafted rows use a `QA-` name prefix where possible for easy cleanup.
- **No new features** — only bug fixes, plus wiring documented-but-dead behavior (jobs cron §28) and honesty fixes (hide/label non-functional UI), each logged.
