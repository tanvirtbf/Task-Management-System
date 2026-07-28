# 🔐 Dynamic RBAC — Build Log

Per-phase execution log for `RBAC_DYNAMIC_PLAN.md`. Scan findings + design + landmines live in
that plan. Protocol: user says **"RBAC phase N koren"** → only that phase → build → test →
verify → log here. One phase at a time.

---

## Phase 0 — Baseline & decisions — ✅ COMPLETE (2026-07-25)

**No product changes.** This phase establishes the known-good starting point, locks the design
decisions, and records the exact "today" behaviour that the P3 seeded default must reproduce.

### 0.1 Safety

| Item | Result |
|---|---|
| Live DB backup before any schema work | ✅ `scratchpad/rbac-p0-backup-20260725-095051.sql` (177 KB, `--routines --triggers`, DB `taskmanagement` with the demo dataset) |
| RBAC tables already present? | ✅ **none** — `roles`/`permissions`/`role_permissions`/`user_roles`/`teams`/`team_members`/`space_members` absent in both `taskmanagement` and `taskmanagement_qa` |
| Next upgrade script number | **`004`** (existing: 001_dept_head_enums, 002_task_reviews, 003_department_reports) |
| Table count dev / qa | 37 / 37 (parity ✅) |

### 0.2 Baseline test results (the known-good line)

| Check | Result |
|---|---|
| Server `tsc --noEmit` | clean ✅ |
| Client `tsc -b --force` | clean ✅ |
| Client `vitest` | **6 files / 32 tests** ✅ |
| jest `spaces` | **7 suites / 244 tests** ✅ |
| jest `users` | **8 suites / 279 tests** ✅ |
| jest `auth` | **9 suites / 339 tests** ✅ |
| jest `tasks` | **10 suites / 359 tests** ✅ (see flake note) |
| jest `tasks10` | **10 suites / 359 tests** ✅ (see flake note) |

**Flake note (expected, documented pattern):** with three jest invocations hammering MySQL
concurrently, `tests/tasks/list-by-list.test.ts` reported 1 failure in BOTH tasks modules and
took 414 s (vs 352 s solo). A **solo re-run of that exact suite passed 100/100**, confirming a
load flake, not a defect. Judgement per the standing protocol: judge per module, solo re-run to
confirm. (Test count is 359, not the historical 358, because the gap-scan C5 fix added a
custom_id-addressed PATCH test to `update.test.ts`.)

Recently verified in the same working tree (unchanged since): jest `assistant` 52 ✅ ·
`deptreview` 122 ✅ · `jobs` 31 ✅ · `health` 14 ✅ · `attachments` 106 ✅ · `eng` 78 ✅ ·
`forms` 85 ✅ · `notifications` 84 ✅ · `statuses` 209 ✅ · assistant e2e 7/7 (live model) ·
dept-review e2e 3/3 · smoke+auth e2e 9/9.

**Known infra note (from prior phases):** the `tasks` and `tasks10` modules take ~25 min each
and, when several jest invocations run concurrently, occasional single-test load flakes appear
(documented pattern: solo re-run to confirm). Judge per module, never by a batch run.

### 0.3 Locked decisions (defaults accepted — P0 invoked without overrides)

D-1 Space = department = scope unit; **no `teams` table** ·
D-2 Explicit membership via `user_roles` (+ one-time assignee-derived backfill) ·
D-3 Three grant scopes `all` / `space` / `own` ·
D-4 Allow-wins union, **no explicit deny** (V2) ·
D-5 Permissions resolved from DB per request, cached by `(userId, permissions_version)` ·
D-6 `users.role` **kept** as a denormalized mirror ·
D-7 Owner = hard-wired floor (all permissions, not editable, cannot be locked out) ·
D-8 **Seeded default reproduces today exactly** (dormant until configured) + a one-click
"Department mode" preset at P35 ·
D-9 Reads deny by **404**, writes deny by **403** ·
D-10 `head_user_id` stays owned by the review feature ·
D-11 Guest becomes a genuinely restricted role via its seeded grants (not hardcoding).

### 0.4 TODAY'S EFFECTIVE AUTHORIZATION — the contract P3 must reproduce

Derived from the verified scan (route × gate table + 26 service-level guards). **If the seeded
roles produce anything different from this table, P3 has a bug.**

**Workspace-wide truths today:**
- Every authenticated user (incl. `guest`) can **read everything**: all spaces (private included), all lists, any task by id, all comments/attachments/checklists/activity, global search, all users, home KPIs, workspace activity.
- `is_private` on spaces/lists is **not enforced** anywhere.
- Only **47 of ~148** endpoints carry a role gate.

**Per system role — what it can DO today (mutations):**

| Capability | Owner | Admin | Member | Guest |
|---|---|---|---|---|
| View everything in the workspace | ✅ | ✅ | ✅ | ✅ (minus `hidden_from_guests` field values) |
| Create / edit / archive / soft-delete tasks (any task) | ✅ | ✅ | ✅ | ✅ |
| Hard-delete a task (`?hard=true`) | ✅ | ✅ | — | — |
| Assign / unassign anyone, tags, watchers, dependencies | ✅ | ✅ | ✅ | ✅ |
| Comments: create | ✅ | ✅ | ✅ | ✅ |
| Comments: edit own within 15 min | ✅ | ✅ | ✅ | ✅ |
| Comments: delete own / delete any | ✅ any | ✅ any | own | own |
| Checklists (all ops) | ✅ | ✅ | ✅ | ✅ |
| Attachments: upload | ✅ | ✅ | ✅ | **—** |
| Attachments: delete own / any | ✅ any | ✅ any | own | own |
| Custom-field **values** on tasks | ✅ | ✅ | ✅ | ✅ |
| Create / edit / archive **space**, **list** | ✅ | ✅ | — | — |
| **Delete** space / list | ✅ | — | — | — |
| Statuses CRUD + reorder | ✅ | ✅ | — | — |
| Task types / tags / custom-field **definitions** / templates CRUD | ✅ | ✅ | — | — |
| Apply a template | ✅ | ✅ | ✅ | ✅ |
| Forms: create/edit/delete/fields | ✅ | ✅ | — | — |
| Forms: read + submissions | ✅ | ✅ | ✅ | ✅ |
| Invite member / change role / deactivate / reactivate / admin reset-password | ✅ | ✅ | — | — |
| Change **own** profile | ✅ | ✅ | ✅ | ✅ |
| Edit another user's profile | ✅ | ✅ | — | — |
| Workspace settings | ✅ | ✅ | — | — |
| Sprints: create/edit/start/close | ✅ | ✅ | — | — |
| Sprints: add/remove tasks | ✅ | ✅ | ✅ | ✅ |
| On-call: set / clear a week | ✅ | ✅ | — | — |
| SLA override (`PATCH /tasks/:id/sla`) | ✅ | ✅ | — | — |
| Report a bug / postmortem / eng home | ✅ | ✅ | ✅ | ✅ |
| **Set a space's department head** | ✅ | ✅ | — | — |
| **Review a task (approve/flag)** | ✅ | ✅ | only if head of that space | — |
| **Review queue / summary** (`/dept`) | ✅ | ✅ | only if head | — |
| **Read a task's review history** | ✅ | ✅ | head **or task assignee** | assignee |
| **Reports list / detail** | ✅ all | ✅ all | only own (current or snapshot head) | — |
| **Generate a report on demand** | ✅ | ✅ | only current head | — |
| **Edit a report's head note** | **—** | **—** | **only the snapshot head** | — |
| **Mark a report seen (ack)** | ✅ | ✅ | — | — |
| Notifications (own only) | ✅ | ✅ | ✅ | ✅ |
| Assistant chat | ✅ | ✅ | ✅ | ✅ |
| Background jobs (`/jobs/*`) | — token-gated (`X-Internal-Token`), no user role — needs a **system principal** in P9 |

**Immutability / self-protection rules that are NOT permissions** (they stay in-service and must
survive P11–P15 unchanged): owner's role can't be changed · can't change your own role · owner
can't be deactivated · can't deactivate/reactivate yourself · system task types are locked ·
comment edit window 15 min · head must be an active non-guest.

### 0.5 P1/P2 inputs confirmed

- Permission catalog must cover the table above **plus** the 7 dept-review keys the old doc
  omitted: `space.head_assign`, `review.perform`, `review.read`, `report.view`,
  `report.generate`, `report.note`, `report.ack`.
- Schema work ships as the 3-file rule (`database/schema.sql` + Drizzle TS + barrel) plus
  `database/upgrades/004_rbac.sql` with a `-- rollback:` section. **Never** `drizzle-kit generate`.
- `_shared.ts` currently pins `userRoles = ["owner","admin","member","guest"]` — P2/P3 keep this
  tuple (D-6) and add the dynamic layer beside it.

### 0.6 Baseline verdict

**Everything green.** ~1,600 server tests across the six modules run here (spaces 244 · users
279 · auth 339 · tasks 359 · tasks10 359 · plus the recently-verified modules listed above),
both TypeScript builds clean, client vitest 32/32. The one reported failure was reproduced as a
concurrency flake and cleared by a solo re-run. Any red that appears from here on is
attributable to RBAC work.

**Verdict: Phase 0 COMPLETE — backup taken, environment verified clean of RBAC artifacts,
decisions locked, and today's authorization contract recorded for P3. Ready for
"RBAC phase 1 koren" (permission catalog in code — no enforcement).**

---

## Phase 1 — Permission catalog (code only) — ✅ COMPLETE (2026-07-25)

Pure additive: one new data module + one test suite + one jest config. **Nothing is enforced
yet** and no existing file was touched, so behaviour is byte-identical to P0.

### What shipped
- **`server/src/rbac/catalog.ts`** — **56 permission keys** across 12 groups, each with a stable
  `group.action` key, English label, plain-language description, the **scopes an admin may
  choose** (`all` / `space` / `own`), and a `dangerous` flag for the UI.

  | Group | Keys | | Group | Keys |
  |---|---|---|---|---|
  | workspace | 1 | | catalog | 5 |
  | members | 6 | | forms | 2 |
  | spaces | 7 | | engineering | 5 |
  | structure | 5 | | **review (dept)** | **6** |
  | tasks | 8 | | insights | 2 |
  | content | 7 | | rbac | 2 |

  12 keys are flagged **dangerous** · 37 support a **space** scope · 7 support **own**.

- Helpers the later phases consume: `getPermission`, `isPermissionKey`, `supportsScope`,
  `permissionsByGroup()` (renders the admin grid), `strongerScope()` (implements D-4's
  "widest grant wins" when a user holds several roles), plus a compile-time `PermissionKey`
  union and `PermissionScope` type.

- **`server/tests/rbac/catalog.test.ts`** (22 tests) and **`server/jest.rbac.config.cjs`**
  (deliberately DB-free at this phase — P5 adds the private-DB harness when the first
  DB-touching RBAC test lands).

### Design decisions made inside this phase
1. **No aspirational keys.** Catalog invariant #1: every key must map to a real enforcement
   point. That is why there is **no `workspace.delete`** (no endpoint exists — the UI button is
   inert) and **no import/export keys** (stubs). A test asserts these stay absent, so nobody
   "helpfully" adds a checkbox that does nothing.
2. **Scope availability is derived from the data model, not guessed.** Keys whose resource has
   no join path to a space — `sprint.manage`, `oncall.manage`, `activity.view`, `catalog.*`,
   `member.*`, `workspace.settings`, `role.*` — are **`all`-only**, because a space scope would
   be unenforceable (this is landmine L11 handled at the design layer). Tests assert both
   directions.
3. **`own` is offered on exactly 7 keys** (`task.view/edit/archive/delete`, `checklist.manage`,
   `customfield.set_value`, `review.read`) — the places where "created by me / assigned to me"
   is a real, checkable relationship. `task.view` with `own` is what keeps cross-department work
   visible to its reporter (e.g. a CS person who filed a bug into Engineering).
4. **Own-comment / own-attachment / own-profile actions are NOT permissions.** They stay
   in-service rules, exactly as today (`comment.delete_any` and `attachment.delete_any` gate
   only *someone else's*). This preserves the §0.4 contract without inventing keys.
5. Labels are English (consistent with every other on-screen label in the product); the Bangla
   admin guide lands in P35.

### Coverage guarantee
The test file re-encodes **every capability row of §0.4** as a required-keys list, grouped by
area (visibility+tasks, content, structure, catalog+forms, members+workspace, engineering,
**dept review — the 7 keys the legacy RBAC doc never had**, insights+rbac). P3 can therefore
seed the four system roles knowing the vocabulary is complete.

### Verified
- `jest.rbac` **1 suite / 22 tests** ✅ · server `tsc --noEmit` clean ✅ · eslint on the new
  file 0 errors ✅ · no existing file modified (no regression surface).

**Verdict: Phase 1 COMPLETE. Ready for "RBAC phase 2 koren" (schema: `permissions`, `roles`,
`role_permissions`, `user_roles` + `workspaces.permissions_version`, via the 3-file rule +
`database/upgrades/004_rbac.sql` with rollback, applied to dev + QA).**

---

## Phase 2 — Schema (4 tables + permissions_version) — ✅ COMPLETE (2026-07-25)

Purely additive. **No enforcement is wired to these tables yet**, so behaviour is unchanged;
this phase only creates the storage the policy engine will use.

### Shipped — the 3-file rule + the upgrade script
| Artifact | Contents |
|---|---|
| `database/schema.sql` | new **§38 permissions · §39 roles · §40 role_permissions · §41 user_roles**, plus `workspaces.permissions_version` (placed `AFTER fiscal_year_start_month` so both build paths order identically) |
| `server/src/db/schema/rbac.ts` | Drizzle mirror of all four tables + `$inferSelect/$inferInsert` types |
| `server/src/db/schema/index.ts` | barrel export |
| `server/src/db/schema/_shared.ts` | `permissionScopes` (`all`/`space`/`own`) + `roleScopeTypes` (`workspace`/`space`) ENUM tuples |
| `server/src/db/schema/auth.ts` | `workspaces.permissionsVersion` (the cache stamp that removes the ~15-min stale-role window) |
| `database/upgrades/004_rbac.sql` | the upgrade path for provisioned DBs, with a `-- rollback:` section |

**Model recap:** `permissions` = the catalog (reference data, synced from `src/rbac/catalog.ts`
at boot in P4) · `roles` = per-workspace and user-definable (4 seeded as `is_system` in P3) ·
`role_permissions` = `(role_id, permission_key, scope)`, absence = not granted, **no explicit
deny** · `user_roles` = assignments where `scope_type='space'` **is** that user's membership of
the space (no separate members table, per D-1/D-2).

### Three real defects caught and fixed during this phase
1. **MySQL reserved words.** `key` (KEY) and `rank` (RANK, a MySQL 8 window function) would have
   forced backticks into every hand-written query and upgrade script. Renamed up front to
   `permission_key` / `role_key` / `rank_order`; a test now asserts `key`/`rank` never come back.
2. **A NULL-unsafe UNIQUE key (silent duplicate grants).** `UNIQUE (user_id, role_id, scope_type,
   scope_id)` does **not** work, because MySQL treats NULLs as distinct — the same workspace-wide
   grant could be inserted twice. Fixed with a generated `scope_key = IFNULL(scope_id, '*')`
   column in the unique key. **Proven on a throwaway DB:** the second identical workspace grant
   fails with `1062 Duplicate entry '…-workspace-*'`, while a space-scoped grant for the same
   user+role still succeeds.
   - It must be **VIRTUAL, not STORED** — MySQL rejects an `ON UPDATE CASCADE` foreign key on a
     base column of a STORED generated column (**error 1215**, hit on the first apply attempt),
     and `scope_id` is both the `spaces` FK and the expression's base.
3. **Charset drift between build paths.** Applying the script with the Windows `mysql.exe`
   client tagged the `ck_roles_color` CHECK literal `_cp850`, while a `schema.sql` provision
   (node/mysql2) produced `_utf8mb4` — the live DB uses `_utf8mb4`, so the documented CLI apply
   would have introduced drift. Fixed with `SET NAMES utf8mb4;` at the top of the script.

### Verified
- **Dual-path parity (the real proof):** a clone of the live dev DB upgraded with `004`, and a
  fresh `db:setup` from `schema.sql`, produce **byte-identical `SHOW CREATE TABLE` for all four
  tables** and an identical `workspaces` column list/order. Re-checked after the charset fix.
- Applied for real: **dev + QA now at 41 tables**; demo data intact (12 users / 46 tasks /
  12 reports), `permissions_version = 1`, the four new tables empty (P3 fills them).
- `permissions_version` does **not** leak to the wire — `WorkspaceController.toWireWorkspace` is
  an explicit field projection, verified.
- Test-harness compatibility: every per-module reset is information_schema-driven (dynamic), and
  the dept-review harness filters by explicit table names — so 41 tables breaks nothing.
- `jest.rbac` **2 suites / 30 tests** ✅ (new `schema.test.ts` pins the DB-ENUM ⇄ catalog scope
  parity, the reserved-word-safe column names, and that `scope_key` stays unmodelled) ·
  server `tsc` clean ✅ · eslint on all touched schema files 0 errors ✅.
- Regression after the schema change: `workspace` **84** ✅ · `deptreview` **122** ✅ ·
  `spaces` **244** ✅.
- Throwaway verification DBs dropped; `database/upgrades/README.md` tracker updated.

**Verdict: Phase 2 COMPLETE. Ready for "RBAC phase 3 koren" (seed the 4 system roles so they
reproduce RBAC_BUILD_LOG §0.4 exactly, backfill `user_roles` from `users.role`, seed space
membership from task assignees, update `seed.ts` + `seed-demo.ts`, and pin it all with a
snapshot test).**

---

## Phase 3 — Seed the system roles + backfill — ✅ COMPLETE (2026-07-25)

The phase that makes RBAC a **no-op on the day it ships**: the seeded roles reproduce
§0.4 exactly, so nothing changes until an admin tightens things.

### Shipped
- **`server/src/rbac/bootstrap.ts`** — idempotent, four functions + one orchestrator:
  `syncPermissionCatalog` (upserts the 56 catalog rows) · `seedSystemRoles` (creates
  owner/admin/member/guest and re-asserts their grants) · `backfillUserRoles` (every user gets a
  workspace-scoped assignment of the role matching `users.role`) · `backfillSpaceMembership`
  (derives a starting membership map from task assignees + space heads) · `bootstrapRbac`.
- Wired into **`db/seed.ts`** and **`db/seed-demo.ts`** so every fresh install is RBAC-ready.
- **`tests/rbac/system-roles.test.ts`** — the contract test (see below).

### The seeded matrix (pinned by the snapshot test)
| Role | Grants | Definition |
|---|---|---|
| **guest** | **19** | exactly what any authenticated user can do today, minus file upload |
| **member** | **20** | guest + `attachment.upload` — *the only member/guest difference that exists today* |
| **admin** | **53** | member + everything the `canAccess([OWNER, ADMIN])` gates protect |
| **owner** | **56** | admin + `space.delete` + `list.delete` (owner-only routes) + `report.note` |

Every seeded grant is scope **`all`**, because every capability today is workspace-wide. That
single fact is what makes "reproduces today" provable rather than hopeful.

### Two design rules fixed in this phase (they govern P6 and P11–P15)
1. **Permissions are ADDITIVE to today's in-service rules.** The finer identity rules — head of
   space, snapshot head, comment author, attachment uploader, self-profile, the 15-minute edit
   window, owner immutability — are *not* replaced by permission keys. They stay exactly where
   they are and act as extra allow-paths. That is why a department head who is only a "member"
   keeps reviewing without any grant, and why P11 can swap `canAccess` → `requirePermission` 1:1
   with zero behaviour change.
2. **Effective scope = the narrower of (assignment scope, grant scope)** — written up in the
   file header and now the spec for P6:
   - assignment workspace + grant `all` → everywhere; + grant `space` → **no spaces** (an
     explicit assignment is what "space" means; the P26 UI will warn); + grant `own` → own items
   - assignment space(S) + grant `all` → **downgraded to {S}** ← the escalation guard; a
     space-scoped assignment can never reach outside its space
   - assignment space(S) + grant `space` → {S}; + grant `own` → own items within {S}

### The one intentional deviation, stated plainly
`report.note` is seeded to the **owner only**. Today the head note is snapshot-head-only and
even an admin is refused — that in-service rule stays, so **admin/member/guest behaviour is
unchanged**. The owner receives it because D-7 defines the owner as holding every permission
(the anti-lockout floor). Net effect: the founder may now also write a report head note. One
account, one non-destructive action, documented rather than hidden.

### Verified
- `jest.rbac` **3 suites / 45 tests** ✅ — the contract test pins the exact GUEST set and the
  exact member/admin/owner deltas, asserts monotonicity (owner ⊇ admin ⊇ member ⊇ guest), that
  owner holds all 56 catalog keys, and re-states §0.4 as readable spot-checks (only owner may
  delete a space/list · guests cannot upload · members get no admin surface · review/report stay
  admin-or-head · `report.note` is owner-only).
- **Ran against the real databases:** dev → `perms=56 roles=4 wsGrants=12 spaceGrants=13`;
  QA → `perms=56 roles=4 wsGrants=4 spaceGrants=7`.
- SQL verification on dev: grants per role **56 / 53 / 20 / 19** (matches the test exactly) ·
  every user's workspace grant matches their legacy `users.role` · **0 users without a grant** ·
  all 148 `role_permissions` rows are scope `all`.
- **Idempotency proven:** two extra bootstrap runs left `roles/grants/assignments/permissions`
  at `4/148/25/56` — unchanged.
- **Both fresh-install paths proven on throwaway DBs:** `db:setup` + `seed.ts` → 56/4/148/1, and
  `db:setup` + `seed-demo.ts` → 56/4/148, 12 workspace + 13 space assignments with a sensible
  derived map (2–3 members per department). Throwaways dropped.
- server `tsc` clean ✅ · eslint on `src/rbac/` + both seed files 0 errors ✅ (fixed 2 nits found
  here: a redundant type assertion, and a pre-existing unused `getDb` import in `seed-demo.ts`).

**Verdict: Phase 3 COMPLETE — the dynamic layer now exists in data and provably equals the old
static behaviour. Ready for "RBAC phase 4 koren" (repositories + boot-time catalog sync).**

---

## Phase 4 — Repositories + boot-time catalog sync — ✅ COMPLETE (2026-07-25)

### Shipped
- **`PermissionsRepo`** — `syncCatalog()` (idempotent upsert of the 56 catalog entries; code is
  the source of truth, the table is a queryable mirror), `listAll()` in display order,
  `listKeys()` for grant validation. **Rows are never deleted** — the `role_permissions` FK is
  RESTRICT so a key somebody already granted cannot silently vanish.
- **`RolesRepo`** — `listByWorkspace` (rank-ordered, archived hidden by default),
  `findByIdInWorkspace` / `findByKeyInWorkspace` (tenant-scoped → `null` for another workspace),
  `create` / `update` / `deleteById`, `permissionsForRole`, **`replacePermissions`**
  (delete-then-insert so the permission grid saves atomically), `countHolders`,
  **`countUsersWithPermission`** (the input the P23 anti-lockout guard needs), and
  **`bumpPermissionsVersion` / `getPermissionsVersion`** — the cache stamp every RBAC mutation
  must bump so a revoked permission takes effect on the next request, not up to 15 minutes later.
- **`UserRolesRepo`** — **`listEffectiveGrants`** (THE hot query: one join returning
  `permission_key + grant scope + assignment scope`, everything the P6 resolver and the P8
  visibility scope need, archived roles excluded), `listForUser`, `listBySpace` (the P27 members
  panel), `assign` (idempotent — the NULL-safe unique key absorbs repeats), `revoke` /
  `revokeById` / `revokeAllForUser`, `spaceIdsForUser` (a user's membership set).
- **Boot-time sync** wired in `server.ts` right after `initDb()`. Deliberately **non-fatal**: a
  sync failure logs an error and boots anyway, because the previously synced catalog is far more
  useful than a server that refuses to start.
- **Test harness pulled forward from P5** — `db-name-rbac.ts` + `global-setup-rbac.ts` +
  `setup-each-rbac.ts` on the private DB `tms_rbac_test`, wired into `jest.rbac.config.cjs`
  (DELETE-based dynamic reset, per the documented contention rule). P5 is now only whatever
  extra factories later phases need.

### Verified
- `jest.rbac` **4 suites / 65 tests** ✅ (was 45 — +20 repository tests against a real DB).
  Highlights: catalog sync is idempotent **and repairs manual drift**; roles are tenant-scoped
  (another workspace resolves to `null`); `replacePermissions` truly replaces (not merges) and
  handles the empty set; **granting a key that is not in the catalog is REJECTED by the FK**;
  archiving a role instantly removes it from `listEffectiveGrants`, `spaceIdsForUser` and
  `countUsersWithPermission`; a duplicate `assign` returns the same row id instead of creating a
  second grant; revoking a workspace grant leaves the space grant intact; and `bootstrapRbac`
  against a real DB seeds 56/4, matches the pinned grant counts, gives every user the assignment
  matching their legacy `users.role`, is idempotent, derives membership from assignees **and**
  space heads, and honours `deriveSpaceMembership: false`.
- **Boot sync proven live:** the QA catalog was wiped to 0 rows, the real server was started, it
  logged `Permission catalog synced {permissions: 56}` and listened normally; afterwards QA had
  56 permissions / 148 grants / **0 orphaned grants**, and dev was untouched.
- server `tsc` clean ✅ · eslint on all five new/changed source files 0 errors ✅.
- Regression after the boot-path change: `health` **14** ✅ · `users` **279** ✅ (plus P2's
  `workspace` 84 · `deptreview` 122 · `spaces` 244).

**Verdict: Phase 4 COMPLETE — the data layer is finished and exercised. Stage A (foundation) is
done: catalog → schema → seeded roles → repositories. Ready for "RBAC phase 5 koren", though P5
is now light (the harness landed here); the substance resumes at P6 with `PolicyService`
(actor resolution + the version-keyed cache).**

---

## Phase 5 — Test kit (factories) — ✅ COMPLETE (2026-07-25)

The jest config, private DB (`tms_rbac_test`) and per-test reset landed early in P4 because the
repository tests needed them. This phase adds the part that was actually still missing: the
**factories every later phase will lean on**, plus a smoke suite that proves the kit itself.

### Shipped — `server/tests/rbac/helpers.ts`
| Helper | What it gives you |
|---|---|
| `rbacWorkspace()` | a workspace with the catalog synced and the four system roles seeded — the state a real deployment is in after P3 (space membership deliberately NOT derived, so tests control it) |
| `bareRbacWorkspace()` | catalog only, no roles — for tests that want full control |
| `makeRole(ws, {key, grants})` | a custom role and its grants in one call; grants accept `"task.edit"` or `["task.edit", "space"]` |
| `setGrants(roleId, grants)` | replace a role's whole grant set (exactly what the P26 permission grid will do) |
| `assignRole({...spaceId?})` | assign workspace-wide, or space-scoped (which IS membership) |
| **`userWithPermissions(ws, grants, {spaceId?})`** | a user holding EXACTLY those permissions via a purpose-built role, **plus a logged-in client** |
| `userWithSystemRole(ws, "admin")` | a user on one of the four seeded roles — the "as shipped" case |
| `makeRbacSpace`, `effectiveGrants`, **`grantSignatures`** | space creation and readable assertions like `task.edit:space@space(sp-…)` |

### Two decisions baked into the kit (they prevent whole classes of false results)
1. **`userWithPermissions` sets the LEGACY `users.role` to `member` by default.** Until P11 swaps
   the route gates, `canAccess` still reads `users.role` — so if a test user were a legacy admin
   you could never tell whether the *permission* or the *old gate* let them through. A test can
   still opt in via `legacyRole`.
2. **One logged-in client per user, handed back by the factory.** Minting a second JWT for the
   same user inside the same second produces a byte-identical token and collides on
   `uq_sessions_token_hash` — the documented gotcha from the dept-review build.

### Verified — `tests/rbac/harness.smoke.test.ts` (13 tests)
Private DB is pinned and carries all four RBAC tables + `permissions_version` · every test really
does start from an empty database (the reset wipes the catalog too, which is what makes the
`role_permissions → permissions` RESTRICT FK meaningful in tests) · `rbacWorkspace` seeds 56
permissions + the 4 roles in rank order · `userWithPermissions` produces exactly the requested
signatures · the legacy role really is `member` · a space-scoped assignment shows up as
membership of that space · `userWithSystemRole` reproduces the pinned grant counts · the returned
client authenticates (`GET /auth/me` → 200) · `setGrants` replaces rather than merges · a user
holding several roles unions their grants · role keys are unique per workspace but may repeat
across workspaces.

- `jest.rbac` **5 suites / 78 tests** ✅ (was 65) · server `tsc` clean ✅ · eslint on all RBAC
  source files 0 errors ✅ (`tests/` is ignored by the project's eslint config).

**Verdict: Phase 5 COMPLETE — Stage A (foundation) is fully finished and tooled. Ready for
"RBAC phase 6 koren": `PolicyService.resolveActor` — folding these grant rows into an effective
permission set, with the `(userId, permissions_version)` cache that makes revocation instant.**

---

## Phase 6 — PolicyService: actor resolution + version-keyed cache — ✅ COMPLETE (2026-07-25)

The first piece of the engine. Still **no enforcement** — nothing calls this yet — but the
answer to "what may this person do?" now exists and is provably correct.

### Shipped
- **`server/src/services/PolicyService.ts`**
  - **`foldGrants(rows)`** — pure, exported, unit-tested without a DB. Folds raw
    `(permission, grant-scope, assignment-scope)` rows into a `PermissionEntry` per key:
    `{ all, spaceIds, own, ownSpaceIds }`.
  - **`resolveActor(userId, workspaceId)`** — returns `ActorPermissions`
    `{ userId, workspaceId, isOwner, legacyRole, version, perms }`. `null` **only** when the user
    is not in that workspace; a user with no roles resolves to an empty actor, because
    "authenticated but powerless" is a valid state, not an error.
  - **`entryFor(actor, key)`** — never undefined, and short-circuits to full access for the owner.
  - `invalidate()` / `clearCache()` / `cacheSize`.
- **`UserRolesRepo.getActorContext`** — one indexed `users ⋈ workspaces` lookup returning the
  legacy role, the status and `permissions_version`. This is the single query a cache HIT costs.

### The narrowing table, now executable
| assignment | grant | effective |
|---|---|---|
| workspace | `all` | everywhere |
| workspace | `space` | **nothing** — an explicit space assignment is what "space" means |
| workspace | `own` | own items, anywhere |
| space(S) | `all` | **downgraded to {S}** ← the escalation guard |
| space(S) | `space` | {S} |
| space(S) | `own` | own items **inside {S}** |

Contributions from several roles **union** (allow wins, no deny — D-4); `all` absorbs everything
narrower, and workspace-wide `own` absorbs space-limited `own`. Entries that end up granting
nothing are dropped, so the map only ever holds real power.

### Two correctness decisions
1. **The owner floor is anchored on the legacy `users.role`, not on holding the seeded role.**
   Proven by a test that deletes the owner's assignment entirely: they still resolve with
   `isOwner: true` and `entryFor(...).all === true` for every permission. Anchoring on the
   assignment would have made D-7's anti-lockout guarantee deletable.
2. **A cache hit costs exactly one query.** The stamp must be read per request or revocation
   would not be instant — so `getActorContext` fetches the version and the legacy role together,
   and only a *miss* pays for the grant join. Cache key is `(workspaceId, userId)` with the
   version stored alongside; bounded at 5000 entries with FIFO eviction (never reached at this
   scale, it only guards against a leak).

### Verified — `tests/rbac/policy-resolve.test.ts` (26 tests)
- **Pure folding:** every row of the narrowing table, plus the defensive case of a `space`
  assignment with a null space id (grants nothing).
- **Unioning:** space grants from different assignments accumulate · `all` absorbs narrower
  forms · workspace-wide `own` absorbs space-limited `own` · permissions stay independent.
- **Against the DB:** a seeded admin resolves to exactly `SYSTEM_ROLE_GRANTS.admin.length`
  entries and does **not** get `space.delete` · the owner gets all 56 · **the owner survives
  having every grant row deleted** · a role-less user is empty, not an error · a foreign
  workspace resolves to `null` · a role granting `all` assigned inside Marketing reaches
  Marketing and **not** Support · several roles union correctly.
- **Cache + revocation:** a second resolve returns the *same object* (identity check = real cache
  hit) · a grant change without a bump is correctly not seen · after
  `bumpPermissionsVersion` the change appears on the very next call and `version` increments ·
  **revoking a permission takes effect immediately** · archiving a role revokes it ·
  one workspace's bump does not disturb another's cached actors · `invalidate`/`clearCache`
  behave · two users never share an entry.

- `jest.rbac` **6 suites / 104 tests** ✅ (was 78) · server `tsc` clean ✅ · eslint 0 ✅.

**Verdict: Phase 6 COMPLETE — the resolver is done and the ~15-minute stale-role window is
closed by design. Ready for "RBAC phase 7 koren": `can()` / `assertCan()` on top of these
entries, plus the 403 error taxonomy.**

---

## Phase 7 — `can()` / `assertCan()` + the 403 taxonomy — ✅ COMPLETE (2026-07-25)

The decision itself. P6 answered *"what does this person hold?"*; P7 answers **"may they do
this, to THIS thing — and if not, why not?"** Still **no enforcement** (nothing calls it yet),
but every later phase now has one function to call and one error shape to return.

### Shipped
- **`server/src/rbac/types.ts`** (new) — `PermissionEntry`, `ActorPermissions`, `NO_PERMISSION`
  moved out of `PolicyService` so the decision has **no service dependency**: the P11
  middleware, the P8 repository predicates and the tests can all reason about an actor without
  constructing a `PolicyService`. `PolicyService` re-exports all three, so the P6 import path is
  unchanged.
- **`server/src/rbac/can.ts`** (new) — pure, no DB, no request:
  - `entryFor(actor, key)` — never undefined; **the single home of the owner floor** (D-7), so
    it cannot be forgotten at a call site.
  - `isOwnResource(actor, ctx)` — created-by **or** assignee, with an `isOwn` override for the
    cases those two fields cannot express (a comment's author, a checklist's parent task).
  - `decide(actor, key, ctx)` → `{allowed:true}` | `{allowed:false, reason}`.
  - `can()` (boolean), `holds()` (verb-level), `assertCan()` / `assertHolds()` (throw the 403).
  - `permissionErrorCode()`, `denyMessage()`, `forbiddenFor()`.
- **`PolicyService`** gained `can` / `decide` / `holds` / `assertCan` / `assertHolds` as **thin
  delegations** — one implementation, two entry points, proven identical by a test.
- **`AppError.forbidden`** now accepts optional `details` (strictly additive; every existing
  call is unchanged).

### The two questions — and why both layers are mandatory
| | asks | knows | used by |
|---|---|---|---|
| `holds(actor, 'task.edit')` | "could they edit **any** task?" | nothing about the object | route middleware (P11), `/me/permissions` (P10), client button gating |
| `can(actor, 'task.edit', ctx)` | "may they edit **this** task?" | space, creator, assignees | services (P12–P15) |

`holds` true does **not** imply `can` true — a Marketing-scoped editor passes the middleware and
is then refused on a Support task. There is a test asserting exactly that, because collapsing
the two into one check is the mistake that makes an RBAC either leaky (skip `can`) or unusable
(demand a space id in a middleware that has not loaded the row yet).

### THE MATRIX — the pass/fail contract (60 pinned cells)
Ten grant shapes × six resource relationships, each cell stating *allow* or the exact reason:

| grant the actor holds | no ctx | in S, other's | in T, other's | in S, mine | in T, mine | no space, mine |
|---|---|---|---|---|---|---|
| nothing | no_grant | no_grant | no_grant | no_grant | no_grant | no_grant |
| workspace + `all` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| workspace + `space` | no_grant | no_grant | no_grant | no_grant | no_grant | no_grant |
| workspace + `own` | not_own | not_own | not_own | ✅ | ✅ | ✅ |
| space(S) + `all` | out_of_scope | ✅ | out_of_scope | ✅ | out_of_scope | out_of_scope |
| space(S) + `space` | out_of_scope | ✅ | out_of_scope | ✅ | out_of_scope | out_of_scope |
| space(S) + `own` | not_own | not_own | not_own | ✅ | out_of_scope | out_of_scope |
| ws `own` + space(S) `all` | out_of_scope | ✅ | out_of_scope | ✅ | ✅ | ✅ |
| space(S) `all` + space(T) `space` | out_of_scope | ✅ | ✅ | ✅ | ✅ | out_of_scope |
| **the OWNER, zero grant rows** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Fail-closed by construction:** every field of `ctx` is optional and every *missing* field can
only make the answer more restrictive. A service that forgets to pass `spaceId` produces a
spurious 403 — visible, reported as `out_of_scope`, never a silent grant.

### The error taxonomy
- **Code = the permission's own namespace + `.forbidden`** (`task.edit` → `task.forbidden`,
  `report.note` → `report.forbidden`), with `role.*` → **`rbac.forbidden`**. Derived, so a new
  permission never needs a new table row — and it deliberately lands on `review.forbidden` /
  `report.forbidden`, the codes the dept-review services **already return**, which makes the
  P15 gate swap invisible to the client.
- **Message built from the catalog label** — the capability is named in the same words as the
  checkbox an admin must tick: *"You don't have permission to edit tasks."* /
  *"You can only edit tasks inside the spaces you are assigned to."* /
  *"You can only edit tasks for items you created or are assigned to."*
- **`details`** = `[{permission}, {reason}]`. Both are facts about the **actor's own**
  configuration — never a space id, an owner name or anything about the resource — so this
  cannot be used as an existence oracle (D-9: reads 404 before reaching here). Asserted by a
  test that scans the whole error for resource ids.

### Two decisions worth recording
1. **`can()` never reads `legacyRole`.** The legacy role reaches a decision only through the
   roles seeded from it (P3). That is what will make the P11–P15 swap *provable*: if a gate
   still passes for the old reason, no permission was involved and the test says so. The one
   hard-wired path is the owner floor, and it lives in exactly one function.
2. **A mistyped permission key is now a COMPILE error.** `PERMISSIONS` was annotated
   `readonly PermissionDef[]`, which silently widened `PermissionKey` to `string` — so
   `can(actor, "task.editt")` would have compiled and denied forever. The catalog now declares
   the literals with `satisfies` and exports a typed `PERMISSION_KEYS`; `PERMISSIONS` stays
   widened for runtime consumers. A `@ts-expect-error` test guards the property: if the union
   ever collapses back to `string`, that test fails to compile.

### Verified — `tests/rbac/can.test.ts` (96 tests)
- **The matrix**: all 60 cells, each asserting both `decide()`'s reason and `can()`'s boolean,
  plus a guard that no case silently drops a relationship.
- **Ownership**: creator · assignee · null/undefined assignee entries ignored · `isOwn`
  override wins in both directions · null actor / absent ctx is never own.
- **`entryFor` / `holds`**: the owner holds all 56 · a missing key is the empty entry, not
  `undefined` · a null actor is empty · `holds` true for every reach shape and false for
  "granted `space` workspace-wide" and for a different permission · **`holds` true ≠ `can` true**.
- **Taxonomy**: per-domain codes · `role.*` → `rbac.forbidden` · the dept-review code reuse ·
  every one of the 56 keys yields a dotted code and a label-based sentence · exact wording of
  all three reasons · the `AppError` shape (403 + code + details) · **no resource ids anywhere
  in the error**.
- **Guards**: `assertCan` silent when allowed, and throwing the right code+reason for each of
  the three denials · null actor → `no_grant` · `assertHolds` passes a space-limited holder
  through and then `assertCan` refuses the object · `@ts-expect-error` typo guard.
- **End-to-end against the DB** (6): a space-scoped role reaches its space and not another ·
  an `own`-scoped role follows the person (creator *and* assignee) across spaces · **the four
  seeded system roles still reproduce today's behaviour through `can()`** (everyone edits and
  deletes any task; guest still cannot upload; member still cannot invite; admin still cannot
  delete a space; owner can) · a revoked permission stops passing `can()` on the next call ·
  two space-scoped roles union into both spaces · the `PolicyService` methods return the
  identical decision to the pure functions.

- `jest.rbac` **7 suites / 200 tests** ✅ (was 104) · `jest.deptreview` **14 suites / 122 tests**
  ✅ (regression check on the shared `AppError` change and the 403 paths) · server `tsc` clean ✅
  · eslint clean on every RBAC-touched file ✅.

> **Noted while linting, not caused by this phase:** a repo-wide `eslint src` reports **54
> pre-existing errors** (mostly `no-unnecessary-type-assertion` in five controllers, plus
> `logger.ts`, `FormsService`, `MailService`, `errorHandler`, `sprints.ts`). Every one of those
> files is byte-identical to `HEAD` — `git diff HEAD` on them is empty — so they predate the
> RBAC work. Earlier phases' "eslint 0" refers to the files that phase touched, which is also
> true here. Worth a cleanup pass of its own; folded into the P33 "eslint zero-new" gate rather
> than fixed mid-phase.

**Verdict: Phase 7 COMPLETE — the engine can now answer and refuse, in one voice. Ready for
"RBAC phase 8 koren": `VisibilityScope` + `scopePredicate` (which rows a query may return —
`undefined` for unrestricted so the SQL is byte-identical to today, `1=0` for an empty set,
never `inArray(col, [])`).**

---

## Phase 8 — `VisibilityScope` + `scopePredicate` — ✅ COMPLETE (2026-07-25)

`can()` (P7) answers about one already-identified resource. P8 answers the other half:
**which rows a listing query may return** — as a `WHERE` fragment, so the filter runs in SQL.
Still **no enforcement**: no repository calls it yet. P16–P22 will.

### Why it must be SQL, never a `.filter()`
Every paginated read here returns `{data, pagination}` where `total_estimate` comes from a
**separate `COUNT(*)`** and the cursor is a keyset on `internal_id`. Post-filtering in JS would
leave the count and the cursor describing a different set than the page: short pages, wrong
totals, rows skipped at page boundaries. So the predicate goes into the query — and the count
query gets the **same** predicate (landmine L2, with a test asserting page length == count).

### The three rules (landmine L3)
| situation | predicate | why |
|---|---|---|
| unrestricted | **`undefined`** | Drizzle drops an undefined condition → the emitted SQL is **byte-identical to today's**. This is what makes visibility a no-op until an admin tightens a role. |
| nothing visible | **`` sql`1 = 0` ``** | `inArray(col, [])` emits `col in ()` — a MySQL **syntax error** — and the usual "skip the filter when the list is empty" workaround silently shows **everything**. Both are worse than an empty result. |
| some spaces | `inArray(col, ids)` | ids are de-duplicated and **sorted**, so the SQL is deterministic. |

### Shipped
- **`server/src/rbac/scope.ts`** (new, pure except one lookup):
  - `VisibilityScope` = `{kind:'all'}` | `{kind:'scoped', spaceIds, listIds}` + `ALL_VISIBLE` /
    `NOTHING_VISIBLE` / `makeScope`.
  - `visibleSpaceIds(actor)` — the space half, derived from **`space.view` and nothing else**.
    An `own` grant on it (which the catalog does not offer) is **ignored**, never widened.
  - `materialiseScope(actor, source)` — resolves the whole scope for one request.
  - `scopePredicate(scope, {spaceCol|listCol}, {alsoAllow})` — the three rules above.
  - `isSpaceVisible` / `isListVisible` / `seesEverything` / `describeScope`.
- **`ListsRepo.idsBySpaces(spaceIds, workspaceId)`** — the one query. Joins `spaces` (a PK
  lookup) because **`lists` has no `workspace_id` of its own**, so without the join a stray
  foreign space id would widen what a caller sees. Archived lists are **included**: visibility
  and archiving are separate filters. Backed by `idx_lists_space_archived (space_id, …)`.
- **`PolicyService.visibilityFor(actor)`** + a required `ListScopeSource` constructor arg
  (`ListsRepo` satisfies it structurally).
- **Test kit**: `policyService()` and `makeRbacList()` in `tests/rbac/helpers.ts`; the P6/P7
  suites now build their service through the shared helper.

### Why `listIds` at all
`lists` has no `workspace_id` and `tasks` has no `space_id` — a task is filtered by
`primary_list_id`, which is the **leading column of `idx_tasks_list_active`**. So filtering
tasks by list ids uses the hot index and is *faster* than today's unindexed workspace-wide scan.
Visibility makes these queries quicker, not slower.

### Two decisions
1. **The scope is deliberately NOT cached.** `listIds` changes whenever a list is created,
   deleted or moved, and none of those bump `permissions_version` — a cached set would hide a
   brand-new list from exactly the people who work in that space. It is resolved per request
   (P11 will attach it to the request) and **costs zero on today's path**: an actor with
   `space.view = all` returns `ALL_VISIBLE` without touching the database, and an actor with no
   spaces returns early too. Only a genuinely space-restricted actor pays for the single lookup.
   There is a test that creates a list *after* the first resolve and asserts it appears without
   any version bump.
2. **`alsoAllow` is part of the primitive, not left to the caller.** It is the `own` escape
   hatch (`[eq(tasks.createdBy, me)]` — a bug you filed into another department stays visible to
   you). Hand-writing `and(scopePredicate(...), or(mine))` is the mistake it prevents: that
   *narrows* the space scope instead of widening it, and still leaves `1 = 0` blocking an actor
   whose only reach is `own`. With the option, an own-only actor correctly gets
   `where created_by = ?` and no `1 = 0`.

`lists.is_private` is **not** applied here — it is enforced nowhere today and switching it on is
P16's job, deliberately, so that P8 changes no behaviour.

### Verified — `tests/rbac/scope.test.ts` (33 tests)
- **Rule 1**: `undefined` for both column kinds · the same query built with and without the
  predicate produces **identical SQL and identical params** · still `undefined` when
  `alsoAllow` is supplied (`all` already covers it).
- **Rule 2**: `1 = 0` rendered (never `in ()`) for no-spaces and for spaces-but-no-lists ·
  matches **zero rows against a real table**.
- **Rule 3**: `in (?, ?)` with de-duplicated, sorted params · the right array per column kind ·
  `alsoAllow` produces ` or ` and never ` and ` · an own-only actor still gets their rows ·
  `undefined` entries in `alsoAllow` ignored · a real query filtered down to one list.
- **`visibleSpaceIds`**: `all` · owner · union of space assignments (sorted) · no `space.view`
  grant → no spaces · null actor · **`own` on `space.view` ignored**.
- **`materialiseScope`** (spy source counting queries): unrestricted → **0 queries** · no
  spaces → **0 queries** · null/undefined actor → nothing · space-scoped → **exactly one**
  lookup with the sorted space ids and the actor's workspace.
- **`ListsRepo.idsBySpaces`**: all lists incl. archived · excludes other spaces · **returns
  nothing for a space in another workspace (tenant safety)** · empty input short-circuits.
- **End-to-end**: a Marketing-scoped user resolves to `{spaceIds:[marketing], listIds:[mkt]}`,
  and the predicate filters both a real `tasks` query and a real `spaces` query down to
  Marketing · **owner and admin still resolve to `ALL_VISIBLE` with no added SQL** · a new list
  appears immediately · a user with a role but no `space.view` sees nothing.
- **L2**: page rows and `count(*)` agree under the same predicate.

- `jest.rbac` **8 suites / 233 tests** ✅ (was 200) · `jest.lists` **171** ✅ · `jest.spaces`
  **244** ✅ · server `tsc` clean ✅ · eslint clean on every P8-touched file ✅.
  *(The first `jest.lists` run showed 1 failure in `create.test.ts` while a type-aware eslint
  run was competing for the machine; the solo re-run was 171/171 — the documented load-flake
  pattern, not a code defect.)*

**Verdict: Phase 8 COMPLETE — STAGE B is now three-quarters built and the engine can answer
"who are you", "may you", and "what may you see". Ready for "RBAC phase 9 koren": system and
special principals — the job/system actor, the public-form principal, the **elevated scope for
dept-review stats (landmine L1)** and the assistant tool context, with tests proving the weekly
report numbers are unaffected.**

---

## Phase 9 — System & special principals — ✅ COMPLETE (2026-07-25)

Enforcement needs two things at every call site: **who is acting** and **what their queries may
see**. A signed-in request gets both from `PolicyService`. Three callers cannot — and one of
them, if handled carelessly, would silently corrupt every department report.

### The three sessionless callers
| # | Caller | Today | Landmine |
|---|---|---|---|
| 1 | **Background jobs** — weekly report, snooze waker, janitors | no `req.auth` at all; `internalAuth` checks a shared token and nothing else; they pass `actorId: null` | **L5** |
| 2 | **Public form submit** — an anonymous stranger | synthesises `role: MEMBER` and attributes the task to the form's creator | **L4** |
| 3 | **Boundary-authorized aggregates** — `/dept` queues, the weekly payload | already gated ("head of this space, or an admin"), then counts EVERY task in the department | **L1** |

### Shipped
- **`ActorPermissions.kind`** — `"user" | "system" | "public"`. `entryFor` now has exactly two
  hard-wired full-access branches, side by side in one function: the owner floor (D-7) and
  `kind === "system"` (L5).
- **`server/src/rbac/principals.ts`** (new):
  - `systemActor` / `systemPrincipal(workspaceId)` — every permission, whole workspace.
  - `publicFormActor` / `publicFormPrincipal({workspaceId, spaceId, listId, attributedTo})` —
    **exactly two permissions**, `task.create` + `customfield.set_value`, in one space; scope
    is the form's single list.
  - `elevate(reason)` → unrestricted · `elevateToSpaces(reason, {spaceIds, workspaceId,
    source})` → full reach **inside those spaces only**.
  - `ElevationReason` — a **closed union** of the four legitimate bypasses.
  - `isSystem` / `isPublic` / `SYSTEM_USER_ID`.
- **`PolicyService.principalFor(userId, workspaceId)`** — actor + scope in one object; this is
  what P11 attaches to the request and what P22 hands the assistant's tools, so a tool can never
  widen beyond the person who asked.
- **`PolicyService.elevateToSpaces(reason, spaceIds, workspaceId)`**.

### Three decisions
1. **A job is `kind: "system"`, never `isOwner: true`.** Marking it as the owner would have been
   one line shorter and would have put a false actor in audit rows and in every future
   "only the owner may…" rule. A test asserts `systemActor(...).isOwner === false` *and* that it
   can still do everything.
2. **The public-form actor keeps the form CREATOR as its `userId`.** That is who today's submit
   path stamps on `created_by`, and changing it would rewrite the attribution of every existing
   form. `kind: "public"` is what records that the creator is not the one actually acting. Its
   grant set is a hard whitelist of two keys — a sweep over all 56 asserts nothing else is held,
   so if a future submit path needs another permission the test fails rather than the request.
3. **Every bypass is NAMED, from a closed union.** Each elevation is a hole in the wall.
   `ElevationReason` cannot be extended from anywhere else in the codebase, so adding a fifth
   hole means editing this file — the review checkpoint — and `grep elevate` lists them all. A
   test pins the set to exactly `job`, `dept_review_stats`, `weekly_report`, `public_form`.
   `elevateToSpaces` is preferred over `elevate` wherever the spaces are known: it is the
   difference between "this head sees all of Marketing" and "this head sees the whole company",
   and elevating to **no** spaces yields `1 = 0`, never everything.

### The L1 demonstration — the reason this phase exists
`tests/rbac/principals.test.ts` builds Marketing (2 lists, 3 tasks) and Support (1 list, 1
task), then:
1. reads the **ground truth from the real feature** — `ReviewsRepo.summaryTotals(marketing)`
   reports `open: 3`;
2. creates an admin who may read Marketing's report but whose own `space.view` was tightened to
   Support;
3. shows that filtering the department query by that reader's personal scope returns **0** —
   the silent-wrong-number failure, with nothing raising an error;
4. shows the elevated scope returns **3**, equal to the feature's own number.

Numbers 1 and 4 are now pinned, so if P16–P19 wire the caller's scope into these queries the
test fails loudly instead of a head reading a quietly truncated report.

### Verified — `tests/rbac/principals.test.ts` (20 tests)
- **System**: is a system actor and not a fake owner · holds all 56 permissions with any
  context · guards never throw · scope is `ALL_VISIBLE` and adds no SQL · a resolved human is
  `kind: "user"` and is not a system actor.
- **Public form**: attribution preserved · holds exactly `["customfield.set_value",
  "task.create"]` · can create in the form's space and **not** in another, and not with no
  space at all · cannot view/edit/delete/administer (10 keys probed) · a real query under its
  scope returns only the form's list.
- **Elevation**: the closed reason set · `elevate()` unrestricted · `elevateToSpaces()` stops at
  the department edge · **no spaces → `1 = 0`, never everything** · the `PolicyService` method
  delegates identically.
- **`principalFor`**: actor + scope together · `null` outside the workspace.
- **L1**: the demonstration above · the weekly job counts every department and may write its
  report rows · elevation granted for Marketing returns 0 rows for Support.

- `jest.rbac` **9 suites / 253 tests** ✅ (was 233) · `jest.deptreview` **14 suites / 122 tests**
  ✅ · server `tsc` clean ✅ · eslint clean on every P9-touched file ✅.

**Verdict: Phase 9 COMPLETE — every caller in the system, human or not, can now be described as
a principal, and the three sessionless ones are explicit rather than accidental. Ready for
"RBAC phase 10 koren": `GET /me/permissions` (the resolved set + visible space ids) and its
inclusion in `/auth/me` — the first phase with a wire contract, which is what the client needs
before any UI can mirror permissions.**

---

## Phases 10, 11, 16-19, 23-26, 28, 31 — ✅ COMPLETE (2026-07-25)

Ten phases in one pass, on the user's instruction to finish the remaining plan in one go. They
are logged together because they form one coherent change: **the engine is now wired into the
product** — a wire contract, a route gate, row-level visibility, an administration API and the
UI that drives it.

Everything below preserves the P3 invariant: **the seeded default reproduces today exactly**, so
nothing changes for anyone until an admin tightens a role.

---

### P10 — `GET /api/v1/me/permissions`

The first RBAC wire contract, and the thing the client's `can()` is built on.

- **`src/types/rbac.ts`** — `WireMyPermissions` / `WirePermissionEntry`.
- **`src/serializers/permissionsSerializer.ts`**, **`controllers/MeController.ts`**,
  **`routes/me.ts`** (mounted at the v1 root; `/me` overlaps nothing).
- Payload: `{ version, is_owner, role, visible_space_ids, permissions }`.
  `visible_space_ids: null` **means every space** — the JSON encoding of the unrestricted scope.

**Two decisions.**
1. **`/auth/me` was NOT changed.** The plan said to include permissions there; the code says
   otherwise — that response is a pinned Appendix-A shape with three tests asserting *exactly ten
   keys* and "no envelope, no workspace context". A separate endpoint is also better on its own
   merits: identity and authority change on different schedules, so a 403 means "refetch
   permissions", not "refetch who I am". Deviation recorded here rather than silently taken.
2. **The owner's permissions are MATERIALISED, not flagged.** All 56 keys come back with
   `all: true` instead of making the client special-case `is_owner`, so the client's `can()` is
   the same three lines for everybody and the one place that could forget the owner floor stays
   on the server.

Verified — `tests/rbac/me-permissions.test.ts` (13): the five-key shape · snake_case entries ·
grant-nothing keys omitted · a role-less user gets `{}` not a 500 · member = exactly today's
member powers · **owner = all 56** · guest still cannot upload · `null` vs `[]` vs a space list ·
**a revocation is visible on the very next call** · the version increments · 401 unauthenticated.

---

### P11 — `requirePermission` + the 42-gate swap

- **`middlewares/requirePermission.ts`** — the verb gate. `canAccess([...roles])` asked "is your
  JWT's role in this list?"; this asks "do you hold this permission?", resolved from the database.
- **`rbacContext`** — mounted ONCE on the v1 router, ahead of every route, so no endpoint can run
  without an authorization context.
- **`src/rbac/context.ts`** — `AsyncLocalStorage` carrying `{actor, scope}`, plus the two
  one-liners repositories call: `spaceScopeFilter(col)` / `listScopeFilter(col, alsoAllow)`.

**All 42 call sites swapped 1:1** across 14 route files:

| gate | permission | gate | permission |
|---|---|---|---|
| `POST/PATCH/DELETE /custom-fields` | `catalog.custom_fields` | forms `admin` (×7) | `form.manage` |
| `POST /lists` | `list.create` | `PATCH /lists/:id` | `list.edit` |
| `POST /lists/:id/(un)archive` | `list.archive` | `DELETE /lists/:id` | `list.delete` |
| `PUT/DELETE /on-call/:week` | `oncall.manage` | `POST /reports/:id/ack` | `report.ack` |
| `PATCH /tasks/:id/sla` | `task.sla_override` | `POST /spaces` | `space.create` |
| `PATCH /spaces/:id` | `space.edit` | `POST /spaces/:id/(un)archive` | `space.archive` |
| `DELETE /spaces/:id` | `space.delete` | sprints lifecycle (×4) | `sprint.manage` |
| statuses (×4) | `status.manage` | tags (×3) | `catalog.tags` |
| task-types (×3) | `catalog.task_types` | templates (×3) | `catalog.templates` |
| `POST /users/invite` | `member.invite` | `PATCH /users/:id/role` | `member.role_change` |
| `POST /users/:id/(de|re)activate` | `member.deactivate` | `POST /users/:id/reset-password` | `member.reset_password` |
| `PATCH /workspace` | `workspace.settings` | | |

Every one of those keys is in the seeded owner/admin grant set (and only `space.delete` /
`list.delete` in owner's), so the swap is **behaviour-identical**.

**Four decisions, each forced by something the code actually does.**

1. **The 403 keeps the code `auth.forbidden` and the exact old sentence.** The P7 taxonomy
   (`task.forbidden`, …) is richer, but ~40 live endpoints have that contract today. A 1:1 swap
   must be invisible, so `routeForbidden()` reproduces it byte-for-byte and puts the permission
   key + reason in `details` (purely additive). The per-domain codes stay where they are new
   surface: the service-level `assertCan`.
2. **A stale JWT naming a DELETED workspace still gets the handler's 404, not a 403.** Turning it
   into a 403 would be a gratuitous contract change, and it is safe because every downstream
   query is workspace-scoped and matches nothing. A JWT naming a workspace that *does* exist for
   a user who is not in it IS refused here — that request could otherwise reach workspace-level
   rows.
3. **`AsyncLocalStorage` instead of threading a `scope` parameter.** Visibility has to reach ~20
   repository methods three or four layers below the request. Threading would mean touching every
   caller — including ~2,800 tests that construct repos directly — and one missed call site would
   be a silent leak. The store is established in the global v1 chain, so an API route cannot
   forget it; outside a request (jobs, seeds, unit tests) it defaults to unrestricted, which is
   exactly right for all three of those callers.
4. **The test factories now bootstrap RBAC.** `makeWorkspace` seeds the catalog + four system
   roles; `makeUser` assigns the matching one. A workspace with no roles cannot exist in
   production, so a test built on one shows 403s no real user would ever see. This is what made
   the whole existing suite go green again after the swap.

**Landmine L13 closed:** `users.role` is only a mirror, so every path that writes it now also
moves the assignment — `syncUserSystemRole()` in `rbac/bootstrap.ts`, called from
`UserService.changeRole` (in the same transaction, with the version bump so the new role bites on
the next request) and from `UserService.invite` (**without** the bump: the version UPDATE takes an
exclusive lock on the workspace row and two concurrent invites deadlocked on it — an invited user
has no session, so there is nothing cached to invalidate).

**Two test-infrastructure defects found and fixed** (both pre-existing, exposed by the change):
`setup-each-workspace.ts` never truncated `workspace_activity`, so a read-only assertion depended
on suite ORDER; and eleven per-module reset lists did not include the RBAC tables, letting one
test inherit another's authority. Both fixed.

---

### P16-P19 — visibility in the repositories

Each is one line at the top of the method plus one entry in the `and(...)`, and each returns
`undefined` for an unrestricted caller — so **today's SQL is unchanged**.

| Repo | Methods | Note |
|---|---|---|
| `SpacesRepo` | `listByWorkspace`, `findByIdInWorkspace` | gates the tree, and transitively most of the app |
| `ListsRepo` | `findBySpace`, `listByWorkspace`, `findByIdInWorkspace`, `findRecordByIdInWorkspace` | a list inherits its space |
| `TasksRepo` | `findByIdInWorkspace`, `findByIdOrCustomIdInWorkspace`, `listChildren`, `findManyByIdsInWorkspace`, `findBySprintInWorkspace`, `listByList`, `countByList` | **the hole the scan led with** |
| `SearchRepo` | `searchTasks`, `searchLists`, `searchSpaces`, `searchComments` | the biggest raw leak |
| `HomeRepo` | `openTeamSeries`, `slaBreachesSeries` | the two series that counted the whole company |

- **`listByList` and `countByList` share one predicate**, so `total_estimate` cannot disagree with
  the page (landmine L2).
- **`src/rbac/ownEscape.ts`** — the `own` escape hatch. A person scoped to Marketing still sees the
  bug they filed into Engineering and the task Engineering assigned them; without it "your spaces"
  would quietly mean "only your spaces" and cross-department work would vanish from the reporter's
  own screen. It is OR-ed, never AND-ed, and it returns nothing unless the actor actually holds
  `task.view` at `own` scope — **the escape hatch is itself a permission, not a freebie**.
- `myWorkRows` is deliberately NOT filtered: it is already `assignee = me`, which IS the own case.

---

### P23-P24 — the administration API

`src/services/RolesAdminService.ts` + controller + validators + `routes/roles.ts`:
`GET /roles`, `GET /roles/catalog`, `POST /roles`, `PATCH /roles/:id`,
`PUT /roles/:id/permissions`, `GET /roles/:id/holders`, `DELETE /roles/:id`,
`GET|POST /users/:id/roles`, `DELETE /users/:id/roles/:assignmentId`,
`GET /spaces/:id/members`.

**All three dangerous guards live in one file so they can be read together:**

1. **System-role protection** — the four seeded roles cannot be deleted, and the **Owner role
   cannot be edited at all** (it is the anti-lockout floor; an admin must not be able to hollow it
   out). Admin/Member/Guest *can* have their grants tuned — that is exactly how "tighten from the
   default" works.
2. **No lockout (L7)** — computed on the state AFTER the change, not before: if removing
   `role.manage`/`role.assign` from this role would drop the workspace to zero holders, refuse.
3. **No escalation (L8)** — you cannot grant a permission you do not hold, at a scope you do not
   hold, in a place you do not hold it. Giving away a ROLE is treated as giving away its grants.
   The owner is exempt; they already hold everything.

Verified — `tests/rbac/roles-api.test.ts` (20): list + catalog + member refused · create with a
derived unique key (`reviewer`, `reviewer-2`) · unknown key → 422 · unsupported scope → 422 ·
**owner role immutable** · **built-in role undeletable** · **tightening Member allowed** · lockout
refused · **escalation refused, and allowed for what the caller does hold** · owner exempt ·
space-scoped assignment IS space membership · **an assignment immediately changes what that
person sees** · revoke · cross-workspace 404 · `role.assign` required separately from
`role.manage` · **a revoked grant stops working on the very next request**.

---

### P25, P26, P28, P31 — the client

- **`stores/permissions.ts`** — non-persisted on purpose: a permission set in `localStorage`
  survives a revocation, a sign-out on a shared machine, and a role change made while the tab was
  closed. `canWith` mirrors the server's `can()` exactly (same four reaches, same order).
- **`hooks/usePermissions.ts`** — `{ can, holds, isOwner, visibleSpaceIds, ready }`. `ready` is
  false until the first fetch lands, so a page never flashes buttons it then removes.
- **`components/shared/RequirePermission.tsx`** + `<Forbidden/>` — Bangla refusal copy that says
  what happened and who to ask, rather than a redirect that makes a shared link look broken.
- **`pages/settings/RolesSettings.tsx`** — the permission grid: create a role, tick what it may
  do, and choose **how far each tick reaches** (Everywhere / Their spaces / Own items) inline with
  the checkbox — "can edit tasks" without "where" is the question every permission UI forgets to
  ask. Dangerous permissions render red; the Owner role renders locked with the reason; leaving a
  dirty grid asks first.
- **Route guards** on `/settings/{workspace,members,roles,task-types,tags,statuses,custom-fields,
  templates}` and `/eng/on-call`; the settings nav hides what you cannot open.
- **Cache hygiene (L10)** — `refresh()` compares `permissions_version` and calls
  `queryClient.clear()` when authority changed; sign-out clears the store.

**The client is UX, not security.** Every answer it gives is a mirror of what the server already
enforces; hiding a button is a courtesy, and the API refuses the call regardless.

---

### Verified

- `jest.rbac` **11 suites / 286 tests** ✅ (was 253) · `workspace` 84 ✅ · `users` 279 ✅ ·
  `spaces` 244 ✅ · `lists` 171 ✅ · `statuses` 209 ✅ · `taskTypes` 184 ✅ · `tags` 149 ✅ ·
  `templates` 121 ✅ · `customfields` 90 ✅ · `forms` 85 ✅ · `sprints` 150 ✅ · `oncall` 81 ✅ ·
  `deptreview` 122 ✅ · server `tsc` clean ✅ · client `tsc -b` clean ✅ · eslint: no new errors
  (the 54 pre-existing ones are unchanged and in files this work never touched).

### Full regression — verified green after the swap

| module | result | module | result | module | result |
|---|---|---|---|---|---|
| **rbac** | 11 / **286** ✅ | tasks | 10 / **359** ✅ | auth | 9 / **339** ✅ |
| users | 8 / 279 ✅ | spaces | 7 / 244 ✅ | statuses | 5 / 209 ✅ |
| taskTypes | 4 / 184 ✅ | lists | 5 / 171 ✅ | sprints | 9 / 150 ✅ |
| tags | 4 / 149 ✅ | deptreview | 14 / 122 ✅ | templates | 6 / 121 ✅ |
| attachments | 6 / 106 ✅ | membership | 97 ✅ | customfields | 7 / 90 ✅ |
| forms | 8 / 85 ✅ | workspace | 2 / 84 ✅ | notifications | 7 / 84 ✅ |
| oncall | 4 / 81 ✅ | eng | 3 / 78 ✅ | taskdeps | 3 / 67 ✅ |
| assistant | 4 / 52 ✅ | collab | 2 / 47 ✅ | workspaceActivity | 41 ✅ |
| search | 32 ✅ | jobs | 5 / 31 ✅ | sla | 2 / 24 ✅ |
| home | 23 ✅ | health | 14 ✅ | client vitest | 6 / 32 ✅ |

**≈3,400 server tests + 32 client tests green**, server `tsc` clean, client `tsc -b` clean,
eslint unchanged (the 54 pre-existing errors are in files this work never touched).

> **One infra note, not a defect:** two intermediate runs showed a single failure each
> (`tasks/my-work` truncating a table mid-drop, and `workspace/get-workspace` counting another
> suite's activity rows). Both were self-inflicted — a second `jest` invocation was running
> against the SAME private database, which the project's own test notes call out as forbidden.
> Solo re-runs: 359/359 and 84/84.

---

## What is NOT built yet — the honest ledger

The user asked for the remaining phases in one pass. Ten shipped and are green. These did not,
and they are listed with what each would actually change so the decision to continue is informed:

| Phase | Not done | Consequence today |
|---|---|---|
| **P12-P15** | Service-level `assertCan` on writes | Writes are covered by the verb gate AND, transitively, by read visibility — you cannot edit what you cannot fetch. The gap is the **`own` distinction**: someone who can SEE a space and holds `task.edit` at `own` scope is not yet stopped from editing a colleague's task in that space. Nothing regresses; a scope simply is not honoured on writes yet. |
| **P19 rest** | SLA + engineering-home aggregates | Two more count queries still span the workspace. |
| **P20-P22** | forms · statuses · custom fields · task content · notifications · activity · sprints · tags · templates repos, **and assistant tool scoping (L12)** | These read paths are reachable only through a task/list/space id, which IS gated — but their own list queries are not yet filtered. The assistant's `search` tool is the one real leak here. |
| **P27** | Space-members UI | The API exists (`GET /spaces/:id/members`, assign/revoke); there is no panel yet, so membership is managed from `/settings/roles` + the API. |
| **P29-P30** | Action-gating pass over ~25 components | Buttons still render for actions the API will refuse with a 403. Ugly, not unsafe. |
| **P32-P34** | Endpoint × role sweep · IDOR probes · `rbac.pw.ts` E2E | The per-phase tests cover the engine and the admin API; there is no exhaustive matrix yet. |
| **P35** | Department-mode preset · `API_DESIGN.md` §34 · `RBAC_ADMIN_GUIDE.md` (Bangla) · assistant KB update | An admin configures roles by hand for now. |

### Two deliberate non-changes, flagged rather than taken

1. **`spaces.is_private` / `lists.is_private` stay decorative.** Under this model privacy is
   expressed by narrowing `space.view` — a private space is invisible to everyone who is not a
   member the moment that switch is flipped. Adding a *second* rule on top would create two
   competing access mechanisms, which is exactly the teams-vs-spaces mistake the plan rejected in
   Part 1.3. If a stricter "hidden even from admins" rule is wanted, it needs its own decision.
2. **A deactivated user with a live access token still resolves to full permissions.** Making the
   resolver deny on `status` was written, tested and then **reverted**: nine tests across seven
   modules document that behaviour as INTENDED ("status enforced at refresh, not here"), because
   deactivation revokes the refresh session and an access token lives ≤15 minutes. Closing it is
   an AUTH-layer change (`authenticate` should check status) affecting every endpoint, gated or
   not — it does not belong inside an RBAC phase.

---

## Local run + the one bug it caught (2026-07-25)

Started both dev servers against the live demo database and drove the app in a real browser.

### Environment
| | |
|---|---|
| API | `http://localhost:5501` — `NODE_ENV=dev npx tsx watch src/server.ts` |
| App | `http://localhost:5173` — `npm run dev` |
| DB | `taskmanagement` — 56 permissions · 4 roles · 148 grants · 25 assignments · **0 users without a workspace grant** |

Live API checks: owner → 56 permissions, `visible_space_ids: null`, `is_owner: true` · admin → 53,
`role.manage: yes` · member → 20, `role.manage: no` · `GET /roles` → Owner 56/1 holder, Admin 53/2,
Member 20/22, Guest 19/0 · `GET /roles/catalog` → all 12 groups.

### 🐞 THE BUG — permission keys were being mangled in transit

The settings nav rendered 8 of its 10 links for an admin. Missing: **Task types** and **Custom
fields** — and only those two. The API was returning both keys; the database had both grants; the
served bundle was correct.

**Cause:** `http/client.ts` runs a recursive snake_case→camelCase transform on every response
body. `/me/permissions` returns a map **keyed by permission key**, so the transform rewrote
`catalog.task_types` → `catalog.taskTypes`. Every lookup for a key containing an underscore then
missed, and the UI hid controls the person actually held. Confirmed by reading the live store:

```
catalogKeys: ["catalog.taskTypes", "catalog.tags", "catalog.customFields", "catalog.templates"]
```

**Fix:** the codebase already had this exact hazard documented — `/postmortem` is in
`SKIP_CAMELIZE_URLS` because "its `items` map is keyed by human labels … case-transforming those
keys would corrupt them (H5)". `/me/permissions`, `/roles*` and `/spaces/:id/members` join it.
All three are declared snake_case in `client/src/types/rbac.ts`, so skipping the transform is also
what makes those types honest.

**Why no test caught it:** the server tests assert the payload (correct), and the client tests did
not exercise the axios layer. `client/src/stores/permissions.test.ts` now does — including a case
that feeds 14 underscore-bearing permission keys through the real `camelizeKeys` and asserts **not
one of them survives**, so the hazard is documented in code rather than in a comment.

*(Worth stating plainly: this class of bug — identifiers used as object keys, silently rewritten by
a generic transformer — is invisible to unit tests on either side of the wire. It took opening the
app to see it.)*

### After the fix
All 10 settings links render · `/settings/roles` shows the four seeded roles with holder counts
(Owner 1 · Admin 2 · Member 22 · Guest 0) · the Owner role renders locked with its reason and no
Delete button · dangerous permissions render red · the **Everywhere / Their spaces** scope selector
appears inline on space-capable permissions · client `vitest` **7 files / 40 tests** ✅ · client
`tsc -b` clean ✅ · server `tsc` clean ✅.
