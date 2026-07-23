# 🏢 DEPT REVIEW BUILD LOG — phase-wise execution record

**Plan:** `DEPARTMENT_REVIEW_PLAN.md` v1.1 (VERIFIED) · **Protocol:** one phase per prompt ("phase N koren") · build → test → verify → log here.
**Severity marks:** 🔴 blocker · 🟠 major · 🟡 minor · 🟢 info/hygiene · ✅ pass

---

## Phase 0 — Preflight + design lock — ✅ COMPLETE (2026-07-22)

### D-decisions LOCKED (user gave no overrides → defaults per plan §4)
| # | Locked value | Still changeable cheaply until |
|---|---|---|
| D-1 | HR = all owner+admin (deduped fanout) | Stage E (P20) |
| D-2 | Membership derived from task assignees (+ Unassigned row, deactivated flagged) | Stage C (P11) |
| D-3 | Weekly Mon 09:00 Asia/Dhaka, prev Mon–Sun, external cron + on-demand | Stage E (P18) |
| D-4 | Review trigger = live done-group status; reset on reopen; subtasks = ordinary tasks | Stage C (P8) |
| D-5 | Assignee sees flag + note (notified, guests included) | Stage C (P8) |
| D-6 | Self-review allowed but surfaced (`self_reviewed` counter) | Stage E (P18) |

### Safety net
- **Live-DB backup taken:** `<scratchpad>/taskmanagement_backup_2026-07-22.sql` (337,901 bytes; 35 CREATE TABLE + 5 views; `--single-transaction --routines --triggers`).
  - Scratchpad full path: `C:\Users\Tanvir\AppData\Local\Temp\claude\E--Task-Management-System\a34912b6-dd01-441d-8cec-70018cec0e66\scratchpad\`
  - ⚠️ Scratchpad is session-temp — copy elsewhere if you want it long-term.
- **Restore-VERIFIED:** dumped file restored into temp DB `p0_restore_verify` → 35 base tables, tasks=32, spaces=13 (exact match with live) → temp DB dropped. Backup is proven usable.
- **Live DB state at P0:** 13 spaces · 32 tasks · 4 users (real data — never run destructive ops against it; schema changes only via `database/upgrades/` scripts).
- **QA DB:** `taskmanagement_qa` exists and usable (13 spaces, 4 users, fixtures from the 50-phase run). Browser phases (P7/P17/P27/P30) run against QA.

### Prerequisite gap-fix status (from SYSTEM_GAP_SCAN_2026-07-21.md §8) — both still PENDING
- 🔴 **C1 logout fix: NOT DONE** — verified now: `authApi.logout` has zero callers in `client/src` (Sidebar/UserMenu still store-only logout). **Must land before Stage D** (P13–P17 browser passes need clean multi-user switching).
- 🟠 **H1 pagination fix: NOT DONE** — verified now: `client/src/http/api.ts:153-154` `usersApi.list` and `:342-345` `tasksApi.listByList` still `unwrapData` (cursor discarded). **Must land before P7** (head-picker must see all ~100 users; server+client both sides).
- These are gap-scan work items, not dept-review phases — run them separately (scan report §8 fix order) or say the word and they'll be slotted in before their gating phases.

### Test-harness baseline
- Spaces module (`jest.spaces.config.cjs`, private DB, `--runInBand`): run 1 = 241/242 (1 transient failure), **solo re-run = 7/7 suites all green (242/242)** → matches the documented P48 cold-start-flake pattern; harness healthy. (Full-suite state as of the 2026-07-21 gap scan: effectively 3356/3356.)
- 13 leftover `taskmanagement_*_test` DBs observed (normal jest artifacts, ignorable).

### Created
- `database/upgrades/` + README (script conventions, rollback rule, applied-state tracker) — the schema-delivery path while migrations stay frozen (plan §2.1).
- This log file.

### 🟢 Standing repo-hygiene notes (not P0 scope, carried from gap scan)
- Staged-but-uncommitted PascalCase renames (`TokenService.ts`/`CredentialService.ts`) — commit when convenient (Linux/CI safety).
- `ENCRYPTION_KEYS.txt` + `deploy.sh` still git-tracked with real keys — history-rewrite + rotate before any push (gate 3.2).
- `server/.env` still missing `ENCRYPTION_KEY` (gap-scan C4) — public-form submit 500s locally until set; unrelated to this feature but worth fixing early.

**Verdict: Phase 0 COMPLETE — no product code written (per plan). Ready for "phase 1 koren" (schema: head + enums).**

---

## Phase 1 — Schema: head + notification ENUMs — ✅ COMPLETE (2026-07-22)

### Changes (schema triple-update per plan §2.1 — migrations stay frozen)
1. **`database/schema.sql`** — spaces: `head_user_id VARCHAR(64) NULL` (after `is_private`) + `fk_spaces_head` (users, ON DELETE SET NULL) + `idx_spaces_head`; notifications §29: `type` ENUM +`'task_reviewed','report_ready'` (appended at END), `entity_type` +`'report'`; **user_notification_prefs §29b: `type` ENUM same 2 appends** (the second physical copy the verification pass caught).
2. **Drizzle TS** — `_shared.ts`: `notificationTypes` 10→12, `notificationEntityTypes` 5→6 (END-appended), new `reviewStatuses = ["approved","flagged"]` tuple; `hierarchy.ts`: spaces `headUserId` + `headFk` + `headIdx`. (`notifications.ts` auto-follows the tuples — no edit, as verified.)
3. **`database/upgrades/001_dept_head_enums.sql`** — additive ALTERs (INSTANT-eligible: END-appended ENUMs, 8.0.29+ ADD COLUMN AFTER) + rollback section.

### Applied + verified
- **001 applied to `taskmanagement` (dev, live data) + `taskmanagement_qa`** — information_schema parity query: both DBs identical → `head_user_id varchar(64)`, 12-value `type` on BOTH tables, 6-value `entity_type`. Tracker updated in `upgrades/README.md`.
- **Fresh-provision proof** (schema.sql path): throwaway `taskmanagement_p1fresh_test` via `db:setup` → 35 tables / 5 views / 7 triggers; SHOW CREATE spaces shows column+FK+index; prefs ENUM = 12 values; DB dropped. (In-paren `--` comments in the ENUM lists parse cleanly through the setup pipeline — same style as existing in-table comments.)
- **`tsc --noEmit`** ✅ clean.
- **Jest:** spaces **242/242** ✅ (serializer untouched — SPACE_KEYS tests unaffected, per plan) · notifications **84/84** ✅ (prefs suite derives ALL_TYPES from the tuple → auto-adapted to 12 types, exactly as the verification predicted).

### Notes
- Zero behavioral change: no code emits the new notification types yet (P8/P20); `head_user_id` not on the wire yet (P5). ENUM/column additions are inert until then.
- Dev DB was ALTERed in place (additive, real data untouched — backup from P0 stands).

**Verdict: Phase 1 COMPLETE. Ready for "phase 2 koren" (schema: task_reviews + tasks denorm).**

---

## Phase 2 — Schema: task_reviews + tasks denorm — ✅ COMPLETE (2026-07-22)

### Changes (triple-update per plan §2.1)
1. **`database/schema.sql`** — new **§36 `task_reviews`** table (id + `internal_id` AUTO_INCREMENT UNIQUE (keyset convention) + ws/space/task/reviewer FKs + `status ENUM('approved','flagged')` + `note` + **`created_at TIMESTAMP NOT NULL` with NO DB default** — app-written UTC per §5 rule 3; reviewer FK = **RESTRICT** (ledger protection); indexes `(space_id, internal_id)` + `(task_id, internal_id)`); tasks: `review_status/reviewed_at/reviewed_by` after `completed_at` + `fk_tasks_reviewed_by` (SET NULL); DROP-preamble gains `task_reviews`.
2. **Drizzle TS** — new `db/schema/reviews.ts` (mirrors §36, explicit named FK blocks, header documents the snapshot-annotation invariant) + **barrel export in `db/schema/index.ts`** (+ header layout line) + `tasks.ts`: 3 fields (`reviewStatus/reviewedAt/reviewedBy` — `reviewStatuses` import) + `reviewedByFk`.
3. **`database/upgrades/002_task_reviews.sql`** — additive ALTER tasks + CREATE task_reviews + rollback section.

### Applied + verified
- **002 applied to dev + QA** — information_schema: 3 task columns identical both DBs; `task_reviews` 9 columns both DBs. Tracker updated.
- **Fresh-provision proof**: throwaway DB via `db:setup` → **36 tables** / 5 views / 7 triggers; SHOW CREATE confirms: `created_at timestamp NOT NULL` **without implicit default** (server runs `explicit_defaults_for_timestamp=ON` — app-UTC write is enforced, not optional), reviewer FK RESTRICT, both keyset indexes, tasks FK auto-index parity (`fk_tasks_reviewed_by` same name both build paths); dropped.
- **`tsc --noEmit`** ✅ clean.
- **Jest:** tasks **358/358** ✅ + tasks10 **358/358** ✅ (serializer untouched → TASK_KEYS exact-shape suites unaffected, exactly as the v1.1 verification predicted; wire changes come in P12).

### Notes
- Zero behavioral change: nothing reads/writes the new columns/table yet (P8 writes, P12 serializes).
- `relations.ts` intentionally untouched — repos use select/join, not the relational query API; add only if P8+ needs it.

**Verdict: Phase 2 COMPLETE. Ready for "phase 3 koren" (schema: department_reports + space-delete guard).**

---

## Phase 3 — Schema: department_reports + space-delete guard — ✅ COMPLETE (2026-07-22)

### Changes (triple-update per plan §2.1)
1. **`database/schema.sql`** — new **§37 `department_reports`**: one row per (space, Dhaka-week); `internal_id` keyset column; `uq_department_reports_space_week`; `payload JSON`; `generated_at TIMESTAMP NOT NULL` **no DB default** (app-UTC); **`notified_at`** = atomic one-time-fanout claim column (P20 race/suppression fix); snapshot cols `head_user_id/generated_by/acknowledged_by` deliberately FK-less; **space FK = ON DELETE RESTRICT** (HR history retention); DROP-preamble entry.
2. **Drizzle TS** — new `db/schema/reports.ts` (week dates in **string mode** — calendar keys, not Date objects; full design rationale in header) + barrel export + header line.
3. **`database/upgrades/003_department_reports.sql`** (+ rollback).
4. **Space hard-delete guard** — `SpacesService.remove`: new precondition `409 space.has_reports` following the service's own double-check pattern (pre-check + re-check under the row lock inside the tx); docstring updated; `SpacesRepo.countReportsBySpace(spaceId, exec?)` added (tight count query, tx-aware).
5. **Tests** — `tests/spaces/delete.test.ts`: +`seedReport` helper + 2 new cases (409 `space.has_reports` leaves space + zero activity; delete succeeds after the report row is removed).

### Applied + verified
- **003 applied dev + QA** — 14 columns both DBs; `referential_constraints` confirms `fk_dept_reports_space = RESTRICT`, `fk_dept_reports_ws = CASCADE`.
- **Fresh-provision proof**: **37 tables** / 5 views / 7 triggers; SHOW CREATE confirms `generated_at` default-less, `notified_at` nullable, unique (space_id, week_start); throwaway DB dropped.
- **`tsc --noEmit`** ✅ clean.
- **Jest spaces module: 244/244** ✅ (242 existing + 2 new — the guard verified end-to-end through the HTTP layer).
- Note: per-test truncation utility is DYNAMIC (information_schema-driven, FK checks off) — both new feature tables are auto-covered, no test-infra change needed (verified this phase).

**Verdict: Phase 3 COMPLETE — Stage A schema work done (36→37 tables). Ready for "phase 4 koren" (jest.deptreview 4-file kit + factories).**

---

## Phase 4 — Test scaffolding — ✅ COMPLETE (2026-07-22)

### Created (mirrors the per-module isolation pattern, spaces-kit style)
1. **`jest.deptreview.config.cjs`** — testMatch `tests/dept-review/**`, globalSetup + 2 setupFilesAfterEnv.
2. **`tests/test-utils/global-setup-deptreview.ts`** — pins private DB `tms_deptreview_test` + `provisionTestDb()` (fresh from schema.sql → always tests current DDL).
3. **`tests/test-utils/db-name-deptreview.ts`** — runtime DB-name pin (listed FIRST).
4. **`tests/test-utils/setup-each-deptreview.ts`** — per-test DYNAMIC reset (information_schema-driven → new tables auto-covered) using **DELETE not TRUNCATE** (the documented MDL-stall gotcha); the historical one-file-per-process caveat documented with its likely root cause (since-fixed casing bug) + fallback recipe.
5. **`tests/dept-review/helpers.ts`** — `makeSpaceWithHead` (direct column write until P5 ships — documented), `makeDeptList` (REAL active+done status pair — D-4 live-status-group authority), `makeDoneTask` (done status + app-UTC completed_at + assignees + local-midnight dueDate conversion per the makeSprint convention), `makeReview` (ledger row only) + `setTaskReviewDenorm` (P8-mirror fixture), `makeReport`. All timestamps app-written UTC bound params (§5 rule 3).
6. **`tests/dept-review/harness.smoke.test.ts`** — 5 tests.

### Verified — smoke suite 5/5 first-run PASS (18.9s)
- Private DB provisioned with ALL P1–P3 objects (both tables, spaces.head_user_id, tasks review cols, 12-value notification ENUM).
- Factories produce coherent rows through real FK/enum chains (head set, done status, completed_at, assignee, denorm NULL).
- **App-UTC clock-domain proof**: review `created_at` round-trips within ±2s of the written instant (+6h DB-clock domain would fail hard).
- `department_reports`: JSON payload deep-equal round-trip, string week dates, **ER_DUP_ENTRY on duplicate (space_id, week_start)** (the P19/P20 upsert key), different week OK.
- Per-test reset isolates the new tables (starts-empty proof).
- No src changes this phase → no tsc/upgrade-script needed (tsc last clean at P3).

**Verdict: Phase 4 COMPLETE — STAGE A DONE (P0–P4). Ready for "phase 5 koren" (Stage B: backend head assignment — reminder: H1 users-truncation fix is required before P7's picker UI, and it is still pending).**

---

## Phase 5 — Backend: head assignment — ✅ COMPLETE (2026-07-22)

### Changes
1. **`validators/spaces.ts`** — `updateSpaceValidator` += `head_user_id` using the `logo_url` nullable-clear pattern (`optional:{options:{nullable:true}}` + custom string/length check) — null passes untouched, wrong types 422 `validation.failed`.
2. **`types/spaces.ts`** — `UpdateSpaceBody.head_user_id?: string | null`.
3. **`SpacesRepo`** — `SpaceRecord`/`SpaceUpdateFields` + BOTH tight select projections gain `headUserId` (replace_all over the identical projection blocks); new `clearHeadships(userId, workspaceId, exec)`.
4. **`SpacesService`** — new `UsersRepo` dep + exported `SpaceWithHead` type + private `hydrateHeads()` (ONE batched `findManyByIdsInWorkspace` for all distinct head ids — anti-N+1); list/get/create/update all return hydrated rows (create hydrates `head:null` without a lookup; update's empty-body no-op path hydrates too). `update()` validates a non-null head BEFORE the write: exists-in-workspace + active + non-guest, all three → **422 `space.head_invalid`** (no cross-tenant oracle — foreign id reads as unknown). Activity flows through the existing `updated` action (`context.fields` contains `headUserId`).
5. **`SpacesController`** — `WireSpace` += `head_user_id` + `head` (hydrated `WireUser`|null via `toWireUser`); `toWireSpace(s: SpaceWithHead)`; update handler maps `body.head_user_id` (null-preserving).
6. **`UserService.deactivate`** — inside the existing tx, after the status flip: `spaces.clearHeadships(...)` (correctness-critical: users are soft-deactivated, the FK's SET NULL can never fire). Reactivate does NOT restore. New `SpacesRepo` constructor dep.
7. **DI** — `routes/spaces.ts` (+UsersRepo → service) and `routes/users.ts` (+SpacesRepo → UserService).
8. **Tests** — `SPACE_KEYS` 10→12 in the 4 exact-shape files (create/update/get/list — precisely the set the v1.1 verification enumerated); new `tests/dept-review/head-assignment.test.ts` (19 tests): happy paths (assign/replace/clear/admin-caller/self-head/owner-head), wire shape on LIST + single (the P13 sidebar dependency), activity context, empty-body no-op shape, 422 `space.head_invalid` ×5 (guest/deactivated/invited/nonexistent/foreign-workspace), 422 `validation.failed` ×3 (number/empty/over-long), 403 ×2 (member/guest callers), deactivation hook + reactivation-no-restore + multi-space headship clear.

### Verified
- `tsc --noEmit` ✅ clean.
- **deptreview 24/24 · spaces 244/244 · users 279/279 — all first-run green.**
- No schema change this phase (columns shipped in P1) — no upgrade script.

**Verdict: Phase 5 COMPLETE. Ready for "phase 6 koren" (service-level `requireHeadOrAdmin` guard).**

---

## Phase 6 — Guard: `ReviewsService.requireHeadOrAdmin` — ✅ COMPLETE (2026-07-22)

### Changes
1. **New `services/ReviewsService.ts`** — the review-domain service skeleton (P8/P10/P11 grow it). Ships:
   - `requireHeadOrAdmin({spaceId, workspaceId, userId, role}) → SpaceRecord` — check order per plan §3: workspace-scoped resolve (absent/foreign → **404 `space.not_found`**, no cross-tenant oracle) → **409 `space.archived`** (outranks the role check — even admins get the truthful answer) → owner/admin pass → head pass → **403 `review.not_head`**. Returns the resolved record so callers never re-fetch.
   - `isHeadOfSpace(userId, space)` — pure exported helper (reused later by queue scoping + report recipients).
   - **Service-level, NOT middleware** — repo convention (`requireChecklist`/`requireForm` pattern; no DB-touching middleware exists), exactly as the v1.1 verification corrected.
2. **New `tests/dept-review/guard.test.ts`** — 11-test unit matrix, service instantiated directly against the private DB: head-member OK (record returned), non-head owner OK, non-head admin OK (headless space too), member 403, guest 403, head-of-OTHER-space 403, unknown-id 404, foreign-workspace-id 404 (even for that space's real head), archived 409 for head AND owner, `isHeadOfSpace` truth table.

### Verified
- `tsc --noEmit` ✅ · **deptreview suite 3 files, 35/35** (5 smoke + 19 head-assignment + 11 guard) — first-run green.
- No routes/DI/schema changes this phase (first consumer endpoint lands in P8).

**Verdict: Phase 6 COMPLETE. Ready for "phase 7 koren" (frontend head UI — ⚠️ PREREQUISITE: the H1 users-truncation fix (server+client) should land first so the head-picker sees all ~100 users; it is still pending as of P0's check).**

---

## Phase 7 — Frontend: head UI (+ H1 users-list fix) — ✅ COMPLETE (2026-07-22)

### Changes
1. **H1 fix (users half, folded in as the P7 prerequisite)** — `client/src/http/api.ts` `usersApi.list`: now requests `limit=200` and **follows `next_cursor` until `has_more=false`** (server clamps ≤200; interceptor camelizes pagination keys). Every consumer (assignee pickers, MembersSettings, the new head picker) now sees the complete ~100-person roster. One `TS7022` self-referential-inference fix (explicit `UsersPage` type). *The tasks/notifications half of gap-scan H1 remains on the gap-scan queue — out of this feature's scope.*
2. **`types/index.ts`** — `Space` += `headUserId: string | null` + `head: User | null` (camelCase; NO space mapper exists — types only, exactly as verified).
3. **`SpacePage.tsx`** — new **`DepartmentHeadCard`** (page-local component): everyone sees WHO the head is (avatar + name + email, or empty state); owner/admin additionally get an antd `Select showSearch allowClear` picker over `useUsers()` filtered `active && !guest` (mirrors the server's 422 rules). Mutation `spacesApi.update(spaceId, { headUserId })` (interceptor decamelizes → `head_user_id`; antd fires `onChange(undefined)` on clear → mapped to `null` — single mutation path, no double-fire). **Rule-6 discipline:** `onError` toast via `getApiErrorMessage`, success toasts, `isPending` disable, users-query error → "Couldn't load members" in the dropdown, invalidates **both** `["spaces"]` and `["space", spaceId]`. `data-testid="dept-head-card"`.

### Verified
- Client `tsc -b` ✅ (after the TS7022 fix) · eslint on touched files ✅ zero errors · vitest 8/8 ✅.
- **Browser proof PASSED (Playwright, QA stack):** API-seed headless space → UI login as owner → card empty state → assign via picker → "Department head updated" toast + chip → **full reload persists** (server-hydrated `head` on GET) → clear via UI → "removed" toast → empty state. Throwaway spec `e2e/p7-head.pw.ts` deleted after the green run (committed spec lands in P30); QA backend + Vite started/stopped for the proof.
- Playwright note for P30: antd 6 Select — open via `getByRole("combobox")`, pick via `.ant-select-item-option` (the `role=option` nodes are the hidden a11y mirror), clear via `.ant-select-clear`.

**Verdict: Phase 7 COMPLETE — STAGE B DONE (P5–P7). Ready for "phase 8 koren" (Stage C: review write endpoint A-4 — starts with the shared DONE_STATUS_GROUPS hoist).**

---

## Phase 8 — Review write (`POST /tasks/:id/review`, A-4) — ✅ COMPLETE (2026-07-22)

### Changes
1. **`_shared.ts`** — `DONE_STATUS_GROUPS` hoisted (`{"done","closed"}`, matching the 4 untouched private copies — no-refactor rule).
2. **New `repositories/ReviewsRepo.ts`** — `getListSpace` (LIVE space via `primary_list_id→lists`, invariant §2.3), `taskStateForReview` (task state + LIVE status group in ONE join — the D-4 authority; exec-aware for the under-lock re-check), `insert` (ledger append, app-UTC `created_at`).
3. **New `serializers/reviewSerializer.ts`** (`WireReview` — `reviewer_id` scalar; P10 layers hydration), **`validators/reviews.ts`** (status enum + note ≤500 nullable), **`types/reviews.ts`**, **`controllers/ReviewsController.ts`** (201; empty/whitespace note → null).
4. **`ReviewsService.reviewTask`** — full A-4 flow: resolve by id OR custom_id → **every write uses the RESOLVED id (C5 lesson)** → task.archived 409 → LIVE space derivation → `requireHeadOrAdmin` chain → fast done pre-check → tx: `lockById` → **archived+done RE-CHECKED under the lock** → atomically: ledger insert + denorm trio + `task_reviewed` task_activity + assignee notifications (**self-skip**, guests included; title capped ≤300). Repeat reviews allowed (undo story). Denorm bump of `updated_at`/ETag by design.
5. **`routes/tasks.ts`** — DI (SpacesRepo/ReviewsRepo/Service/Controller) + `POST /:id/review` (2-segment, shadow-safe — placed with the other `/:id/*` writes). `guard.test.ts` service constructor updated for the new deps.

### Tests — new `tests/dept-review/review-write.test.ts` (20)
Happy: 201 shape + denorm trio + activity context + assignee notification (title/body) · owner+admin callers · **undo chain approve→flag→approve (3 ledger rows, denorm=latest)** · **custom_id addressing writes to the RESOLVED task (C5 regression proof)** · updated_at/ETag bump · note normalisation (empty/absent/null) · **self-review allowed but never self-notifies (D-6)** · **guest assignee notified (D-5)**. Conflicts: not-done 409 `review.not_completed` (proves LIVE status-group authority — task had completedAt stamped but sat on an ACTIVE status) · archived task 409 · archived space 409. Matrix: unknown/foreign 404 · non-head/guest/other-head 403 ×3 · 401. Validation: 5 bad payloads + 500-char boundary accept.

### Verified
- `tsc --noEmit` ✅ · **deptreview suite 4 files, 55/55** (5+19+11+20) — green twice consecutively (one transient batch flake on the first cold run, both re-runs clean; documented P48 pattern).
- Reopen-vs-review RACE invariant test deliberately lands with **P9** (the reset that completes the invariant doesn't exist yet — noted in the suite header).

**Verdict: Phase 8 COMPLETE. Ready for "phase 9 koren" (review reset on EVERY done→not-done transition: update() + bulk() + the status-regroup 409 guard + bulk's completed_at/archived fixes).**

---

## Phase 9 — Review reset on EVERY done→not-done transition — ✅ COMPLETE (2026-07-22)

### Changes (all three verified bypass paths closed)
1. **`TaskWriteService.update`** — leaving a done group now clears the denorm trio (`review_status/reviewed_at/reviewed_by`) alongside `completed_at`; done→done keeps verdict + original completion instant.
2. **`TaskWriteService.bulk`** — same reset on leave-done, PLUS two pre-existing bulk holes fixed while there (both flagged by the v1.1 verification):
   - moving TO done now uses **SQL `COALESCE(completed_at, now)`** per task — the old unconditional `now` re-dated already-done tasks into the current week (weekly-report double-count);
   - **archived targets are 409 `task.archived`** unless the patch provides `archived_at` (bulk unarchive / re-archive stays possible — the one legitimate archived-target operation).
3. **`StatusesService.updateById`** — re-grouping a status ACROSS the done boundary while ANY task references it → **409 `status.in_use`** (mirror of the delete rule; closes the silent (un)complete + verdict-on-reopened-work bypass). Same-side re-groups and empty-status cross-groups stay allowed.

### Tests — new `tests/dept-review/review-reset.test.ts` (8)
Single reopen clears trio + ledger survives + re-complete needs FRESH review · done→done keeps verdict + completed_at · bulk reopen clears every target · **bulk re-done COALESCE-preserves old completed_at while stamping fresh ones** · bulk archived-edit 409 + archived_at-patch exemption (unarchive works) · regroup 409 with tasks · same-side/empty-status allowed · **the P8-deferred RACE invariant: concurrent review+reopen can never leave a verdict on a not-done task (both orderings legal, invariant asserted)**.

### Verified
- `tsc --noEmit` ✅ · **deptreview 63/63** (5 suites) first-run green.
- **Named regressions:** tasks update+bulk+lifecycle **56/56** ✅ · statuses module **209/209** ✅ — the bulk hardening and regroup guard broke nothing.

**Verdict: Phase 9 COMPLETE. Ready for "phase 10 koren" (review reads A-5: GET /tasks/:id/reviews + reviewer hydration + assignee readability).**

---

## Phase 10 — Review reads (`GET /tasks/:id/reviews`, A-5) — ✅ COMPLETE (2026-07-22)

### Changes
1. **`ReviewsRepo.listByTask`** — full history NEWEST-FIRST by `internal_id` DESC (deterministic; `created_at` is second-granular), defensive LIMIT 100, `internal_id` stripped before return.
2. **`reviewSerializer`** — `WireReviewWithReviewer` (+ hydrated `reviewer: WireUser | null`) layered over the P8 base shape.
3. **`ReviewsService.listTaskReviews`** — resolve by id/custom_id → read-gate: owner/admin OR space-head OR **task assignee** (D-5 transparency; guests-as-assignees included) → else **403 `review.forbidden`** (a READ code, distinct from the write-path's `review.not_head`); reviewers batch-hydrated (`findManyByIdsInWorkspace`, anti-N+1). **Archived tasks stay readable** — the space-archived 409 is write-only. New `UsersRepo` dep (DI + guard-test constructor updated).
4. **`ReviewsController.listForTask`** + `listReviewsValidator` + `ListReviewsRequest` + route `GET /:id/reviews` in the tasks router (2-segment — no `/:id` shadowing; placed with the other `/:id/*` reads). Response = bare `{data}` envelope (bounded set, no pagination block — documented).

### Tests — new `tests/dept-review/review-reads.test.ts` (10)
Newest-first order + exact row shape + hydrated reviewer (no password_hash) · owner/admin + empty-history `{data:[]}` · **assignee reads incl. GUEST assignee (D-5)** · custom_id addressing · **archived task readable** · outsider-member 403 · non-assignee guest + other-space head 403 ×2 · unknown/cross-workspace 404 · 401 · 422 over-long id.

### Verified
- `tsc --noEmit` ✅ · **deptreview 6 files, 73/73 first-run green.**

**Verdict: Phase 10 COMPLETE. Ready for "phase 11 koren" (queue + summary — A-2/A-3: the new space-scoped task traversal under the §5 rule-4 predicate, buckets, member filter, keyset cursor, Unassigned row).**

---

## Phase 11 — Queue + summary (A-2/A-3) — ✅ COMPLETE (2026-07-22)

### Changes
1. **New `utils/dhakaTime.ts`** — `dhakaToday()`/`dhakaDateOf()` (fixed +6, no DST — §5 rule 3); P18 extends with week math.
2. **`ReviewsRepo`** — the codebase's FIRST space-scoped task traversal (tasks→lists join; documented §2.3 invariant), all under the §5 rule-4 predicate (live lists + live tasks) with LIVE `statuses.status_group` done-authority (D-4) and "today" as a bound Dhaka `YYYY-MM-DD` param:
   - `queuePage`/`queueCount` — 4 bucket predicates (needs_review / flagged / overdue / due_today; NULL due_date self-excludes via SQL semantics), member filter as **EXISTS** (a join would duplicate multi-assignee rows), keyset over `internal_id` ASC.
   - `memberSummary` — ONE set-based query (rule 12): per-assignee conditional-SUM counters via LEFT JOIN `task_assignees` GROUP BY; the NULL group = the synthetic **Unassigned** row (H-4).
   - `summaryTotals` — independent task-level DEDUPED query (H-3 — never the sum of member rows).
   - `lastActivityByActors` — MAX(task_activity.created_at) per actor on the space's live tasks; DB-clock domain, display-only (H-7e).
3. **`ReviewsService`** — `reviewSummary` (guard → parallel member+totals → batch user hydration + last_activity → named-members-alpha sort, Unassigned LAST) + `reviewQueue` (guard → clamp 50/200 → local cursor codec #3 (documented; lift at a 4th copy) → parallel page+count → the SAME 4-batch task hydration as `TasksService.listByList` → `WireQueueRow` = wire Task + `review` trio + `parent_task` breadcrumb (H-5)).
4. **`reviewSerializer`** — `WireQueueReview`/`WireQueueRow`/`WireSummaryMember`/`WireReviewSummary` (deactivated members surface via `user.status`; totals doc-commented as deduped).
5. **Validators** (bucket REQUIRED closed-enum, member_id/cursor/limit with repeated-param guards) + types + `ReviewsController.summary/queue` ({data, pagination{next_cursor, has_more, total_estimate}}) + **routes/spaces.ts**: DI (ReviewsService instance #2 — stateless, per-router DI is the repo pattern) + 2 routes before `GET /:id`.

### Tests — new `tests/dept-review/queue-summary.test.ts` (9 tests, 13-task scenario)
Per-assignee member rows (multi-assignee counts in BOTH rows) · Unassigned row LAST (t7+tSub+tP math) · deactivated member via `user.status` · `last_activity` non-null only for the member who acted · **totals ≠ member-row sum (H-3 proof: 5 > 4)** · needs_review excludes archived task AND archived-LIST task (rule-4 proof) · **tiles==queue parity** (totals.done_unreviewed == queue total_estimate) · row shape (primary_list_id + assignees + review:null + parent breadcrumb on the subtask) · flagged bucket carries the review trio · overdue/due_today on the Dhaka calendar · member_id filter · keyset pagination (2+2, no overlap, exact total both pages) · empty-department zeros · owner OK / outsider + other-head 403 ×2 endpoints · foreign/unknown 404 · archived space 409 · missing/bad bucket 422 · malformed cursor 400 · 401.
(1 first-run failure was a TEST-math error — the Unassigned row correctly includes tSub+tP; server was right, expectation fixed.)

### Verified
- `tsc --noEmit` ✅ first try · **deptreview 7 files, 82/82** · **spaces regression 244/244** (router DI/route additions clean).

**Verdict: Phase 11 COMPLETE. Ready for "phase 12 koren" (wire contract sync: review trio into taskSerializer + TASK_KEYS ×2 + client types + the B-1 inbox crash-prevention package moved up from P22).**

---

## Phase 12 — Wire contract sync (+ B-1 inbox crash package) — ✅ COMPLETE (2026-07-22)

### Server
1. **`taskSerializer`** — `review_status/reviewed_at/reviewed_by` on the wire `Task` (placed after `completed_at`, mirroring the DB); every task read now carries the trio.
2. **TASK_KEYS ×2** — `tests/tasks/get-by-id.test.ts` + `list-by-list.test.ts` exact-shape arrays 44→47 keys (precisely the two suites the v1.1 verification enumerated).
3. **New `tests/dept-review/wire-sync.test.ts` (3)** — null-trio default on GET · post-review trio on GET AND the list read · **PATCH smuggle-proof: `review_status`/`reviewed_by` in a PATCH body are silently stripped by matchedData (200, denorm unchanged — the `taskToWire` client spread stays harmless).**

### Client (incl. the B-1 package moved up from P22 — required before P17's browser pass)
4. **`types/index.ts`** — `Task` += camelCase trio (mapTask spreads → zero mapper code, exactly as verified); **`NotificationType` rebuilt to mirror the server's 12-value ENUM** (adds `task_reviewed`/`report_ready` + the pre-existing drift fix: `pr_review`/`incident_alert` added, phantom `reminder_due` dropped); `Notification.entityType` drift fixed (`"reminder"`→`"incident"`) + `"report"`.
5. **`InboxPage`** — `TYPE_ICONS` now covers all 12 types (GitPullRequest/Siren/ClipboardCheck/BarChart3 for the 4 new); **the crash site is gone**: the direct `TYPE_ICONS[n.type]` destructure (which took down the whole app via the root ErrorBoundary on any unknown type) is replaced by `typeMetaOf()` — compile-time exhaustiveness kept via the full `Record`, PLUS a permanent runtime fallback (neutral Inbox icon) for future server types.
6. Deep-links: `task_reviewed` (entityType `task`) already navigates via the existing `/t/:id` handleClick branch — nothing needed; `report_ready` is mark-read-only until the `/reports` route lands in P24 (graceful, no dead navigation).

### Verified
- Server: `tsc` ✅ · **deptreview 8 files, 85/85** · TASK_KEYS regressions **119/119**.
- Client: `tsc -b` ✅ · eslint on touched files zero errors · vitest **8/8**.

**Verdict: Phase 12 COMPLETE — Stage C (review backend, P8–P12) DONE. Ready for "phase 13 koren" (Stage D: /dept plumbing — route, sidebar item off the unfiltered spaces query, space tabs, cursor-aware api wrappers per §5 rule 6).**

---

## Phase 13 — /dept plumbing — ✅ COMPLETE (2026-07-22)

### Changes
1. **Client types** — Dept Review section in `types/index.ts`: `ReviewVerdict`, `ReviewQueueBucket`, `TaskReview` (hydrated reviewer = client `User` — WireUser camelizes 1:1), `ReviewQueueRow extends Task` (+`review` trio + `parentTask`), `ReviewSummaryMember`/`ReviewSummary` (deduped-totals doc note).
2. **`http/api.ts` — `reviewsApi`** (A-2…A-5 wrappers): `summary` (bare object) · **`queue` — the §5 rule-6 cursor-aware shape: returns `{data, pagination:{nextCursor, hasMore, totalEstimate}}`, NEVER `unwrapData`**; wire rows are destructured (`review`/`parentTask` lifted) and passed through `mapTask` so consumers get real client `Task`s (opaque `custom_field_values` handling inherited) · `reviewTask` (A-4) · `listReviews` (A-5 — bounded `{data}`, documented no-pagination exception).
3. **Router** — lazy `DepartmentPage` + `/dept` route (authed AppShell children, after /search).
4. **Sidebar** — "Department" item (UserCheck icon) between Search and the Engineering section. Visibility predicate exactly per plan: **UNFILTERED** `useSpaces()` rows (a member heading a PRIVATE space still qualifies — SidebarSpaceTree's client-side hiding never touches this), **non-archived headships only** (an archived headship would deep-link into a 409), `|| owner/admin`. Same `["spaces"]` query key → deduped, zero extra requests. Collapsed rail: omitted (Engineering-section precedent) — documented in-code.
5. **`pages/dept/DepartmentPage.tsx`** (shell): loading spinner → error Alert → access check (`Navigate` home — UX only; the server gates every A-2/A-3 call) → header + **department switcher** (`?space=` search param = deep-linkable; heads see their own live departments, admin/owner see all live spaces; switcher renders only with >1) → P14/P15 stub + admin/head empty states. `data-testid="dept-page"`.

### Verified
- Client `tsc -b` ✅ · eslint (5 touched files) zero errors · vitest 8/8 ✅. (Browser pass = P17, per plan.)

**Verdict: Phase 13 COMPLETE. Ready for "phase 14 koren" (summary tiles + member rollup table on /dept — KpiRow/KpiCard pattern, Unassigned + deactivated rows, counts reconciling with the queue tabs).**

---

## Phase 14 — Summary tiles + member rollup — ✅ COMPLETE (2026-07-22)

### Changes
1. **New `pages/dept/DeptSummary.tsx`** —
   - **4 tiles** (Needs review / Flagged / Overdue / Due today) in the KpiRow visual language (bgSurface card, mono `CountUp` number, accent icon) — a lightweight local `DeptTile` rather than reusing `KpiCard` (which is welded to sparkline/trend `HomeKpi`); fed by **`totals` — the task-level DEDUPED numbers** (H-3 doc note in-code).
   - **Member rollup table** (antd Table, small): avatar+name, Open / Due today / Overdue / Needs review / Flagged / Last activity (relative + absolute tooltip; DB-domain display-only). **Unassigned row** renders muted, non-clickable, and arrives last (server sort); **deactivated members** muted at 0.55 opacity + "(deactivated)" chip via `user.status`.
   - **Member filter**: clicking a named member toggles selection (highlight + "clear filter" affordance) — wired to the URL.
   - Rule 6: skeleton loading, error Alert **with Retry**, empty state.
2. **`DepartmentPage`** — `?member=` search param beside `?space=` (deep-linkable filtered views; P15's queue consumes it); switching departments intentionally clears the member filter; `key={selected.id}` re-mounts the summary so member state never bleeds across departments. Stub now only covers the P15 queue slot.

### Verified
- Client `tsc -b` ✅ · eslint (dept pages) zero errors · vitest 8/8 ✅. (Browser pass = P17.)

**Verdict: Phase 14 COMPLETE. Ready for "phase 15 koren" (review queue UI — bucket tabs, approve inline / flag modal, no-cache-write mutation pattern, drawer opens with `listId={row.primaryListId}`).**

---

## Phase 15 — Review queue UI — ✅ COMPLETE (2026-07-22)

### Changes
1. **New `pages/dept/DeptQueue.tsx`** —
   - **Bucket tabs** (active tab shows the exact `total_estimate`) driven by the parent's `?bucket=` param; **`useInfiniteQuery` + "Load more (n of total)"** — rule 6: the cursor is FOLLOWED, never truncated.
   - **Rows**: custom_id chip + name + flagged badge, parent breadcrumb for subtasks (CornerDownRight), context meta (completed-relative on review buckets, due-date on the others), assignee Avatar.Group via `useUserMap`, hover-clickable.
   - **Actions** (needs_review + flagged buckets only — the not-done buckets would guarantee a 409): inline **Approve** + **Flag** modal (TextArea maxLength 500 + showCount, "assignees are notified" hint, empty→null). **NO-CACHE-WRITE mutation pattern** (§5 rule 7, in-code documented): zero optimistic writes, row dims + buttons disable while pending, `onSettled` invalidates exactly `["review-queue", spaceId]` + `["review-summary", spaceId]` + `["task", id]` — deliberately NOT `useUpdateTask` (its rollback misses the task-detail cache).
   - **Drawer**: rows set `?task=` and open the shared `TaskDetailDrawer` with `listId={row.primaryListId}` (the SprintBoardPage cross-list precedent; A-3 rows carry the field by contract).
   - Rule 6: skeleton, error Alert + Retry, per-bucket empty states (member-filtered variant included).
2. **`pages/dept/buckets.ts`** — QUEUE_BUCKETS constant extracted to its own module (a first-run eslint `react-refresh/only-export-components` error — component files must export only components; caught + fixed inside the phase, zero NEW lint errors).
3. **`DepartmentPage`** — `?bucket=` param (validated against the tab set, default needs_review) beside space/member; queue mounted under the summary with `key=` re-mount on space switch.

### Verified
- Client `tsc -b` ✅ · eslint (dept pages) **0 errors** (after the extraction) · vitest 8/8 ✅. (Browser pass = P17, next-next.)

**Verdict: Phase 15 COMPLETE. Ready for "phase 16 koren" (review in the task drawer — self-fetching ReviewSection off A-5, head actions, assignee flag-note view, "Department review" vs dev "Reviewer" copy).**

---

## Phase 16 — Review in the task drawer — ✅ COMPLETE (2026-07-22)

### Changes
1. **New `components/task/ReviewSection.tsx`** — placed right after `TaskPropertiesPanel` (verdict = status-level info), section idiom copied from the sibling sections (uppercase 11px header + borderSubtle container). Header reads **"Department review"** — the planned disambiguation from the dev-type "Reviewer" PR field.
   - **Self-gating visibility** (hooks-order-safe: all hooks first, conditional return after): verdict **badge** (Approved/Flagged pill + reviewer + relative time) rides the task row and renders for anyone with the drawer open; **note + history + actions** are for the privileged set — head (via `listMap→spaceMap.headUserId`) / owner / admin, plus task **assignees** (read-only — D-5); a viewer with no stake and no verdict gets nothing (and the A-5 fetch never fires — no 403 noise).
   - **Head actions in-drawer**: Approve inline + Flag modal (same ≤500-note modal as the queue), enabled only when the LIVE status group is done/closed (client mirror of the server's 409). Same **no-cache-write** mutation; settle invalidates `["task", id]` + `["task-reviews", id]` + the space's queue/summary keys.
   - **History collapse**: "History (n)" chevron toggle over the A-5 rows (verdict icon + reviewer name + relative time + note) — A-5's hydrated reviewer IS the name source (no extra lookups, per the v1.1 amendment). Loading skeleton + inline error-with-retry (rule 6).
2. **`TaskDetailDrawer`** — `<ReviewSection task listId />` wired in.
3. Note: the flag modal exists in two page-local copies (queue + drawer) — deliberate isolation for now; extract a shared component only if a third appears (the cursor-codec convention).

### Verified
- Client `tsc -b` ✅ · eslint (both files) 0 errors · vitest 8/8 ✅.
- P17 note: the Stage-D browser pass can use ISOLATED Playwright contexts per login, so the still-pending C1 logout gap does not block the scripted pass (it remains on the gap-scan queue for real users).

**Verdict: Phase 16 COMPLETE. Ready for "phase 17 koren" (Stage-D browser pass: full head flow on the QA stack — assign → member completes → queue → approve/flag → notification → drawer badge).**

---

## Phase 17 — Stage-D browser pass — ✅ COMPLETE (2026-07-22)

### The proof (throwaway Playwright spec on the QA stack — GREEN ON THE FIRST RUN, 17.3s)
Two isolated browser contexts (head + assignee — sidestepping the still-open C1 logout gap, which stays on the gap-scan queue):
1. **API seed (owner):** fresh space `P17 Dept *` → `member@qa.local` set as head via the P5 endpoint → list (statuses auto-seeded) → **two born-done tasks assigned to the owner** (the documented born-done queue-entry path).
2. **Head UI (member ctx):** sidebar **"Department" item visible** (headship-derived) → `/dept?space=` deep-link → tiles + queue render with both tasks → **inline Approve** → toast → row leaves the queue → **Flag with note** ("P17 needs rework") via the modal → toast → **Flagged tab** shows the task.
3. **Assignee UI (owner ctx):** `/inbox` shows BOTH `task_reviewed` notifications with the new icons — **the P12/B-1 crash fix proven in a real browser** — clicking the flagged one deep-links `/t/:id` → drawer's **"Department review"** section shows the Flagged badge **+ the note**.
4. **Summary:** back on `/dept`, the member rollup shows the owner's row carrying the flag count.

**Zero nits found — nothing to fix.** Spec + test-results deleted after the green run (committed E2E lands in P30); QA servers started/stopped for the proof (the two "failed exit 127" background notifications are the cleanup kills, as in P7).

**Verdict: Phase 17 COMPLETE — STAGE D DONE (P13–P17): the head's entire dashboard is live and browser-proven. Ready for "phase 18 koren" (Stage E: week math + report stats service — pure, set-based, heavily unit-tested).**

---

## Phase 18 — Week math + report stats service — ✅ COMPLETE (2026-07-22)

### Changes
1. **`utils/dhakaTime.ts` extended** — `addDaysYmd` (UTC day-shift on calendar strings), `isDhakaMonday` (P21's validator), `dhakaWeekOf` (Mon–Sun containing an instant), `previousWeekStart`, **`weekBoundsUtc`** (`[fromUtc, toUtcExclusive)` via the fixed `+06:00` offset — `2026-07-13` → `07-12T18:00Z … 07-19T18:00Z`).
2. **`ReviewsRepo` — 3 window queries** under the WEEK-WINDOW rule (live-list join, `tasks.archived_at` IGNORED — completed-then-archived still counts): `completionsByAssignee` (NULL group = Unassigned; **late = `DATE(completed_at + INTERVAL 6 HOUR) > due_date`** — pure arithmetic, no tz tables), `completionsTotals` (deduped), `reviewActionsInWindow` (every action + task context, oldest-first).
3. **New `services/ReportStatsService.ts`** — `computeWeek({spaceId, workspaceId, weekStart, today, prevTotals})` → the §3-locked `DeptReportPayload` (snake_case, stored as-is in the JSON column). 5 parallel set-based queries + JS assembly: per-assignee member rows (REUSES P11's `memberSummary`/`summaryTotals` for the point-in-time halves) · distinct-task `approved`/`flagged` vs action-level `flags[]` (reviewer `WireUser` hydrated batch-wise, parent breadcrumbs for subtasks) · `reviews_done` (department-level) + `self_reviewed` (reviewer ∈ current assignees — noted approximation) · Unassigned row (omitted all-zero, sorted last) · `prev_week` = caller-provided copy from the previous ROW (never recomputed) · `today` injected for determinism.

### Tests — new `tests/dept-review/report-stats.test.ts` (11, ALL first-run green)
Pure week math (bounds instants, **midnight-boundary week flip at exactly 18:00Z**, Monday check, month-cross) · **6h band on BOTH window edges** (inclusive start, exclusive end) with per-assignee + dedup in one scenario · **completed_late incl. the midnight band** (完 18:30Z on the due day = next Dhaka day = late) · undo-chain distinct-task verdicts + 1 flag ACTION + reviews_done=3 + hydrated reviewer (no password_hash) · self_reviewed · Unassigned row + parent breadcrumb · **all three archived rules in one scenario** (archived task counts in window / leaves point-in-time; archived-LIST work + its review vanish) · point-in-time vs window split · cross-space isolation + empty-dept zeros + prev_week passthrough/null.

### Verified
- `tsc --noEmit` ✅ · report-stats **11/11 first-run** · **full deptreview 10 files, 96/96**.

**Verdict: Phase 18 COMPLETE. Ready for "phase 19 koren" (persistence + read APIs: DepartmentReportsRepo upsert-per-(space,week) + A-6/A-7 + reportSerializer + gates).**

---

## Phase 19 — Reports persistence + reads (A-6/A-7) — ✅ COMPLETE (2026-07-22)

### Changes
1. **New `repositories/DepartmentReportsRepo.ts`** — `upsert` (ODKU on `(space, week)`: refreshes ONLY payload/generated_*/head-snapshot — **the §2.5 invariant lives here and nowhere else**; the surviving id is re-read), `findBySpaceWeek`, `findByIdInWorkspace`, `list` (composite keyset **week_start DESC, internal_id DESC** — A-8 back-fills make insertion order diverge from week order, the tie-break handles it) + `countFor`, with the A-6 head-visibility predicate (current headships OR snapshot rows) built in.
2. **New `serializers/reportSerializer.ts`** — LIST item = meta + **`totals` preview** (no payload — the /reports cards don't need the member matrix); DETAIL = full payload; hydrated snapshot `head`; `internal_id` + `notified_at` (fan-out mechanics) never on the wire.
3. **New `services/ReportsService.ts`** — `list` (admin = all; others = current-headship ∪ snapshot rows — computed from the bounded spaces list, no new repo method; plain members get a harmless EMPTY list) + `getById` (404 `report.not_found` / 403 `report.forbidden`; snapshot-head OR current-head pass). Local **composite cursor codec** (`week|internal_id` base64url — a documented VARIANT, not the simple-internal_id pattern).
4. **New validators/types/controller + `routes/reports.ts`** (GET / + GET /:id; header comment reserves the `/generate`-before-`/:id` ordering for P21) + **app.ts mount** `v1.use("/reports", …)`.

### Tests — new `tests/dept-review/reports-persistence.test.ts` (6, all green after one comment-syntax fix — `*/` inside a JSDoc line)
**The upsert-preservation proof**: second upsert refreshes payload/generated_by/head-snapshot (even → null) while `head_note`/`notified_at`/`acknowledged_*` survive untouched · owner list ordering (same-week internal_id tie-break) + LIST_ITEM_KEYS exact shape + totals preview + hydrated head + payload/notified_at absent · cursor paging (2+1, no overlap) + space_id filter · **head visibility: current + snapshot rows, plain member = empty list + 403 detail** · full-payload detail + 404 unknown/foreign + 400 malformed cursor + 401 · **ex-head keeps snapshot rows after the headship moves AND the new head sees the history (H-12)**.

### Verified
- `tsc --noEmit` ✅ · reports-persistence 6/6 · **full deptreview 11 files, 102/102**.

**Verdict: Phase 19 COMPLETE. Ready for "phase 20 koren" (the generation job: shared ReportsService.generateFor + headless-space inclusion + one-week self-heal + the notified_at atomic claim-then-notify + registry + ROUTE + CLI).**

---

## Phase 20 — Generation job (A-11) — ✅ COMPLETE (2026-07-22)

### Changes
1. **Repo additions** — `UsersRepo.findActiveAdminIds` (the D-1 fan-out set) · `SpacesRepo.listAllActive` (job iteration set, cross-workspace-ready) · `ReviewsRepo.spaceHasWindowActivity` (the H-2 gate: 3 short-circuiting LIMIT-1 probes — completion-in-window / review-in-window / open-task-now) · **`DepartmentReportsRepo.claimNotification`** — the v1.1 H-8 atomic claim (`UPDATE … SET notified_at WHERE … AND notified_at IS NULL`, affectedRows=1 ⇒ this caller won).
2. **`ReportsService.generateFor`** — the SHARED path (job + P21's A-8 both land here, so notification semantics cannot diverge): previous week's stored totals (copied, never recomputed) → `computeWeek` → the §2.5-invariant upsert → **claim-then-notify inside one tx** — `report_ready` fanout (entityType `report`, title `Weekly report ready: <name> (<week>)`, body = totals digest) to the DEDUPED active-owner/admin ∪ current-head set. New deps (ReportStatsService + NotificationsRepo) wired into `routes/reports.ts` DI.
3. **`jobs/departmentReport.ts`** — every non-archived space with WINDOW ACTIVITY → last completed Dhaka week (upsert refresh finalizes any Sunday manual preview) + **one-week SELF-HEAL** (the week before, only when its row is absent AND it had activity); dormant spaces skipped; `dry_run` counts without writing. Outcome `{processed, generated, selfHealed, skippedNoActivity, notified}`.
4. **Registry + ROUTE together** — `jobs/index.ts` += `department-report`, `routes/jobs.ts` += `POST /department-report` (in-code note: the form-submission-expiry route omission is NOT repeated). CLI works via the generic runner (`npm run job department-report`).
5. One recurring self-inflicted bug caught again: `generated_*/…` inside a JSDoc line terminates the block comment — reworded (and grepped the tree: the only other `_*/` lives in a harmless `//` comment).

### Tests — new `tests/dept-review/report-generation.test.ts` (6, ALL first-run green; weeks computed relative to NOW — date-independent)
Deduped fanout (owner+admin+head exactly; plain member excluded; title/body/entity checks) · **admin-who-is-head gets ONE row** · **regenerate refreshes payload (completed 1→2) + generatedBy but NEVER re-notifies** · **CONCURRENT generateFor ×2 → exactly one notifier, one fanout, one row (real race)** · headless dept reports with admins-only fanout (H-2) · full job lifecycle: dry-run (counts, zero writes) → real run (generated=1, selfHealed=1, notified=2, dormant skipped) → re-run (rows refresh, selfHeal quiet, **notified=0**).

### Verified
- `tsc --noEmit` ✅ · report-generation 6/6 · **deptreview 12 files, 108/108** · **jobs module regression 29/29**.

**Verdict: Phase 20 COMPLETE. Ready for "phase 21 koren" (A-8 on-demand generate + A-9 head_note + A-10 ack — literal-before-`:id` ordering, `report.invalid_week`, limiter clone, snapshot-head gate).**

---

## Phase 21 — On-demand generate + head note + ack (A-8/A-9/A-10) — ✅ COMPLETE (2026-07-22)

### Changes
1. **`reportGenerateLimiter`** — 10/min/user post-auth (assistantLimiter clone; `rateLimitOff` test/E2E bypass inherited).
2. **Repo** — `setHeadNote` (null clears; nothing else moves) + **`acknowledgeIfFirst`** (conditional UPDATE while `acknowledged_at IS NULL` — race-safe first-ack-wins).
3. **`ReportsService`** — `generateOnDemand` (space 404 → archived 409 → current-head-or-👑 gate 403 `report.forbidden` → **week rule: optional `week_start` must be a PAST Dhaka Monday else 422 `report.invalid_week`** (format in the validator, Monday+past in the service); defaults to the last completed week; delegates to the SHARED `generateFor` so claim semantics are identical to the job's) · `setHeadNote` (**STRICT snapshot-head-only — even admins 403**; the head's personal commentary) · `acknowledge` (👑 at the route via `canAccess`; idempotent-200, first actor/timestamp stick, deliberately NO `report.already_acknowledged` code).
4. **Routes** — `POST /generate` declared BEFORE the `/:id` routes (the /tasks/my-work ordering lesson), `PATCH /:id`, `POST /:id/ack` + validators (`generateReportValidator`/`headNoteValidator` logo_url-nullable pattern/`ackReportValidator`) + types + controller methods.

### Tests — new `tests/dept-review/reports-actions.test.ts` (5)
Head generates default week (shape + fanout once) + regenerate same row no-re-notify · explicit past-Monday OK + **three invalid_week cases (Tuesday / future Monday / CURRENT Monday)** + bad-format 422 · gate matrix (admin OK, outsider/guest/other-head 403 ×3, unknown 404, archived 409) · **note: set → admin 403 → survives-regenerate-via-API (§2.5 through the real endpoint) → null-clear → 1001-char 422** · **ack: first admin sticks, second admin's ack returns the FIRST actor/timestamp, member 403 `auth.forbidden`, 404, 401**.
One test-infra flake found + fixed: a SECOND `makeLoggedInClient` for the SAME user within the same second mints an identical JWT → `uq_sessions_token_hash` duplicate — reuse the seeded client (noted for future suites).

### Verified
- `tsc --noEmit` ✅ · reports-actions 5/5 · **full deptreview 13 files, 113/113**.

**Verdict: Phase 21 COMPLETE — the entire reports BACKEND (A-6…A-11) is live. Ready for "phase 22 koren" (notifications UX: task_reviewed drawer deep-link + inbox polish + regressions — types/icons already shipped in P12).**

---

## Phase 22 — Notifications UX contract — ✅ COMPLETE (2026-07-22)

### Scope check (most of P22 shipped early, by design)
- Client types/icons/defensive-fallback → **P12** (B-1 move-up) · `task_reviewed` deep-link → the existing `entityType === "task"` handleClick branch, **already browser-proven in P17** (flagged notification → task drawer) · inbox row **body** renders with 2-line clamp (verified in code) — so flag notes AND report digests display with zero client changes this phase · `report_ready` deep-link deliberately waits for the `/reports` route (P24); until then the click is a graceful mark-read.

### New — `tests/dept-review/notifications-ux.test.ts` (3, first-run green): the WIRE lock
1. A flag lands in the assignee's FEED as `task_reviewed` (entity task, actor = head, **body = the note**, unread) and unread-count works.
2. A generated report lands in the admin feed as `report_ready` (entity `report`, entity_id = the report, title carries the dept name, **body = the totals digest**); the standard inbox verbs (mark-read) work on the new type.
3. **Preferences enumerate ALL 12 types** with correct defaults, and a PUT for `task_reviewed` **round-trips — the end-to-end proof of the P1 double-ENUM migration** (this write hits `user_notification_prefs.type`, the second ENUM copy the v1.1 verification caught; a miss would 500 with MySQL 1265).

### Verified
- `tsc` ✅ · notifications-ux 3/3 · **notifications module regression 84/84** · **full deptreview 14 files, 116/116** · client vitest green (client untouched this phase).

**Verdict: Phase 22 COMPLETE. Ready for "phase 23 koren" (cron + ops docs: the KI-9 cron line, LOCAL_RUN_GUIDE, CLI dry-run proof — doc-only phase).**

---

## Phase 23 — Cron + ops docs — ✅ COMPLETE (2026-07-22, doc-only)

### Changes
1. **`GO_LIVE_GATE_REPORT.md` §3.7 (KI-9)** — 5→**6 jobs**; added the **`department-report` weekly Monday 09:00 Asia/Dhaka** cron line (idempotent, one-week self-heal noted) + the `--dry-run` verification tip.
2. **`LOCAL_RUN_GUIDE.md`** — §4 first-steps gains step 7 (assign a head → `/dept` review flow → weekly report + notifications; `/reports` viewer noted as Stage F); §8 endpoint tally annotated (+11 Dept Review endpoints); **new §9 "Background jobs"** — the full cron table (all 6 jobs incl. the CLI-only form-submission-expiry), `X-Internal-Token` header, CLI + `-- --dry-run` recipe, idempotency note.
3. **CLI dry-run proof on the REAL dev DB** (`npm run job department-report -- --dry-run`): `ok:true, processed:4, generated:2, selfHealed:2, skippedNoActivity:3, notified:0` — the job walks real data end-to-end, gates dormant spaces, and writes nothing under dry-run. `.env` needs nothing new (verified — the job runs on existing config).

**Verdict: Phase 23 COMPLETE — STAGE E DONE (P18–P23): the entire weekly-report engine (compute → persist → generate → notify → ops) is live. Ready for "phase 24 koren" (Stage F: /reports plumbing — route, sidebar item, list page with week × department cards, report_ready deep-link, smoke routes).**

---

## Phase 24 — /reports plumbing + list page — ✅ COMPLETE (2026-07-22)

### Changes
1. **Client types** — camelCase report views (`ReportTotalsView`, `DeptReportFlag/Member/PayloadView`, `DeptReportListItem`, `DeptReport`) — the stored payload camelizes through the interceptor by design (m-5: `payload` deliberately NOT opaque).
2. **`reportsApi`** — `list` (rule-6 cursor-aware `{data, pagination}`), `getById`, `generate`, `setNote`, `ack` (A-6…A-10 complete on the client).
3. **Routes** — `/reports` (list) + `/reports/:reportId` (detail — P24 ships a REAL shell so the deep-link lands somewhere sane: header + totals + 403/404-aware error states; P25 fills the body).
4. **Sidebar "Reports" item** (BarChart3) — same `canSeeDept` visibility set (the M-5/H-12 fix: owners/admins see all, heads reach their own; in-code comment).
5. **`ReportsListPage`** — in-page gate (owner/admin OR heads-any live, Navigate home) → `useInfiniteQuery` "Load older weeks" → **week sections × department cards**: dept name, hydrated head (or "No head assigned"), **Seen/New chip** (`acknowledged_at`), **totals preview** (done/flagged/overdue — flagged reddens when >0) → card → detail. Rule-6 states + HR-friendly empty copy.
6. **Inbox deep-link** — `entityType === "report"` → `/reports/:id` (the P22-deferred half, landed now that the route exists).
7. **`smoke.pw.ts`** — AUTHED_ROUTES += `/dept`, `/reports` (the P30/route-sweep coverage note from the v1.1 verification).

### Verified
- Client `tsc -b` ✅ · eslint (6 touched files/dirs) 0 errors · vitest 8/8 ✅. (Stage-F browser pass = P27.)

**Verdict: Phase 24 COMPLETE. Ready for "phase 25 koren" (report detail page: member matrix, flags w/ notes+reviewer, prev-week deltas, head-accountability line, head_note display, updated-after-ack chip, print CSS).**

---

## Phase 25 — Report detail page — ✅ COMPLETE (2026-07-22)

### Changes
1. **`ReportDetailPage` fully built** (replacing the P24 shell):
   - **Header** — dept + week + head + `Generated <instant> by <user>/automatically` + status chip: `New` / `Seen by <first ack'er>` / **`Updated after ack`** (H-13 — `generated_at > acknowledged_at`).
   - **Totals + delta arrows** — StatBlocks off the DEDUPED totals; completed/overdue deltas vs `prevWeek` (**"— no previous week"** when null — copied from the stored row, never recomputed; overdue delta colored good-when-DOWN).
   - **Head-accountability line** — reviews this week (+`self_reviewed` transparency when >0) + completed-awaiting-review count.
   - **Head's note** — quote block (editor = P26).
   - **Member matrix** — per-assignee rows (Unassigned last via server order; deactivated muted + chip; "n (m late)" completed cell) + the footnote: per-assignee vs deduped-totals AND the point-in-time snapshot disclaimer with the generation instant (H-7d).
   - **Flags record** — deduped across multi-assignee member rows (key = task+instant), newest first: custom_id chip + task link (`/t/:id`) + parent breadcrumb + reviewer + instant + note.
2. **Print CSS** (`index.css`) — `@media print` hides the AppShell `aside`/`header`, the floating assistant launcher, and anything `.no-print` (the back-link is tagged); white background. The weekly HR report prints clean.

### Verified
- Client `tsc -b` ✅ · eslint 0 errors · vitest 8/8 ✅. (Browser pass = P27.)

**Verdict: Phase 25 COMPLETE. Ready for "phase 26 koren" (actions: Mark seen, Generate now / Regenerate with confirm, head-note editor — invalidation + onError everywhere).**

---

## Phase 26 — Report actions (Mark seen · Regenerate · head-note editor) — ✅ COMPLETE (2026-07-22)

### Changes (all in `ReportDetailPage.tsx` — the three P24 `reportsApi` wrappers finally get callers)
1. **Action bar** in the header row (`className="no-print"` — never on paper):
   - **Mark seen** (primary, ✓) — visible to **owner/admin only** while un-acked (mirrors the route's `canAccess([OWNER, ADMIN])`); `reportsApi.ack` → "Marked as seen", chip flips to `Seen by <name>` on refetch. First-wins server-side, so a concurrent double-click stays idempotent.
   - **Regenerate** (↻) — visible to **admin OR the space's CURRENT head** (`spaceMap` `headUserId`, mirroring `generateOnDemand`'s guard); `App.useApp().modal.confirm` (context-safe, not the static) with the §2.5 promise spelled out: *"numbers recomputed; note/Seen kept; nobody re-notified"*; `reportsApi.generate({spaceId, weekStart: data.weekStart})` — regenerates THIS report's week, always a valid past Monday. `onOk` awaits `mutateAsync` inside try/catch so the modal closes either way and errors surface only as the mutation toast.
   - **Add note** — appears here only when the viewer may write a note but none exists yet.
2. **Inline head-note editor** — gated to the **SNAPSHOT head** (`data.headUserId === me.id`, mirroring the A-9 403 — a successor head reads but can't edit a predecessor's report):
   - Existing note → pencil **Edit** button (`.no-print`, type=text) in the quote-block label row.
   - `Input.TextArea` `maxLength=1000` + `showCount` (counter), autoSize 3–8 rows, disabled while saving; Save/Cancel right-aligned.
   - **Null-clear**: trimmed-empty draft is sent as `head_note: null` ("Note removed" toast) — block collapses back to the header "Add note" button.
3. **Rule-6/7 compliance** — every mutation: `onError` `getApiErrorMessage` toast, success toast, pending-disable via `loading`, `onSettled` invalidates `["report", id]` + `["reports"]` (list chips stay in sync). No optimistic cache writes.

### Gate cross-check (server ↔ client, verified by grep, not memory)
| Action | Server | Client |
|---|---|---|
| ack | `canAccess([OWNER, ADMIN])` (routes/reports.ts A-10) | `isAdmin && !acked` |
| generate | head-or-admin, CURRENT headship (+archived-space 409) | `isAdmin \|\| space.headUserId === me.id` |
| note | 403 unless `row.headUserId === userId` (A-9 snapshot) | `data.headUserId === me.id` |

### Verified
- Client `tsc -b` ✅ · eslint (ReportDetailPage) 0 errors · vitest 8/8 ✅. (Full-flow browser proof incl. these buttons = P27 Stage-F.)

**Verdict: Phase 26 COMPLETE. Ready for "phase 27 koren" (Stage-F QA browser pass: job/generate → notification → deep-link → detail → ack → regenerate → note, throwaway spec).**

---

## Phase 27 — Stage-F browser pass (QA stack) — ✅ COMPLETE (2026-07-22)

### Run
Throwaway self-seeding spec `e2e/p27-stage-f.pw.ts` (deleted after) on the QA stack (`DB_NAME_OVERRIDE=taskmanagement_qa`, rate-limit off). Seed = API (fresh dept + head=member + 3 assigned tasks: done+approved on-time, done+flagged late w/ note, open+overdue) + SQL backdate of `completed_at`/`reviewed_at`/`task_reviews.created_at` into the last completed Dhaka week (2026-07-13…19) so the window math shows real numbers, then on-demand generate **as the head**. Seed self-verifies the §3 totals (completed 2 / late 1 / approved 1 / flagged 1 / overdue 1) before any browser opens.

### Proven in the browser — 3/3 green, 16.7s final run
1. **Owner**: inbox `report_ready` (title `Weekly report ready: <dept> (<week>)` + digest body `Completed 2 · flagged 1 · overdue 1`) → click → **deep-link** `/reports/:id` → detail renders the backdated week (New chip, "— no previous week" deltas, Flags this week (1) w/ the flag note, head-activity line "2 reviews (2 self-reviewed)") → owner has **no note controls** → **Mark seen** → toast + `Seen by` chip + button disappears → **Regenerate** confirm modal → toast → **`Updated after ack` chip (H-13 browser-proven)**.
2. **Head**: `/reports` list → own dept card showing owner's **Seen** chip → detail → **no Mark seen** (not admin), Regenerate visible (current head) → **Add note** → save → visible → **null-clear** (empty draft → "Note removed", block collapses, Add note returns) → re-add → **Regenerate → note + ack BOTH survive (§2.5 upsert invariant browser-proven)**.
3. **Owner**: head note visible **read-only** (no edit button) + SQL count: exactly **1** `report_ready` for owner despite 3 generates — **H-8 claim-then-notify proven through the UI path**.

### Fixed in-phase
- **Real UI nit (browser-found)**: antd `showCount` counter is absolutely-positioned below the TextArea and the Save/Cancel row overlapped it — button row got `marginTop: spacing[5]`. (`ReportDetailPage.tsx`; tsc/eslint/vitest re-run green.)

### Recipes banked (for P30's committed E2E)
- Task create wire field is **`primary_list_id`** (not `list_id`).
- antd6 `modal.confirm` renders its title TWICE — the `.ant-modal-title` div is hidden; assert on **`.ant-modal-confirm-title`** (same hidden-a11y-mirror family as the Select options).
- antd6 `Input.TextArea` puts `data-testid` **on the `<textarea>` itself** — `getByTestId(...).fill(...)` directly; a descendant `textarea` locator finds nothing.
- Inbox rows: target the unique notification TITLE text ("Weekly report ready: …") — bare dept-name text collides with the sidebar space item.

### Residue
QA DB keeps the throwaway depts/reports/notifications (same precedent as P17) — zero impact on dev/live DBs. Spec + test-results deleted; both servers killed by port.

**Verdict: Phase 27 COMPLETE — STAGE F (P24–P27) FULLY DONE, HR loop browser-proven end-to-end. Ready for "phase 28 koren" (permission + isolation jest sweep: every new endpoint × role/workspace matrix + archived edges).**

---

## Phase 28 — Permission + isolation sweep — ✅ COMPLETE (2026-07-22)

### New suite: `tests/dept-review/permissions-isolation.test.ts` (6 tests, first-run green)
Locks the matrix cells the per-phase suites never crossed:

1. **Cross-workspace fence** — a table-driven loop fires the OTHER workspace's **owner** (highest-privilege attacker) at all 9 new surfaces (task review write/read, summary, queue, generate, report get/note/ack, space head PATCH): every one answers **404 `*.not_found`** (no cross-tenant oracle — never a 403), and `GET /reports` is a clean empty 200 (zero leak).
2. **In-workspace role matrix** — summary + queue: owner/admin/head 200, plain member + guest **403 `review.not_head`**; reports list = harmless **empty 200** for member/guest (design comment honored), head's list scoped to their dept; direct report read for the unprivileged = **403 `report.forbidden`**.
3. **Snapshot vs current head (H-12)** — after a real `PATCH /spaces/:id` handover: ex-head still sees + notes their old report (snapshot rights) but loses generate/summary/review-write (**403** — the gates re-read current headship from the DB); the new head sees the old report (current-headship visibility), generates with their own snapshot, but the old report's note stays the ex-head's alone and its `head_user_id` snapshot never rewrites.
4. **Deactivated head** — `POST /users/:id/deactivate` clears the headship in the same tx (DB-asserted null); the documented ≤15-min live access token (only refresh is revoked, API_DESIGN §2/§4) keeps **only non-head powers** — summary/generate 403; HR keeps the loop running headless (generate 200, `head_user_id: null`); the old report's snapshot stays the deactivated user forever.
5. **Archived-space edges** — history stays LISTED + readable + **ack-able** + **notable** (snapshot-head right is history-scoped); every forward-looking surface refuses **409 `space.archived`** (generate, summary, queue, review write).

### Verified
- New sweep 6/6 · **full deptreview module 14 suites / 122 tests green** · server `tsc --noEmit` clean.
- **Zero code changes needed** — every gate already behaved exactly as designed; the sweep found no defect and now stands as the permanent regression lock.

**Verdict: Phase 28 COMPLETE. Ready for "phase 29 koren" (full regression: per-module jest tasks/spaces/statuses/notifications/jobs/users/deptreview + tsc ×2 + vitest + eslint zero-new).**

---

## Phase 29 — Full regression — ✅ COMPLETE (2026-07-22)

### Per-module jest (all green)
| Module | Result | Note |
|---|---|---|
| jobs | 29/29 ✅ | |
| notifications | 84/84 ✅ | |
| statuses | 209/209 ✅ | |
| spaces | 244/244 ✅ | |
| users | 279/279 ✅ | 1 first-run failure under 3-way concurrent jest load → solo re-run clean (P48 flake pattern) |
| tasks | 358/358 ✅ | same — solo confirm-run all-pass (24 min) |
| tasks10 | 358/358 ✅ | same — solo confirm-run all-pass |
| deptreview | 122/122 ✅ | re-verified twice (once after the ReviewsRepo lint refactor) |

**~1,683 module tests.** All three transient failures happened ONLY while 2–3 jest modules hammered MySQL concurrently (different private DBs — the same-DB rule was never violated); each vanished on a solo re-run. Lesson banked: run the two ~25-min tasks modules solo when a definitive verdict is needed.

### Builds, types, lint
- Server `tsc --noEmit` ✅ · client `tsc -b` ✅ · vitest 8/8 ✅.
- **eslint zero-NEW enforced for real:** full-tree lint surfaced **4 errors that WERE mine** — `ReviewsRepo.listByTask` omit-destructure (refactored to an explicit column select: cleaner, no over-fetch), a redundant type assertion in `reportSerializer`, and 2 unused imports in `db/schema/hierarchy.ts`. All fixed; the three files now lint-clean; deptreview module re-run green after the refactor. Remaining lint debt (server 68, client 13) is **all pre-existing in non-feature files** (encryption.ts, MailService, WorkspaceSettings, …) — untouched, logged as V2 hygiene.

**Verdict: Phase 29 COMPLETE — the feature rides on a fully green regression across every module it touched.**

---

## Phase 30 — Committed Playwright E2E — ✅ COMPLETE (2026-07-22)

### `client/e2e/dept-review.pw.ts` — PERMANENT spec, 3/3 green FIRST RUN (28.5s)
The full loop in one committed spec (self-seeding vs the QA stack, auth.pw.ts contract; unique dept per run; space archived in `afterAll`):
1. **assign** — owner sets the head from the space page's dept-head-card (antd6 combobox → portal option by name).
2. **review** — head on `/dept?space=…`: 2 rows in **Needs review** → Approve (row leaves, no-optimistic-cache proven in-browser) → Flag w/ note via modal → count 0 → **Flagged** tab carries the task.
3. **report** — reviews SQL-backdated into the last completed Dhaka week (dynamic week math in-spec — runs green ANY day), then generated through the job's shared `generateFor` path as the head; totals asserted (completed 2 / late 1 / approved 1 / flagged 1 / overdue 1).
4. **flag notif + HR ack** — owner (assignee) sees the flag note in the `task_reviewed` inbox row, deep-links from `Weekly report ready: <dept>` → detail (Flags(1) + note) → **Mark seen** → `Seen by` chip, button gone.

Bonus: `smoke.pw.ts` route sweep re-run — `/dept` + `/reports` (added P24) render **console-error-free**. Every P27 recipe held: zero selector fixes needed. Spec is lint-clean; servers cycled after.

---

## Phase 31 — Final gate — ✅ COMPLETE (2026-07-22) — 🏁 FEATURE SHIPPED

### Docs & polish landed
- **`API_DESIGN.md` §33** — full addendum: head assignment, review write/read, summary, queue, reports list/get/generate/note/ack, weekly job, notification types, all new error codes.
- **`GO_LIVE_GATE_REPORT.md` §1b** — feature addendum (scope, schema-upgrade gate = `database/upgrades/001–003` on live, test tallies, E2E).
- **Root `README.md`** — feature section w/ pointers; **`DEPT_REVIEW_DEMO.md`** — 5-minute 2-browser demo script + Q&A one-liners.
- **Copy fix** — `/reports` empty state promised "on demand from a department page" (no such button exists); now: "the first one arrives automatically on Monday morning, covering last week."
- **Dark theme:** N/A — the app ships a single light theme (`index.css` tokens); nothing feature-specific to do. **Keyboard:** all actions are native antd buttons/selects/tabs/modals (real `<button>` report cards) — tabbable + Enter/Esc out of the box.

### Zero-open triage (feature-scoped bugs: **0**)
| Item | Status |
|---|---|
| Lint debt (server 68 / client 13) | pre-existing, non-feature files only — V2 hygiene |
| Root README staleness (Tailwind/shadcn/port claims) | pre-existing — V2 doc pass |
| No UI entry to generate a week's FIRST report | V1 design: weekly job + API/CLI (demo doc shows both); revisit if HR asks |
| QA-DB demo residue | harmless; P30 archives its space |
| Gap-scan §8 queue (C1 logout, H1 tasks/notifs half, …) | separate pre-existing track — untouched by this feature |
| tasks/tasks10 modules need ~25 min SOLO for a definitive verdict | operational lesson, banked in P29 |

### Sign-off
**Dept Review V1 = 32/32 phases complete.** Schema (3 additive upgrades) → review engine (3 bypass-proof reset paths, race-proven) → head dashboard → reports engine (§2.5 upsert invariant, H-8 exactly-once fanout, Dhaka week math) → HR UI (print-clean, ack/regenerate/note) → hardening (P28 sweep, P29 full regression, P30 committed E2E). Server 122 dept-review tests + ~1,683 module regression + 6 committed E2E/smoke browser tests + 2 disposable browser passes. **Production go-live checklist for this feature: run `database/upgrades/001–003` on the live DB + add the Monday-09:00 Dhaka cron line (gate §3.7) — everything else ships in the code.**
