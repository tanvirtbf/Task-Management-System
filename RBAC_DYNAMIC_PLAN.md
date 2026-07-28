# 🔐 Dynamic RBAC — Full System Scan + Phase-wise Build Plan

**Date:** 2026-07-24 · **Status:** PLAN (nothing built yet) · **Supersedes:** `RBAC_TEAMS_REQUIREMENTS.md` (2026-07-14 draft, static-roles model, never started)

**Goal (user's words):** *"RBAC module ta fully dynamic chai … obosshoi jeno fully workable hoy, kono issue/bug jeno na hoy implementation er por."*

**Fully dynamic** here means, concretely:
1. An admin can **create custom roles** in the UI (not just the fixed owner/admin/member/guest).
2. An admin can **edit exactly which permissions each role has**, from a catalog, with a **scope** per permission (everywhere / only my spaces / only my own items).
3. Roles can be assigned **workspace-wide OR per-space** — so one person can be a Manager in Marketing and a read-only viewer in Engineering.
4. **Visibility is enforced in SQL** — you cannot see (or even fetch by id) what you have no permission for.
5. The **UI mirrors** the resolved permissions (buttons/pages appear only if you actually can).

**Protocol:** this plan is phase-wise. You say **"RBAC phase N koren"** and ONLY that phase gets built → tested → verified → logged to `RBAC_BUILD_LOG.md`. One phase at a time (same workflow as Dept-Review V1 and the AI-assistant upgrade, both of which shipped clean).

---

# PART 1 — SCAN FINDINGS (what the system actually does today)

Based on a 4-agent deep scan (server authz surface · data layer · client · the old RBAC doc), verified file-by-file. **Do not re-audit these — they are current as of 2026-07-24.**

## 1.1 The headline: there is almost no access control

| Reality | Evidence |
|---|---|
| **~148 endpoints; only 47 have ANY role gate.** The other ~101 are "any authenticated user in the workspace." | `middlewares/canAccess.ts` used in 12 route files |
| **Any member — even a `guest` — can read ANY task in the workspace by id.** | `GET /tasks/:id` → `TasksRepo.findByIdOrCustomIdInWorkspace` → `WHERE workspace_id = ? AND id = ?`. No list/space/assignee predicate. |
| **`spaces.is_private` and `lists.is_private` are enforced NOWHERE.** Stored, validated, serialized — never in a `WHERE`. | `hierarchy.ts:48/:135`; zero predicate use across services/repos/controllers |
| **There is no membership model at all.** Nothing answers "which users belong to which space". | No `teams` / `space_members` / `list_members` table among the 37 tables |
| **Global search leaks everything** — task names, list names, space names, comment bodies, workspace-wide. | `SearchRepo.searchTasks/Lists/Spaces/Comments` — `workspace_id` only |
| **Home KPIs count the entire workspace** (`openTeamSeries`, `slaBreachesSeries` have no user filter). | `HomeRepo.ts` |
| **`guest` is a redaction role, not a restriction role.** A guest can create/edit/delete tasks, comment, assign people. It only loses `hidden_from_guests` custom-field values and attachment upload. | `TasksRepo.customFieldValuesByTask` is the ONLY guest predicate |
| **Client: ~150 mutating controls; 12 are role-gated, 1 is ownership-gated.** Invite member, workspace settings, delete list, bulk delete, form builder, on-call reassign — all visible to everyone. | `MembersSettings.tsx:109`, all 10 `/settings/*` pages, `BulkActionToolbar`, `FormBuilderPage` |
| **No client route guard checks role.** `/settings/members`, `/eng/on-call`, `/forms/:id/edit` are reachable by a guest. | `RequireAuth.tsx` checks presence of `user` only |
| **Role is read from the JWT, never the DB → a role change takes up to 15 minutes to take effect.** `changeRole` revokes nothing. | `authenticate.ts` does zero DB reads; `UserService.changeRole` writes the row only |

**Interpretation:** the app is currently a *trusted-workspace* tool. That was fine for a 12-person demo; for ~100 people with departments it is exactly the problem you raised.

## 1.2 What already works in our favour

| Asset | Why it matters |
|---|---|
| **`DepartmentReportsRepo.headVisibility`** — a `{userId, headedSpaceIds}` filter compiled into `OR(eq(head_user_id, me), inArray(space_id, ids))`, shared by BOTH the page query and the count query. | This is **already the exact pattern** we need, running in production. We generalize it instead of inventing something. |
| **`ReviewsService.requireHeadOrAdmin`** — resolve → 404 if out of tenant → 409 if archived → role short-circuit → scoped check → 403. | The house style for a policy function. `PolicyService` copies its shape. |
| **Keyset pagination on `internal_id`** everywhere. | Adding an `IN (...)` filter is **provably safe** for cursors — it only removes rows, never reorders. `DepartmentReportsRepo` proves it in prod. |
| **`idx_tasks_list_active (primary_list_id, …)`** is the hot index; `tasks` has **no** `workspace_id`-leading index. | Filtering tasks by **list ids** uses the hot index and is *faster* than today's effective full-table scan. Visibility will make some queries quicker, not slower. |
| **Every service already receives `{workspaceId, actorId, role}`** from its controller. | The plumbing for a policy check already exists at every call site. |
| Per-module jest kit + the P28-style permission-sweep pattern from Dept-Review. | The test strategy is proven on this codebase. |

## 1.3 The old RBAC doc — verdict

`RBAC_TEAMS_REQUIREMENTS.md` (488 lines, DRAFT, never started) proposes **STATIC** roles: it says in §9 *"Out of scope (V2+): **Custom roles**"*, keeps `users.role` as a fixed 4-value enum, and encodes the 41-row matrix as a TypeScript `Action` union unit-tested "every matrix row × role". Membership/scope would be dynamic; **capabilities would not**. That does not meet your requirement.

It also now **conflicts with what shipped since** (Dept Review V1):

| Conflict | Old doc | Shipped reality | This plan's resolution |
|---|---|---|---|
| People-grouping | separate `teams` entity, *"not space = team"* | **Space = department**, `spaces.head_user_id` | **Space stays the department.** No `teams` table — it would create two competing groupings. Membership attaches to spaces. |
| Membership | explicit `team_members` rows | derived from task assignees | **Explicit `user_roles` rows** (derived membership can't express "member of a space with no tasks" and can't be revoked without unassigning work). Assignee-derivation is used ONLY as a one-time backfill seed. |
| Leaders | 1+ leaders per team | exactly 1 `head_user_id` | `head_user_id` stays (review feature owns it). Additionally, any number of people can hold a role scoped to that space. |
| Reports | `team_reports` with draft/submitted/reviewed + free-text | `department_reports`, auto-generated payload + head_note + ack | **Drop `team_reports` entirely.** Already shipped, differently and better. |
| `/reports` API | `PATCH /reports/:id` = edit draft | `PATCH /reports/:id` = set head_note | Namespace is taken. RBAC uses `/roles`, `/permissions`, `/spaces/:id/members`. |
| Migrations | *"`drizzle-kit push` as today"* | **journal FROZEN** since 2026-07-21 | 3-file rule + `database/upgrades/004_*.sql`. Never run `drizzle-kit generate`. |
| Guard style | `middlewares/requirePermission.ts` resolving resources | repo convention = **service-level** guards | **Both**, with clear division (see §2.5). |

**What we keep from the old doc:** the permission-matrix content as the *seeded default configuration* (not as the model), the visibility algorithm shape, the cross-team flow whitelist, the "dormant until configured" rollout principle, and the NFRs.

---

# PART 2 — THE DESIGN (fully dynamic)

## 2.1 Concept model

```
Workspace
├── PERMISSIONS  (catalog — seeded from code, ~55 keys, never user-editable)
│     e.g. task.view · task.edit · task.delete · space.create · member.invite
│          review.perform · report.ack · role.manage · workspace.settings
│
├── ROLES  (fully user-definable, per workspace)
│     ├─ system roles (seeded, protected): Owner · Admin · Member · Guest
│     └─ custom roles (created in the UI): "Marketing Manager", "CS Agent", "Intern", …
│           each role = a set of (permission, scope) grants
│
├── GRANT SCOPE  (per permission, inside a role) — this is what makes ▲/◐ expressible
│     all   → everywhere in the workspace
│     space → only in spaces where the holder has this role
│     own   → only items the holder created / is assigned to
│
├── ASSIGNMENTS  (user_roles) — a user holds a role EITHER
│     workspace-wide  (scope_type='workspace')            → applies everywhere
│     or per-space    (scope_type='space', scope_id=…)    → applies in that space
│         └─ holding ANY role in a space = MEMBERSHIP of that space
│
└── SPACES = departments (unchanged). `head_user_id` (review feature) stays as-is.
    Lists/tasks/content inherit visibility from their space.
```

**Example of what becomes possible:** create a role "CS Agent" with `task.view=space`, `task.edit=own`, `comment.create=space`, `attachment.upload=space`, nothing else. Assign it to Arif scoped to the *Customer Service* space. Arif then sees only CS — not Marketing, not Engineering — and can only edit tasks assigned to him. All enforced in SQL.

## 2.2 Schema (new — 4 tables + 1 column)

Additive only. Ships as the 3-file rule (`database/schema.sql` + Drizzle TS + `database/upgrades/004_rbac.sql`).

```
permissions            -- CATALOG. Seeded from code on boot; rows are reference data.
  key            VARCHAR(64) PK        -- 'task.edit'
  group_key      VARCHAR(40)           -- 'tasks'  (UI grouping)
  label          VARCHAR(120)          -- 'Edit tasks'
  description    VARCHAR(300)
  scopes         VARCHAR(60)           -- CSV of allowed scopes: 'all,space,own'
  is_dangerous   BOOLEAN               -- delete/role.manage → red in the UI
  position       INT

roles
  id             VARCHAR(64) PK        -- 'rol-…'
  workspace_id   → workspaces CASCADE
  key            VARCHAR(60)           -- 'owner' | 'admin' | 'member' | 'guest' | 'custom-…'
  name           VARCHAR(80)           -- editable display name
  description    VARCHAR(300)
  color          CHAR(7)
  is_system      BOOLEAN DEFAULT 0     -- system roles cannot be deleted; owner cannot be edited
  rank           INT                   -- for escalation guard + display order (owner=0)
  created_by     → users RESTRICT
  archived_at, created_at, updated_at
  UNIQUE (workspace_id, key)

role_permissions
  role_id        → roles CASCADE
  permission_key → permissions RESTRICT
  scope          ENUM('all','space','own') NOT NULL
  PRIMARY KEY (role_id, permission_key)
  -- absence of a row = NOT granted. There is no explicit deny (see D-4).

user_roles                        -- assignments AND space membership, one table
  id             VARCHAR(64) PK
  workspace_id   → workspaces CASCADE
  user_id        → users CASCADE
  role_id        → roles CASCADE
  scope_type     ENUM('workspace','space') NOT NULL
  scope_id       VARCHAR(64) NULL       -- spaces.id when scope_type='space' (FK, CASCADE)
  granted_by     → users SET NULL
  created_at
  UNIQUE (user_id, role_id, scope_type, scope_id)
  INDEX (user_id, scope_type)           -- the hot lookup
  INDEX (scope_id)                      -- "who is in this space"

workspaces.permissions_version  INT NOT NULL DEFAULT 1
  -- bumped on ANY role/permission/assignment change → instantly invalidates the
  -- per-request permission cache. This is what removes the 15-minute stale window.
```

`users.role` **stays** as a denormalized mirror of the user's workspace-scoped system role (JWT, invitations, and ~40 existing code paths depend on it). The dynamic layer is authoritative; a small sync keeps the column truthful. Retiring it is explicitly out of scope (too much blast radius, no user-visible gain).

## 2.3 Resolution engine

```
PolicyService.resolveActor(userId) → ActorPermissions      [cached by (userId, permissions_version)]
  {
    userId, workspaceId,
    isOwner: boolean,                       -- hard-wired anti-lockout floor
    perms: Map<permissionKey, {
        scope: 'all' | 'space' | 'own',     -- BEST scope across all held roles
        spaceIds: Set<string>               -- spaces where a 'space'-scoped grant applies
    }>
  }

can(actor, 'task.edit', { spaceId?, ownerId?, assigneeIds? }) → boolean
   grant.scope === 'all'   → true
   grant.scope === 'space' → spaceId ∈ grant.spaceIds
   grant.scope === 'own'   → actor is creator or assignee
   no grant                → false

VisibilityScope.for(actor) → { kind:'all' } | { kind:'scoped', spaceIds[], listIds[] }
   derived from the `space.view` grant. Materialised ONCE per request.

scopePredicate(scope, { spaceCol | listCol }) → SQL | undefined
   kind 'all'            → undefined      (Drizzle drops it → byte-identical SQL to today)
   kind 'scoped', empty  → sql`1=0`       (NEVER inArray(col, []) — known hazard)
   kind 'scoped'         → inArray(col, ids)
```

**Precedence: allow-wins union, best-scope wins** (`all` > `space` > `own`). If you hold two roles, you get the union of their grants. There is **no explicit deny** in V1 — deny-rules are the single biggest source of "why can't this person do X" bugs, and you can express everything you need without them. (Overridable at P0 — see D-4.)

## 2.4 Enforcement architecture (three layers, each mandatory)

| Layer | What it enforces | Where |
|---|---|---|
| **Middleware** `requirePermission('x')` | the **verb** — coarse, route-declarative. Replaces the 47 `canAccess(...)` call sites 1:1. | `middlewares/requirePermission.ts` |
| **Service** `assertCan(actor, 'x', resource)` | the **object** — "this task, in this space, created by whom". First statement of every mutating service method. Produces the correct 403 taxonomy. | `services/PolicyService.ts` |
| **Repository** `scopePredicate(scope, …)` | the **rows** — pushed into `WHERE`. Non-negotiable for anything paginated: post-filtering breaks `total_estimate`, `has_more` and cursors. | ~20 repo methods |

**Why all three:** middleware alone leaves 101 endpoints open; service alone corrupts pagination; repo alone can't express verbs. The Dept-Review feature already demonstrates exactly this split working.

## 2.5 Rollout safety — "dormant until configured"

This is the single most important decision for *"kono bug jeno na hoy"*:

**The seeded default configuration reproduces today's behaviour exactly.**
- 4 system roles are seeded with grants equal to the current rules (Owner=everything, Admin=everything except delete-workspace, Member=today's member powers with `space.view=all`, Guest=today's guest powers).
- Every existing user is backfilled a workspace-scoped assignment matching `users.role`.
- Therefore, on the day this ships: **nothing changes for anyone**, and all ~2,800 existing server tests + the demo data keep working.
- Then the admin **tightens** it from the Roles UI — create custom roles, flip `space.view` from `all` to `space`, assign people to their departments. A one-click **"Department mode" preset** is provided (P35) that does this for the current 6 departments so you can see it working immediately.

Rollback = flip the grants back / delete the custom roles. The new tables are inert if unused.

---

# PART 3 — LANDMINES (found during the scan; each has a phase that defuses it)

These are the things that would silently break if we were careless. **Every one is assigned to a phase.**

| # | Landmine | Defused in |
|---|---|---|
| **L1** | **Dept-review stats would silently go wrong.** `/dept` review-queue and `ReportStatsService.computeWeek` scan ALL tasks in a space (they're head/admin-gated at the boundary). Once visibility is in the repos, they'd be filtered by the *caller's* scope and produce wrong numbers. | **P9** — explicit `SystemScope`/elevated context; **P19/P32** re-verify report numbers |
| **L2** | **Filter/count desync.** `total_estimate` comes from a separate COUNT. Repos with TWO edit sites: `ReviewsRepo.queuePage` vs `queueCount`; `WorkspaceActivityRepo.listRecent` vs `feedWhere`. | **P16–P19** (checklist per repo) + **P32** assertion |
| **L3** | `inArray(col, [])` produces invalid SQL / matches nothing silently. | **P8** — `scopePredicate` emits `sql\`1=0\`` |
| **L4** | **Public form submit** (`resolveBySlug`) is unauthenticated and must NOT be visibility-filtered, and it synthesizes `role: MEMBER` for the task write. | **P9** + **P20** carve-out |
| **L5** | **Background jobs have no `req.auth`** (`internalAuth` only). Every job-invoked service call needs a system principal. | **P9** |
| **L6** | **The 15-minute stale-role window.** A revoked permission must take effect NOW. | **P6** — DB-resolved + `permissions_version` cache key |
| **L7** | **Lockout.** An admin could remove the last `role.manage` holder, or delete their own admin role. | **P23** — refuse; owner is a hard-wired floor |
| **L8** | **Privilege escalation.** An admin granting a role more power than they hold. | **P23** — rank guard + audit |
| **L9** | **Existing ~2,800 tests assume open access.** | **P3** seeded default = today; **P33** full regression |
| **L10** | **Client cache poisoning.** After a permission change, react-query caches keep showing data (`staleTime 30s`, no refetch-on-focus, `queryClient.clear()` only on logout). | **P31** |
| **L11** | **Notifications / activity / sprints / on-call / tags / templates have NO join path to a space.** | **P22** — policy decisions (notifications = filter at WRITE time) |
| **L12** | **The AI assistant would leak.** Its `search` / `get_my_task_counts` / `get_my_agenda` tools run workspace-wide, and its knowledge base has a freshness guardrail test that fails if a shipped feature is undocumented. | **P22** (tool scoping) + **P35** (KB + `kb-coverage.test.ts`) |
| **L13** | **`users.role` denorm drift** between the column and `user_roles`. | **P3** sync rule + **P24** keeps them consistent |
| **L14** | **Migrations are frozen** — `drizzle-kit generate` would emit colliding DDL. | **P2** — 3-file rule, `upgrades/004` |
| **L15** | **`GET /metrics` is public**, outside auth and the rate limiter. | Noted; out of RBAC scope, flagged in P35 |

---

# PART 4 — DECISIONS (locked defaults — tell me at P0 to change any)

- **D-1 · Space = department = the unit of scope.** No `teams` table. Membership = holding any role scoped to that space. *(Avoids two competing groupings; matches what shipped.)*
- **D-2 · Explicit membership** via `user_roles`, with a **one-time backfill** from task assignees so the demo/live data starts sensible.
- **D-3 · Three scopes per grant:** `all` / `space` / `own`. *(Needed to express the ✅/▲/◐ distinctions; a boolean grant cannot.)*
- **D-4 · Allow-wins union, no explicit deny.** Simpler, far fewer surprise bugs. Deny can be V2.
- **D-5 · Permissions resolved from the DB per request**, cached by `(userId, permissions_version)`. Instant revocation. *(Not baked into the JWT.)*
- **D-6 · `users.role` stays** as a denormalized mirror of the workspace-scoped system role. Not retired.
- **D-7 · Owner is a hard-wired floor** — always all permissions, cannot be locked out, role not editable.
- **D-8 · Seeded default = today's behaviour** (dormant until configured), plus a one-click "Department mode" preset.
- **D-9 · Reads deny by 404** (no existence oracle — same as today's cross-workspace behaviour); **writes deny by 403** with a specific code.
- **D-10 · `head_user_id` stays** owned by the review feature. A head is not automatically a role-holder (but the preset assigns them one).
- **D-11 · Guest becomes a real restricted role** (no more "guest can edit anything") — via the seeded Guest role's grants, tightened in the preset, not by hardcoding.

---

# PART 5 — PHASES

36 phases (P0–P35), 8 stages. Each is small, independently testable, and ends deployable.

### STAGE A — Foundation (P0–P5)
- **P0 · Baseline & decisions.** Full DB backup; confirm green baseline (per-module jest, tsc ×2, vitest, e2e); lock D-1…D-11; create `RBAC_BUILD_LOG.md`. **No product change.**
- **P1 · Permission catalog (code).** `server/src/rbac/catalog.ts` — ~55 permission keys with group/label/description/allowed-scopes/danger flag, covering every action found in the scan **including the 7 dept-review keys the old doc missed** (`review.perform`, `review.read`, `report.view`, `report.generate`, `report.note`, `report.ack`, `space.head_assign`). Pure data + a completeness test. No enforcement yet.
- **P2 · Schema.** 4 tables + `workspaces.permissions_version`, via the 3-file rule + `database/upgrades/004_rbac.sql` (with rollback section). Drizzle schema files + barrel. Applied dev + QA. Fresh-provision parity check.
- **P3 · Seed system roles + backfill.** Seed Owner/Admin/Member/Guest with grants that **exactly reproduce today**; backfill `user_roles` from `users.role`; assignee-derived space membership backfill; update `seed.ts` + `seed-demo.ts`. **Snapshot test pinning the default matrix.**
- **P4 · Repos.** `RolesRepo`, `UserRolesRepo`, `PermissionsRepo` (+ catalog sync on boot) + repo tests.
- **P5 · Test harness.** `jest.rbac.config.cjs` + private DB + helpers (`makeRole`, `grant`, `assignRole`, `makeUserWithRole`).

### STAGE B — Policy engine (P6–P10)
- **P6 · `PolicyService.resolveActor`** + in-process cache keyed by `(userId, permissions_version)` + invalidation on any RBAC write. Tests incl. instant-revocation.
- **P7 · `can()` / `assertCan()`** + error taxonomy (`rbac.forbidden` + per-domain codes) + exhaustive scope-resolution tests (all/space/own × held-roles union).
- **P8 · `VisibilityScope` + `scopePredicate`** — materialise `spaceIds` + `listIds` once per request; the `1=0` / `undefined` rules; unit tests.
- **P9 · System & special principals** — job/system actor (bypass), public-form principal, **elevated scope for dept-review stats (L1)**, assistant tool context. Tests that prove report numbers are unaffected.
- **P10 · `GET /me/permissions`** (resolved set + visible space ids) and its inclusion in `/auth/me`; wire types.

### STAGE C — Write enforcement (P11–P15)
- **P11 · `requirePermission` middleware** + swap all 47 `canAccess` call sites 1:1 (seeded roles ⇒ **zero behaviour change**). Full route-table diff in the log.
- **P12 · Task writes** — create/edit/delete/archive/assign/bulk + `own`-scope resolution (creator/assignee). Tests.
- **P13 · Structure writes** — spaces/lists/statuses (+ space-scoped create/edit). Tests.
- **P14 · Content writes** — comments/checklists/attachments/custom-field values/dependencies/watchers/tags-on-task. Tests.
- **P15 · Admin, catalog & engineering writes** — members/invite/role-change, workspace settings, tags/types/fields/templates/forms, sprints, on-call, SLA, review + report actions. Tests.

### STAGE D — Read & visibility enforcement (P16–P22) — *ordered by leverage*
- **P16 · Spaces + Lists repos** (`SpacesRepo.listByWorkspace`/`findByIdInWorkspace`, `ListsRepo.listByWorkspace`/`findByIdInWorkspace`/`findRecordByIdInWorkspace`) — gates the tree and, transitively, most of the app. **Also finally enforces `is_private`.**
- **P17 · Tasks direct-read hole** — `findByIdOrCustomIdInWorkspace`, `findByIdInWorkspace`, `findManyByIdsInWorkspace`, `listChildren`, `myWorkRows`, `findBySprintInWorkspace` (filter on **list ids**, the hot index).
- **P18 · Search** — all 5 methods (biggest raw leak) + user-directory policy.
- **P19 · Aggregates** — Home KPIs (incl. the two workspace-wide series), SLA, Engineering home. **Re-verify dept-review report numbers (L1).**
- **P20 · Forms, statuses, custom fields** — one-liners where `spaces` is already joined + the **public-form carve-out (L4)**.
- **P21 · Task content** — comments/attachments/checklists/task-activity/dependencies via caller gating; `findById` holes closed.
- **P22 · No-join-path policy calls** — notifications (**filter at write time**), workspace activity, sprints, on-call, tags, templates + **assistant tool scoping (L12)**.

### STAGE E — Roles admin API + UI (P23–P27)
- **P23 · Roles CRUD API** — list/create/update/archive/delete/clone + `PUT /roles/:id/permissions` (the grid) + **guards: system-role immutability, lockout prevention (L7), escalation rank guard (L8)**, full audit rows.
- **P24 · Assignment API** — assign/revoke workspace- and space-scoped; `GET/POST/DELETE /spaces/:id/members`; keeps `users.role` in sync (L13).
- **P25 · Client foundation** — types, api wrappers, `usePermissions()` + `can()` helper, non-persisted permission slice (avoids stale localStorage).
- **P26 · Roles admin UI** — `/settings/roles`: role list, permission checkbox grid grouped by catalog, per-permission scope selector, clone, "who holds this role", danger highlighting, unsaved-changes guard.
- **P27 · Space members UI** — members panel on the Space page (add/remove people, pick their role in this space) + member chips.

### STAGE F — Client permission-awareness (P28–P31)
- **P28 · Route guards + navigation** — `<RequirePermission>`, sidebar/topbar items driven by resolved permissions (replaces the `role==="owner"||"admin"` string checks).
- **P29 · Action gating pass 1** — task CRUD, inline edits, bulk toolbar, drag-and-drop, structure controls (create/rename/archive/delete space+list).
- **P30 · Action gating pass 2** — settings pages, catalog CRUD, forms builder, engineering (on-call, sprints, bug fields), dept-review controls (incl. the `DeptQueue` vs `ReviewSection` inconsistency found in the scan).
- **P31 · 403 UX + cache hygiene (L10)** — interceptor 403 branch → refetch permissions; shared `<Forbidden/>`; Bangla copy; purge caches on permission change.

### STAGE G — Hardening (P32–P34)
- **P32 · Permission & isolation sweep** — every endpoint × {owner, admin, member, guest, custom-role, space-scoped, no-access, cross-workspace}; **IDOR probes** (foreign space id → 404); **escalation probes** (403); pagination/count parity assertions (L2); dept-review numbers unchanged (L1).
- **P33 · Full regression** — every per-module jest suite (tasks ×2, spaces, lists, statuses, tasks-content, forms, users, auth, notifications, jobs, eng, sla, search, home, deptreview, assistant, rbac) + server tsc + client tsc + vitest + eslint zero-new.
- **P34 · Committed E2E** — `client/e2e/rbac.pw.ts`: admin creates a custom role → assigns it space-scoped → that user sees only their department (sidebar, search, task-by-id 404, hidden buttons) → permission revoked → UI updates.

### STAGE H — Ship gate (P35)
- **P35 · Final gate** — apply the **"Department mode" preset** to the demo data so restriction is visible immediately; `API_DESIGN.md` §34; **assistant KB + `kb-coverage.test.ts` update (L12)**; Bangla admin guide (`RBAC_ADMIN_GUIDE.md`); gate-report entry; prod rollout notes (`upgrades/004` + preset); zero-open triage; memory update; sign-off.

---

# PART 6 — TEST STRATEGY (why this will be bug-free)

1. **Snapshot the default matrix (P3)** — pins "today's behaviour" as data. Any accidental change to the seeded grants fails a test.
2. **Resolver unit tests (P6–P8)** — precedence, union-of-roles, best-scope, cache invalidation, empty-set → `1=0`, `all` → no SQL change.
3. **Per-phase endpoint tests (P11–P22)** — each enforcement phase ships its own positive + negative matrix, exactly like Dept-Review's P28 sweep (which found zero defects because the tests came with the code).
4. **Pagination parity assertions (P32)** — for every scoped list: page rows ⊆ visible, `total_estimate` == count with the same predicate, cursor walk returns each row exactly once.
5. **IDOR + escalation probes (P32)** — the security tests the old doc's NFR-1 asked for.
6. **Full regression (P33)** — the ~2,800 existing tests must stay green; they will, because the seeded default reproduces today.
7. **Browser E2E (P34)** — proves the whole loop in a real browser with a real custom role.

---

# PART 7 — FILE MAP (what gets touched)

**New (server):** `src/rbac/{catalog.ts,scope.ts}` · `src/services/PolicyService.ts` · `src/repositories/{RolesRepo,UserRolesRepo,PermissionsRepo}.ts` · `src/middlewares/requirePermission.ts` · `src/routes/roles.ts` · `src/controllers/RolesController.ts` · `src/validators/roles.ts` · `src/types/rbac.ts` · `src/db/schema/rbac.ts` · `tests/rbac/*` · `jest.rbac.config.cjs` + 3 test-utils companions
**Changed (server):** `db/schema/{index,auth}.ts` · `database/schema.sql` · `database/upgrades/004_rbac.sql` · `middlewares/authenticate.ts` (actor resolution) · every route file (gate swap) · ~15 services (assertCan) · ~20 repo methods (scopePredicate) · `db/seed.ts` + `seed-demo.ts` · `assistant/tools.ts` + `knowledgeBase.ts`
**New (client):** `hooks/usePermissions.ts` · `lib/permissions.ts` · `components/shared/RequirePermission.tsx` · `pages/settings/RolesSettings.tsx` (+ permission grid components) · `components/space/SpaceMembersPanel.tsx` · `e2e/rbac.pw.ts`
**Changed (client):** `router.tsx` · `stores/auth.ts` · `types/index.ts` · `http/{api,client}.ts` · `lib/queryClient.ts` · `hooks/useReferenceData.ts` · Sidebar/SidebarSpaceTree/Topbar · ~25 action-bearing components
**Docs:** `RBAC_BUILD_LOG.md` (new) · `API_DESIGN.md` §34 · `RBAC_ADMIN_GUIDE.md` (new, Bangla) · `GO_LIVE_GATE_REPORT.md` · this file

---

# PART 8 — SIZE & SEQUENCING NOTES

- **Biggest phases:** P16–P19 (visibility in the repos) and P26 (permission grid UI). Everything else is small.
- **Riskiest phases:** P16–P17 (touching hot read paths) and P11 (gate swap). Both are protected by the "seeded default = today" invariant, so a mistake shows up as a *test failure*, not as a silent lockout.
- **First user-visible value:** P26/P27 (create a role, assign people) — but restriction only becomes real once the preset is applied at P35 (or manually any time after P24).
- **Deployable at every phase.** Nothing half-enforced ships: writes (Stage C) and reads (Stage D) both default to "as today" until grants are tightened.

---

*Compiled 2026-07-24 from a 4-agent full-system scan (server authz · data layer · client · legacy RBAC doc), all findings verified file-by-file. Nothing built yet — say **"RBAC phase 0 koren"** to start, one phase at a time.*
