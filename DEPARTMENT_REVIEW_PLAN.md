# 🏢 DEPARTMENT HEAD REVIEW + HR REPORTING — Phase-wise Build Plan

**Version:** v1.1 **VERIFIED** (2026-07-21) — v1.0 was adversarially cross-checked against the actual codebase by 4 independent verification agents (schema/migrations · backend integration · frontend integration · design-logic). Every wrong assumption they found is fixed inline below; §8 lists the changelog. File:line references were verified against the working tree.
**Status:** READY — awaiting "phase N koren"
**Stack:** `server/` (Express + MySQL + Drizzle) + `client/` (React + Vite + antd 6).
**Relationship to RBAC_TEAMS_REQUIREMENTS.md:** deliberately LIGHTWEIGHT subset (leader review + reports). No teams table, no permission matrix, no visibility scoping. Forward-compatible with the full RBAC build.

---

## 0. TL;DR (Banglish)

**প্রতিটা Space = department.** Prottek space e **1 jon Head** (`spaces.head_user_id`, Space page theke owner/admin boshabe). Task **done** hole Head er **"My Department"** (`/dept`) page er review queue te ashe → Head **Approve ✓ / Flag ⚑ + note** dey (assignee notification pay). **প্রতি Monday 09:00 (Dhaka)** automated job ager soptaher (Mon–Sun) **department report** banay — per-member stats + flags + Head accountability — HR (owner+admin) notification pay, `/reports` e dekhe, "Mark seen" kore. Membership fully derived (task assignee = department member) — kono setup nai.

**Protocol:** "phase N koren" bolben → ami SHUDHU sei phase: build → test → verify → `DEPT_REVIEW_LOG.md` e log. D-1…D-6 defaults (§4) — kichu na bolle default.

---

## 1. Feature scope

| # | Capability | Who |
|---|---|---|
| F-1 | Assign/change/remove Head per space | owner/admin |
| F-2 | My Department page: member rollup + review queues (needs-review/flagged/overdue/due-today) | head (own), owner/admin (any) |
| F-3 | Review task: approve/flag + note; history kept; assignees notified | head of that space, owner/admin |
| F-4 | Review auto-resets on EVERY done→not-done path (single, bulk, guarded status-regroup) | automatic |
| F-5 | Weekly report auto-generated per active department (head optional) + on-demand | job + button |
| F-6 | Reports inbox: list/detail, Mark seen, head note | owner/admin (all), head (own/snapshot) |
| F-7 | Notifications `task_reviewed` / `report_ready` with deep-links | automatic |
| OUT | Task-edit powers for head, visibility scoping, teams entity, email digests | RBAC / V2 |

---

## 2. Data model (VERIFIED against schema.sql + Drizzle)

### 2.1 Delivery rule — ⚠️ migrations directory is FROZEN
The Drizzle journal ends at idx 4 (`0004_chat`); `0005_form_encryption.sql` sits unjournaled with no snapshot; `_post.sql` replay is non-idempotent; `drizzle-kit generate` would diff against the stale 0004 snapshot and emit colliding DDL. **Therefore: NO new migration files, NO journal edits.** Every schema phase updates exactly:
1. `database/schema.sql` (the operative source — fresh installs, all jest DBs),
2. the Drizzle TS schema (incl. **`server/src/db/schema/index.ts` barrel export** for new files),
3. a copy-paste **live-ALTER script** written to `database/upgrades/NNN_<name>.sql` (with a `-- rollback:` section), applied manually to dev/QA/live.
Re-baselining drizzle-kit (snapshot repair incl. 0005) = separate tooling task, out of this feature's scope.

### 2.2 `spaces` — head column
```sql
ALTER TABLE spaces ADD COLUMN head_user_id VARCHAR(64) NULL AFTER is_private,
  ADD CONSTRAINT fk_spaces_head FOREIGN KEY (head_user_id) REFERENCES users(id)
      ON DELETE SET NULL ON UPDATE CASCADE,
  ADD INDEX idx_spaces_head (head_user_id);
```
- Head must be **active** + role `member|admin|owner` (validate via `UsersRepo.findByIdInWorkspace` — returns role+status; `findActiveIdsInWorkspace` checks status only, NOT role).
- Users are soft-deactivated, never deleted → the FK's SET NULL never fires in practice → **P5's app-side headship-nulling on deactivate is correctness-critical, not defensive.** `reactivate` does NOT restore headships.
- Drizzle: field after `isPrivate` (hierarchy.ts:50), FK block beside existing ones. Note `fk_tasks_reviewer` already exists — our name `fk_spaces_head` is collision-free (verified).

### 2.3 `task_reviews` — append-only history
```sql
CREATE TABLE task_reviews (
  id VARCHAR(64) PRIMARY KEY,
  internal_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,        -- repo cursor/ordering convention
  workspace_id VARCHAR(64) NOT NULL,
  space_id VARCHAR(64) NOT NULL,                              -- snapshot ANNOTATION (see invariant)
  task_id VARCHAR(64) NOT NULL,
  reviewer_id VARCHAR(64) NOT NULL,
  status ENUM('approved','flagged') NOT NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL,                              -- APP-WRITTEN UTC (bound JS Date) — NO DB default (M8 clock-domain rule)
  UNIQUE KEY uq_task_reviews_internal_id (internal_id),
  KEY idx_task_reviews_space_time (space_id, internal_id),
  KEY idx_task_reviews_task_time (task_id, internal_id),
  CONSTRAINT fk_task_reviews_ws FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_reviews_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_reviews_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE RESTRICT  -- protect the ledger
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
```
**INVARIANT:** tasks cannot change `primary_list_id` (no endpoint exists — verified). All queue/summary/report queries derive space LIVE via `primary_list_id → lists.space_id` (tasks have NO space_id column — every space-scoped query joins lists). `task_reviews.space_id/workspace_id` are historical annotations, never used for bucketing. Any future task-move feature must not rewrite review rows.

### 2.4 `tasks` — current-review denorm (app-maintained in-tx, NO triggers)
```sql
ALTER TABLE tasks
  ADD COLUMN review_status ENUM('approved','flagged') NULL AFTER completed_at,
  ADD COLUMN reviewed_at TIMESTAMP NULL AFTER review_status,               -- app-written UTC
  ADD COLUMN reviewed_by VARCHAR(64) NULL AFTER reviewed_at,
  ADD CONSTRAINT fk_tasks_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
```
Verified: lands between `completed_at` (schema.sql:437) and `sla_due_at`; zero name collisions; taskSerializer enumerates explicitly so nothing hits the wire until P12. ⚠️ Naming: `tasks.reviewer_id` (engineering PR reviewer) ALREADY exists — UI copy must say "Department review" vs "Reviewer (PR)".

### 2.5 `department_reports`
```sql
CREATE TABLE department_reports (
  id VARCHAR(64) PRIMARY KEY,
  internal_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id VARCHAR(64) NOT NULL,
  space_id VARCHAR(64) NOT NULL,
  week_start DATE NOT NULL, week_end DATE NOT NULL,           -- Dhaka Mon/Sun
  head_user_id VARCHAR(64) NULL,                              -- snapshot at generation (may be NULL — headless depts still report)
  head_note VARCHAR(1000) NULL,
  payload JSON NOT NULL,
  generated_by VARCHAR(64) NULL,                              -- NULL = automated job (snapshot, no FK — deliberate)
  generated_at TIMESTAMP NOT NULL,                            -- app-written UTC
  notified_at TIMESTAMP NULL,                                 -- atomic claim column for one-time fanout (see P20)
  acknowledged_by VARCHAR(64) NULL, acknowledged_at TIMESTAMP NULL,
  UNIQUE KEY uq_department_reports_internal_id (internal_id),
  UNIQUE KEY uq_department_reports_space_week (space_id, week_start),
  KEY idx_department_reports_ws_week (workspace_id, week_start),
  CONSTRAINT fk_dept_reports_ws FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_dept_reports_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE RESTRICT     -- HR history survives; space delete → 409 space.has_reports
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
```
`head_user_id/generated_by/acknowledged_by` intentionally have no user-FK (snapshots) except as noted. Space delete flow (`SpacesService.remove`) gains the 409 `space.has_reports` guard.

### 2.6 ENUM extensions — ⚠️ BOTH tables
`notifications.type` AND **`user_notification_prefs.type`** are two physical copies of the same 10-value ENUM (schema.sql §29 + §29b). Both must be ALTERed (append-only = ALGORITHM=INSTANT, safe):
- `type` += `'task_reviewed'`, `'report_ready'` (→ 12 values) — **in both tables**
- `notifications.entity_type` += `'report'` (→ 6 values)
- `_shared.ts`: extend `notificationTypes`/`notificationEntityTypes` tuples + new `reviewStatuses = ["approved","flagged"] as const`.
Prefs GET/PUT auto-adapt (serializer + validator are tuple-driven — verified; `tests/notifications/preferences.test.ts` derives from the tuple, no test breakage).

---

## 3. API surface (VERIFIED mount points, zero route collisions)

Guard style: **service-level** (repo convention — `requireChecklist`/`requireForm` pattern; no resource-resolving middleware exists and none will be introduced). Shared guard: `ReviewsService.requireHeadOrAdmin(spaceId, auth)` → space-in-workspace 404 → archived 409 → head/owner/admin else 403 `review.not_head`.

| # | Endpoint | Mount | Gate | Notes |
|---|---|---|---|---|
| A-1 | `PATCH /spaces/:id` body += nullable `head_user_id` | routes/spaces.ts (existing) | 👑 | nullable-clear via the `logo_url` validator pattern (`optional:{options:{nullable:true}}` — NOT plain optional, NOT the default_locale reject-pattern); wire gains **both** `head_user_id` (scalar) and `head` (WireUser\|null) on ALL space responses incl. `GET /spaces` LIST (P13 depends on it); batch-hydrate heads via `UsersRepo.findManyByIdsInWorkspace` (anti-N+1); search-result spaces do NOT carry head (SearchService's independent projection untouched) |
| A-2 | `GET /spaces/:id/review-summary` | routes/spaces.ts | head/👑 | per-member rollup incl. synthetic **"Unassigned" row** (user:null) + deactivated members flagged `is_active:false`; `last_activity` = MAX(task_activity.created_at) — DB-clock domain, display-only, never compared to UTC bounds |
| A-3 | `GET /spaces/:id/review-queue?bucket=needs_review\|flagged\|overdue\|due_today&member_id=&cursor=&limit=` | routes/spaces.ts | head/👑 | keyset cursor over tasks.internal_id (clamp 50/200); rows reuse the task serializer → carry `primary_list_id` (drawer contract) + assignees + latest review + parent breadcrumb for subtasks |
| A-4 | `POST /tasks/:id/review` `{status, note?}` | routes/tasks.ts (2-segment, shadow-safe — verified) | head-of-space/👑 | tx: `TasksRepo.lockById` → **re-check done under lock** (409 `review.not_completed`) → archived 409 `task.archived` → insert history (app-UTC created_at) + update denorm + `task_reviewed` to assignees (self-notification skipped; guests included — consistent with existing fanout) + task_activity. Repeat reviews allowed = the undo story (denorm = latest; history keeps all; test approve→flag→approve). Bumps task updated_at/ETag (tests expect) |
| A-5 | `GET /tasks/:id/reviews` | routes/tasks.ts | head/👑/assignee | newest-first by internal_id; reviewer hydrated |
| A-6 | `GET /reports?space_id=&cursor=&limit=` | new routes/reports.ts | 👑 all · head: current-headship spaces OR rows where snapshot `head_user_id` = caller | composite keyset `(week_start DESC, internal_id DESC)` |
| A-7 | `GET /reports/:id` | routes/reports.ts | same as A-6 | full payload |
| A-8 | `POST /reports/generate` `{space_id, week_start?}` | routes/reports.ts — **literal declared BEFORE `/:id`** | head own/👑 | `week_start` must be a past Dhaka Monday (422 `report.invalid_week`); shares the generation service with the job (claim-then-notify, §P20); 10/min/user post-auth limiter (assistantLimiter clone) |
| A-9 | `PATCH /reports/:id` `{head_note}` | routes/reports.ts | **snapshot** head only | ≤1000 chars |
| A-10 | `POST /reports/:id/ack` | routes/reports.ts | 👑 | idempotent 200 (first actor/timestamp stick; NO `report.already_acknowledged` code) |
| A-11 | `POST /jobs/department-report` | routes/jobs.ts + jobs/index.ts + CLI | X-Internal-Token | registry + route + tests together |

**Report payload (per space × week; camelCase note: the client interceptor recursively camelizes `payload` — client types are camelCase; do NOT add payload to OPAQUE_VALUE_KEYS):**
```jsonc
{
  "members": [ // PER-ASSIGNEE rows (a 2-assignee task counts in both); final synthetic row user:null = "Unassigned"
    { "user": {"id","first_name","last_name","avatar_url","is_active"} | null,
      "assigned_open": 4, "completed": 7, "completed_late": 2, "overdue_now": 1,
      "approved": 6, "flagged": 1,
      "flags": [{"task_id","custom_id","task_name","note","reviewed_at","reviewer": {…WireUser}, "parent_task": {"id","name"}|null}] } ],
  "totals": { /* task-level, DEDUPED by task id — NOT the sum of member rows; includes unassigned */ 
              "completed": 23, "completed_late": 4, "overdue_now": 6, "approved": 18, "flagged": 3, "done_unreviewed": 2 },
  "head_accountability": { "reviews_done": 21,          // department-level: review actions by ANY reviewer in the window
                            "self_reviewed": 2,          // reviews where reviewer was an assignee (D-6 transparency)
                            "done_unreviewed_at_generation": 2 },
  "prev_week": { "completed": 19, "overdue_now": 9 }     // copied from previous week's ROW at generation; null if absent; UI shows "—", never recomputes
}
```
**Stat semantics (locked):** week-window stats (`completed`, `completed_late`, `approved`, `flagged`, `reviews_done`) filter app-UTC timestamps against the Dhaka-week UTC bounds; `completed_late` := `dhakaDateOf(completed_at) > due_date` (YYYY-MM-DD compare); point-in-time stats (`assigned_open`, `overdue_now`, `done_unreviewed`) are **at-generation snapshots** (UI shows generated_at beside them); archived rule → §5 rule 4.

---

## 4. Decisions (defaults apply unless you say otherwise)

| # | Question | DEFAULT |
|---|---|---|
| D-1 | HR = ? | all owner+admin (see /reports + get `report_ready`; recipient set deduped when head is also admin) |
| D-2 | Membership | derived from task assignees in the space (+ synthetic Unassigned row; deactivated flagged) |
| D-3 | Cadence | weekly Mon 09:00 Asia/Dhaka covering prev Mon–Sun, external cron (KI-9) + on-demand; fixed +6 offset (BD has no DST); `workspaces.timezone` column exists but V1 hardcodes Dhaka — documented |
| D-4 | Review trigger | done-group status (LIVE `statuses.status_group` join = the authority; `completed_at` = display/"when" only); re-open → auto-reset; subtasks = ordinary tasks (bucketed by their OWN list's space; parent breadcrumb shown; dead `subtasks_count` columns never used) |
| D-5 | Flag visibility | assignee sees flag + note (notified; incl. guest assignees — consistent with existing fanout) |
| D-6 | Self-review | allowed in V1 (small teams), but always attributed (`reviewer` on every flag, `self_reviewed` count in payload) so HR sees it; hard-block = V2 toggle |

---

## 5. Build rules (every phase MUST follow)

1. **Migrations FROZEN** — schema phases = schema.sql + Drizzle TS (+ barrel `schema/index.ts`) + `database/upgrades/NNN_*.sql` live-ALTER with rollback section. No journal edits.
2. **No DB triggers** (1442); denorm maintained app-side in the same `db.transaction`.
3. **Clock domains:** app-written UTC bound Dates for every new timestamp (`task_reviews.created_at`, `tasks.reviewed_at`, `generated_at`, `notified_at` — no DB defaults); `dhakaToday()`/`dhakaDateOf()` pure helpers (P18) for every "today"/week computation — never server-local `new Date()` formatting, never `NOW()`/`CURDATE()`.
4. **Traversal predicate (everywhere):** space non-archived + `lists.archived_at IS NULL` + `tasks.archived_at IS NULL` for point-in-time stats/queues; week-window completed-stats keep the live-list join but ignore `tasks.archived_at` (work done then archived still counts).
5. **Workspace isolation:** workspace_id from `req.auth` only; foreign ids → 404; guard-in-service pattern.
6. **Pagination end-to-end:** keyset cursors over `internal_id` server-side; client wrappers RETURN pagination — signature `queue(spaceId, p): Promise<{data: Row[]; pagination: {nextCursor: string|null}}>` — **never `unwrapData`** for the new list endpoints (it discards pagination = the H1 bug).
7. **Frontend error discipline:** every mutation `onError` (getApiErrorMessage), every query loading+error states, exact invalidation keys. Review actions do NOT reuse `useUpdateTask` (its rollback desync bug); queue mutations use no-cache-write (row disabled while pending → invalidate queue+summary+`["task",id]` on settle).
8. **Tests per phase:** `jest.deptreview.config.cjs` 4-file kit (config + `tests/test-utils/{db-name,global-setup,setup-each}-deptreview.ts`), private `tms_deptreview_test` DB, `--runInBand`; touched-module regressions named per phase.
9. **Serializers:** snake_case; hydrate users via `WireUserSource` projection; `internal_id` never on the wire.
10. **Notifications** created via `NotificationsRepo.createMany` inside the trigger's tx; report fanout only via the `notified_at` atomic claim (P20).
11. **Scope guard:** no head task-edit powers, no visibility scoping, no teams entity.
12. **Set-based stats:** compute via GROUP BY aggregates — O(constant queries per space), never per-member loops.

**Prerequisites from `SYSTEM_GAP_SCAN_2026-07-21.md` §8:** H1 users-truncation fix (server + **client** `usersApi.list`) before P7's head-picker; C1 logout fix before Stage D browser passes. P0 verifies status.

---

## 6. PHASES (32 — say "phase N koren")

### STAGE A — Foundations (P0–P4)
- **P0 · Preflight + design lock.** Confirm D-1…D-6; QA DB + backup; verify C1/H1 fix status (log); create `DEPT_REVIEW_LOG.md` + `database/upgrades/` dir. No product code.
- **P1 · Schema: head + enums.** §2.2 + §2.6 — schema.sql (spaces + **both** notification ENUMs §29/§29b) + Drizzle (`hierarchy.ts`, `_shared.ts` incl. `reviewStatuses`, notifications.ts auto-follows tuple) + `upgrades/001_dept_head_enums.sql` (both ENUM MODIFYs + spaces ALTER + rollback). Fresh `db:setup` + spaces & notifications module jest (verified: nothing breaks on enum append).
- **P2 · Schema: task_reviews + tasks denorm.** §2.3 + §2.4 — new `db/schema/reviews.ts` **+ barrel export in `db/schema/index.ts`** + tasks.ts fields + `upgrades/002_task_reviews.sql`. Provision test.
- **P3 · Schema: department_reports.** §2.5 (incl. `notified_at`, RESTRICT space-FK) + barrel + `upgrades/003_department_reports.sql` + `SpacesService.remove` 409 `space.has_reports` guard (+ its jest in spaces module). Provision test.
- **P4 · Test scaffolding.** The 4-file jest kit + `tests/dept-review/` factories (space-with-head, done-task via real status flow, review, report). Harness smoke test.

### STAGE B — Head assignment (P5–P7)
- **P5 · Backend: assign head.** `updateSpaceValidator` (logo_url nullable pattern) + `types/spaces.ts` UpdateSpaceRequest + `SpacesRepo` (SpaceRecord/SpaceUpdateFields + BOTH select projections gain headUserId — 4 sites) + `SpacesService` (validate via `findByIdInWorkspace`: active + non-guest + same-ws → 422 `space.head_invalid`; activity write) + `toWireSpace` in **SpacesController** (no serializer file exists): `head_user_id` + batch-hydrated `head` on list/get/create/update (DI: users repo into `routes/spaces.ts`) + **UserService.deactivate** nulls headships inside the existing tx (after status flip, before activity; DI `routes/users.ts`; reactivate does NOT restore). **Tests:** new matrix + update the 4 hardcoded `SPACE_KEYS` files (`tests/spaces/{create,update,get,list}.test.ts`) + spaces/users regression.
- **P6 · Guard.** `ReviewsService.requireHeadOrAdmin(spaceId, auth)` service-level (+ `isHeadOfSpace` helper) — NOT middleware (repo convention). Unit matrix: head/admin/owner OK, member 403 `review.not_head`, foreign 404, archived 409.
- **P7 · Frontend: head UI.** **Build a new "Department head" card on SpacePage** (owner/admin see controls — first-of-its-kind client role-check, keep it local; nothing exists to extend — CreateSpaceModal is create-only). Picker: antd `Select showSearch` over `useUsers()` filtered `status==="active" && role!=="guest"` (H1 prerequisite makes the list complete). Invalidate **both** `["spaces"]` and `["space", spaceId]`. Head chip in the card (skip SidebarSpaceTree tooltip — dead code branch). Client `Space` type += `headUserId`, `head` (camelCase; NO space mapper exists — types only). Browser-verify.

### STAGE C — Review core, backend (P8–P12)
- **P8 · Review write (A-4).** First: hoist `DONE_STATUS_GROUPS` to `_shared.ts` (new code imports it; the 4 existing private copies stay untouched). Then ReviewsService/Repo + route in tasks router: lockById → re-check under lock → tx per A-4 spec. Jest ~30: permission matrix, 409s, lock re-check (reopen-race sim), repeat-review undo chain, notification rows (self-skip, guest-include), ETag bump.
- **P9 · Review reset on EVERY done→not-done transition.** (a) `TaskWriteService.update` (~:777) — clearing completedAt also clears the 3 review fields; (b) **`TaskWriteService.bulk` (~:1122) — same clear**, PLUS fix bulk to preserve `completed_at` for already-done tasks (mirror update's `current.completedAt ?? now`) and reject archived targets (mirror update); (c) **`StatusesService.updateById`: status_group change across the done boundary while tasks reference the status → 409 `status.in_use`** (mirror of the delete rule — closes the third bypass). Jest: single-reopen, bulk-reopen, bulk re-done keeps completed_at, regroup 409. **Regression: `tests/tasks/update.test.ts` + `tests/tasks/bulk.test.ts` + `tests/tasks/lifecycle.test.ts` + statuses module.**
- **P10 · Review reads (A-5).** History + reviewSerializer + assignee-readability. Jest matrix.
- **P11 · Queue + summary (A-2/A-3).** New space-scoped task traversal (**tasks→lists join — no precedent exists, new code**) under §5 rule 4 predicate; live done-group join (D-4); buckets + member filter + keyset cursor (3rd private cursor codec — follow local convention); summary incl. Unassigned + deactivated rows; `dhakaToday()` for due/overdue buckets. Jest ~35 incl. archived-list exclusion, unassigned parity (tiles==queue==totals), member filter, isolation.
- **P12 · Wire contract sync.** Server: 3 review fields into taskSerializer. **Update the 2 hardcoded `TASK_KEYS` files** (`tests/tasks/get-by-id.test.ts`, `tests/tasks/list-by-list.test.ts` — verified the only exact-shape task suites). Client: Task type += `reviewStatus/reviewedAt/reviewedBy` (mapTask spreads — zero mapper code) **+ the notification-type client work moved UP from P22 (inbox crash prevention — B-1): `NotificationType` += both new types + fix pre-existing drift (add `pr_review`/`incident_alert`, drop phantom `reminder_due`), `entityType` union `"reminder"`→`"incident"` += `"report"`, `TYPE_ICONS` entries + permanent defensive fallback (`?? {icon: Bell, …}`)** in InboxPage. Verify update-PATCH strips unknown review keys (matchedData) so `taskToWire` spread stays harmless.

### STAGE D — Head dashboard, frontend (P13–P17)
- **P13 · Plumbing.** `/dept` lazy route + Sidebar "Department" item — predicate over the **unfiltered** spaces query (private-space member-heads included), **non-archived spaces only**, `spaces.some(s => s.headUserId === me.id) || role owner/admin`; zero new requests (verified `["spaces"]` dedupe). Collapsed rail: omitted (Engineering precedent) — documented. Space tabs for multi-headship + admin empty state. Cursor-aware api wrappers per §5 rule 6 signatures.
- **P14 · Summary tiles + member rollup.** KpiRow/KpiCard pattern; Unassigned + deactivated (muted) rows; counts must reconcile with queue tabs (test note from P11). Loading/error/empty.
- **P15 · Review queue UI.** Bucket tabs + rows + Approve inline + Flag modal (note ≤500) — **no-cache-write mutation pattern** (row pending-disabled; invalidate queue+summary+`["task",id]`); drawer opens with `listId={row.primaryListId}` (SprintBoardPage precedent; A-3 rows carry it).
- **P16 · Review in task drawer.** Self-fetching ReviewSection (A-5 first page = reviewer names source — no extra hydration path): badge (status+note+reviewer+time), head actions, assignee flag-note view, history collapse. Copy disambiguates "Department review" vs dev "Reviewer".
- **P17 · Stage-D browser pass.** Full head flow on QA (requires P12's inbox fix — sequencing verified). Fix nits; log.

### STAGE E — Reports engine, backend (P18–P23)
- **P18 · Week math + stats service (pure).** `dhakaToday()/dhakaDateOf()/dhakaWeekOf()` (fixed +6, no DST) + `ReportStatsService.computeWeek` per §3 locked semantics — **set-based GROUP BY aggregates** (rule 12), member rows per-assignee, totals task-deduped, Unassigned row, flags w/ reviewer + parent breadcrumb, self_reviewed, prev_week from previous ROW (null-safe). Unit-jest ~30 (boundaries incl. the 6h band, late math, archived rules, dedup, empty dept, headless dept).
- **P19 · Persistence + reads (A-6/A-7).** Repo upsert (ODKU updates payload/generated_at/generated_by/head_user_id ONLY — never head_note/ack/notified) + composite cursor + reportSerializer + gates (👑 all; head = current-headship OR snapshot). Jest.
- **P20 · Generation job (A-11).** Shared `ReportsService.generateFor(spaceId, weekStart, actor?)` used by job AND A-8. Job: **every non-archived space with window activity (head OPTIONAL — headless departments still report)**, last completed week + **one-week self-heal** (generate previous week too if absent); after upsert, **atomic claim-then-notify**: `UPDATE … SET notified_at=? WHERE space_id=? AND week_start=? AND notified_at IS NULL` → affectedRows=1 ⇒ single `report_ready` fanout (deduped recipient set: owner/admin — via two role-filtered queries or a new `findActiveAdminIds` — plus head if set). Registry + **route** + dry_run + CLI. Jest: idempotency (job×2 + manual concurrent ⇒ exactly one fanout), self-heal, headless-space inclusion, no-activity skip.
- **P21 · On-demand + note + ack (A-8/A-9/A-10).** Literal-before-`:id` route order; `report.invalid_week` (past Dhaka Monday only); limiter clone; ack idempotent-200; snapshot-head gate on A-9. Jest matrix.
- **P22 · Notifications UX.** (types/icons already live since P12) — `task_reviewed` click → task drawer deep-link (`/t/:id` → `?task=` redirect, verified); inbox rendering polish; notifications module regression + e2e inbox spec re-run. (`report_ready` deep-link lands with the route in P24.)
- **P23 · Cron + ops docs.** Cron line (weekly Mon 09:00 Dhaka) into gate-report KI-9 list + LOCAL_RUN_GUIDE; CLI dry-run proof on QA. Doc-only.

### STAGE F — HR dashboard, frontend (P24–P27)
- **P24 · /reports plumbing.** Route + Sidebar item; **gate = owner/admin OR heads-any** (same derivation as P13 — heads must reach own reports; in-page check + `<Navigate to="/">`); list page (week nav × dept cards, generated/acknowledged chips, totals preview); `report_ready` inbox deep-link → `/reports/:id`; smoke.pw.ts AUTHED_ROUTES += `/dept`, `/reports`.
- **P25 · Report detail.** Clean layout: header (dept/week/head/generated_at), delta arrows (prev_week "—" when null), member table (camelCase payload types; deactivated muted; Unassigned row), flags w/ notes+reviewer, accountability line (incl. self_reviewed), head_note, **"updated after ack" chip when generated_at > acknowledged_at**; `@media print` hiding AppShell chrome (Sidebar/Topbar wrap every authed route).
- **P26 · Actions.** Mark seen (👑), Generate now/Regenerate (confirm modal), head_note editor (snapshot-head, counter). Invalidation + onError everywhere.
- **P27 · Stage-F browser pass.** Job → notification → deep-link → detail → ack; regenerate; note. Fix nits; log.

### STAGE G — Hardening (P28–P30)
- **P28 · Permission + isolation sweep.** Every new endpoint × {owner, admin, head, other-member, guest, cross-workspace, snapshot-head-after-change, deactivated-head} matrix + archived-space edges.
- **P29 · Full regression.** Per-module jest: tasks, spaces, statuses, notifications, jobs, users, deptreview + `tsc` ×2 + vitest + eslint zero-new.
- **P30 · Playwright E2E.** `client/e2e/dept-review.pw.ts` end-to-end (assign → review → flag notif → job → HR ack) per Stage-K infra recipes.

### STAGE H — Ship gate (P31)
- **P31 · Final gate.** UI polish (copy/dark-theme/keyboard), API_DESIGN.md addendum, README/gate entries, demo checklist, zero-open triage, memory update. Sign-off.

---

## 7. Phase → file map (verified — includes every touchpoint the audit found)

| Area | Files |
|---|---|
| Schema | `database/schema.sql` (spaces · tasks · task_reviews · department_reports · notifications §29 ENUM · **user_notification_prefs §29b ENUM**) · `db/schema/{_shared,hierarchy,tasks,notifications}.ts` · new `db/schema/reviews.ts` + reports table file · **`db/schema/index.ts` barrel** · `database/upgrades/001-003_*.sql` |
| Backend new | `services/{Reviews,ReportStats,Reports}Service.ts` · `repositories/{Reviews,DepartmentReports}Repo.ts` · `controllers/{Reviews,Reports}Controller.ts` · `serializers/{review,report}Serializer.ts` · `validators/{reviews,reports}.ts` · `routes/reports.ts` · `jobs/departmentReport.ts` |
| Backend touched | `routes/{spaces,tasks,jobs,users}.ts` (DI + mounts) · `controllers/SpacesController.ts` (toWireSpace) · `services/{Spaces,User,TaskWrite,Statuses}Service.ts` · `repositories/SpacesRepo.ts` (4 projection sites) · `types/spaces.ts` · `serializers/taskSerializer.ts` · `validators/spaces.ts` · `jobs/index.ts` · `db/schema/_shared.ts` (DONE_STATUS_GROUPS hoist) |
| Server tests | new `tests/dept-review/*` + 4-file jest kit (`jest.deptreview.config.cjs` + 3 test-utils companions) · **update SPACE_KEYS ×4** (`tests/spaces/{create,update,get,list}.test.ts`) · **TASK_KEYS ×2** (`tests/tasks/{get-by-id,list-by-list}.test.ts`) · regressions: tasks {update,bulk,lifecycle}, statuses, notifications, jobs, users, spaces |
| Frontend new | `pages/dept/*` · `pages/reports/*` · dept/report hooks (`hooks/`) · api wrappers (cursor-aware, NOT unwrapData) |
| Frontend touched | `router.tsx` · `Sidebar.tsx` · `pages/space/SpacePage.tsx` (new head card) · `TaskDetailDrawer.tsx` (+ReviewSection) · **`pages/inbox/InboxPage.tsx` (TYPE_ICONS + fallback — crash fix, P12)** · `types/index.ts` (Task, Space, NotificationType, entityType — 4 distinct edits) · `http/api.ts` · `e2e/smoke.pw.ts` routes · new `e2e/dept-review.pw.ts` |

---

## 8. v1.1 verification changelog (what the adversarial pass changed)

1. **Migrations frozen** — v1.0's "hand-add journal entry" would have repeated the 0005 mistake ×3 (drizzle-kit snapshot poisoning). Now: schema.sql + Drizzle + `database/upgrades/` scripts only.
2. **`user_notification_prefs.type` second ENUM copy** added to every ALTER (missing it = MySQL 1265 on prefs save).
3. **Inbox crash sequencing** — client notification types/icons/fallback moved P22→P12 (server emits `task_reviewed` from P8; InboxPage `TYPE_ICONS[n.type]` destructure would crash the whole app); pre-existing type-union drift fixed same phase.
4. **P9 rewritten** — reset now covers single PATCH + **bulk** + a 409 guard on status-group reclassification (three verified bypass paths); bulk's completed_at-rewrite and archived-target holes fixed alongside.
5. **Done-authority locked** — live `status_group` join, not `completed_at`.
6. **Clock-domain self-contradiction fixed** — `task_reviews.created_at` app-written UTC (no DB default); `dhakaToday/dhakaDateOf` helpers; `completed_late`/`overdue_now`/`last_activity` semantics pinned.
7. **Report fanout race/suppression fixed** — `notified_at` claim column + atomic claim-then-notify shared by job and manual generate.
8. **Headless departments still report** (job no longer skips → HR isn't blind when a head leaves); flags carry `reviewer`; `self_reviewed` transparency counter (D-6).
9. **Stats precision locked** — per-assignee member rows vs task-deduped totals; synthetic Unassigned row; archived-traversal predicate; prev_week provenance; deactivated flagged; subtask rules (+ dead `subtasks_count` columns banned).
10. **`internal_id` added to both new tables** (repo keyset-cursor convention); A-6 composite cursor.
11. **Retention protected** — `department_reports` space-FK → RESTRICT + 409 `space.has_reports`; reviewer FK → RESTRICT.
12. **Guard style corrected** — service-level (`requireHeadOrAdmin`), not middleware (repo convention).
13. **P5 reality-fixed** — no spaceSerializer file (toWireSpace inline), both `head_user_id`+`head` on the wire incl. LIST (P13 dependency), batch hydration, logo_url nullable-validator pattern, SpacesRepo projections, deactivate-hook exact location, DI ripples.
14. **P7 reality-fixed** — Space settings surface doesn't exist; new SpacePage card; dual invalidation keys.
15. **Cursor-aware client wrappers spelled** (`unwrapData` banned for new lists); review mutations banned from reusing `useTaskMutations`' buggy rollback.
16. **Exact test-breakage enumerated** — SPACE_KEYS ×4, TASK_KEYS ×2, named regressions (nothing else breaks; enum append breaks zero tests — verified).
17. Misc: ack idempotency contradiction resolved; A-8 week validation; missed-cron self-heal; ROW_FORMAT=DYNAMIC; route-order and mount points verified collision-free; smoke.pw.ts routes; print CSS + AppShell chrome; ⚠️ `reviewer_id` (PR) vs `reviewed_by` (dept) copy disambiguation.

---

*v1.1 authored 2026-07-21 after a 4-agent adversarial verification (~800k audit tokens) of v1.0 against the working tree. Protocol: one phase per prompt — "phase N koren".*
