# RBAC + Teams — Requirements & Design (V1)

**Status:** DRAFT — awaiting user review & final prompt
**Date:** 2026-07-14
**Target system:** ⚠️ **UPDATED 2026-07-14: `server/` (Express + MySQL) + `client/` (React + Vite) — the legacy stack, which the user has chosen as the go-live stack. The astro-app/Cloudflare/Turso port is decommissioned.** The design below (teams model, permission matrix, phases) is stack-agnostic and unchanged; astro was a 1:1 port of the legacy system, so the scan findings (§2: no teams tables, `is_private` unenforced, coarse `canAccess`, zero frontend role-gating) apply equally to legacy — but the astro file:line refs in §2–§4 must be re-mapped to `server/src/...` + `client/src/...` paths during P0 (quick re-verify scan).
**Scan basis:** full 4-way system scan (2026-07-14): all 35 DB tables, all ~150 API endpoints + their gates, all frontend pages/surfaces, and all original spec documents (master SRS §8 authorization model, ClickUp reference scan §32, BeautyBooth ops docs, dev-team doc, API_DESIGN.md Appendix B).

---

## 0. TL;DR (Banglish — porar shuru ekhane)

Apni 2 ta feature chan:

1. **Full RBAC** — jake jei access deya hobe, se **sudhu** sei access pabe. Ekhon system e 4 ta role ache (owner/admin/member/guest) kintu enforcement khub coarse: config-write gulo admin-gated, ar **baki sob kichu — task edit/delete, onno team er data dekha, Settings er sob page — jekono member er jonno khola**. `is_private` flag database e ache kintu **kothao enforce hoy na** (scan e proof ache — Section 2).

2. **Team-wise structure** — company'r employee ra team e vag (Supply Chain, CS, Developer, Marketing, Accounting...), prottek team er task alada, prottek team e **Team Leader** — leader tar team er sobar task manage + "ke thik moto update dicche na" track korbe, ar **Main Admin** sob team er overview + leader der theke **structured weekly report/feedback** pabe.

**Proposed design (1 line each):**
- **Team** = notun first-class entity (`teams` table) — name, leader(s), members. Employee 1+ team e thakte pare.
- **Space** gulo team er shathe link hobe (`spaces.team_id`) — ekta team er space sudhu sei team er lok ra dekhbe. Link chara space = company-wide (sobai dekhe). **Ei jonno deploy korar din kichu bhangbe na — jotokhon team configure na koren, sob age'r moto cholbe.**
- **Team Leader** = team-level role (workspace role na) — tar team er sob task edit/assign/manage korte pare + Team Dashboard pay (member-wise workload, overdue, "X din update nai" list, nudge button).
- **Admin/Owner** = sob dekhe + Teams Overview dashboard + leader der **weekly Team Report** inbox (leader submit kore → admin review + feedback dey).
- **Permission matrix** (Section 3.2) = kon role ki parbe tar full table — backend e enforce, frontend e mirror.
- **AI help-bot o team-scoped hobe** (nahole bot diye onno team er data leak hoto).

**Apnar kach theke 9 ta decision lagbe** — Section 5 e (D-1 theke D-9), prottekta te amar recommendation deya ache. Sob gulo te "recommended" bolle amra recommended path e jabo.

**Kivabe respond korben:** file ta pore bolen — *"requirements approved, sob D recommended-e, kaj shuru koren"* — othoba je D change korte chan seta bolen (e.g. "D-2 te Option B"). Phase plan Section 7 e — P0 theke P5, ek phase kore banabo + test korbo.

---

## 1. What you asked for → requirement map

Your words (2026-07-14), mapped to requirement IDs used throughout this doc:

| Your requirement (Banglish) | Requirement IDs |
|---|---|
| "fully RBAC control thakbe — jake jei access deya hobe se sudhu sei access pabe" | FR-1.* (permission matrix + enforcement) |
| "Team wise vag thakbe full companyr employee… Supply chain team, CS team, Developer Team, Marketing Team, Accounting Team etc" | FR-2.1–2.5 (teams entity + membership) |
| "prottekta team wise task gula vag kora thakbe" | FR-2.6–2.9 (team-scoped visibility) |
| "prottekta team er team leader thakbe… tar under e kaj kora employee der task manage korbe" | FR-3.1–3.4 (leader role + powers) |
| "sobai tader kaj perfectly update kortese kina seta check korbe" | FR-3.5–3.7 (leader dashboard + staleness tracking + nudge) |
| "Team leader theke feedback pabe main admin… main admin team leader theke feedback nibe" | FR-4.* (team reports + admin overview + review loop) |
| "khubii professionally… jevabe sob jaygay acceptable hobe" | Design mirrors ClickUp/Asana patterns (§3), master-SRS §8 model |
| "User Experience jeno good thake… employee ra jeno bujhte pare" | FR-5.* (UX rules: scoped sidebar, team badge, empty states, no new jargon) |

---

## 2. Current system — scan findings (as-is)

### 2.1 What exists today (verified, with file refs)

**Roles & auth:**
- 4 workspace roles: `owner | admin | member | guest` (`users.role`, `db/schema/_shared.ts:68`), carried in the JWT (`{sub, role, workspaceId}`, minted fresh at login/refresh — `AuthService.ts:143-151, 277-285`).
- ONE enforcement primitive: `canAccess(roles[])` middleware (`middlewares/canAccess.ts:5-17`) — flat list check, no hierarchy, no resource awareness.
- Workspace isolation is solid: every repo query filters `workspace_id` from the JWT (never from client input).

**What role-gating covers today:** ONLY configuration/structure writes — space/list/status/task-type/tag/custom-field/form/template CRUD, sprint lifecycle, on-call set, workspace PATCH, user admin (invite/role/deactivate), SLA override → `canAccess([OWNER,ADMIN])`. Space/list DELETE → `[OWNER]`.

**What is NOT gated (any logged-in user, even guest, can do):** create/edit/archive/soft-delete ANY task anywhere, comments, checklists, dependencies, attach tasks to sprints, apply templates into any list, report bugs, read EVERYTHING in the workspace (all spaces, all lists, all tasks, all users, all activity, search, eng dashboards, SLA lists).

**In-service ownership checks (the only fine-grained rules that exist):** profile edit = self-or-admin; owner role immutable + no self-role-change; comment edit = author-only within 15 min; comment/attachment delete = author/uploader-or-admin; task hard-delete = owner/admin; guest = uploads blocked + custom-field redaction (`hidden_from_guests`).

### 2.2 The gaps (G-1 … G-10)

| # | Gap | Evidence |
|---|---|---|
| G-1 | **No teams concept at all.** No `teams` table, no membership junction table, no ACL/share table anywhere in the 35-table schema. | schema scan, definitive |
| G-2 | **`is_private` on spaces/lists is decorative** — stored, validated, serialized, but NEVER used in any WHERE/filter/gate. Private spaces are visible to every member via API. | `hierarchy.ts:43,138`; zero enforcement call-sites |
| G-3 | **Every member can edit every task** — no team/ownership boundary on task writes. | `routes/tasks.ts` (all ⚠️ authenticate-only) |
| G-4 | **Frontend has ~zero role-aware UI.** Any member can open Settings→Members (sees role-change/deactivate controls), Workspace settings (sees "Delete workspace" button), all catalog pages, Import/Export. Only 2 role branches exist in the whole SPA: private-space hiding in sidebar (owner/admin) and owner-row immutability in Members. | `SettingsLayout.tsx:26-78`, `SidebarSpaceTree.tsx:44-50` |
| G-5 | **All pickers enumerate the whole company** — assignee/reviewer/bulk-assign/search-People list ALL workspace users (`useUsers` → `GET /users`). | `InlineAssigneeEdit.tsx:22`, `SearchPage.tsx` |
| G-6 | **Home "Open Team Tasks" KPI is workspace-wide** (name says team, data says company). Recent Activity, Search, Sprint Board, Eng Home, SLA views — all workspace-wide for everyone. | `HomeService.ts:122-126`, `HomeRepo.openTeamSeries` |
| G-7 | **AI help-bot would leak cross-team data** — its `search` + `get_my_task_counts` tools span the whole workspace. | `assistant/tools.ts:93-140` |
| G-8 | "Team" exists today only as `tasks.reporter_team` — a 6-value label enum (`ops/cs/inventory/listing/marketing/internal`) on bug tasks. Not an access boundary. | `_shared.ts:92-99` |
| G-9 | **No leader concept** — the only elevated non-owners are 2 demo admins. The dev-team doc's `eng-lead/eng-dev/eng-qa` sub-roles were spec'd (§3.23) but never built. | seed + WHAT_DEV_TEAM.md |
| G-10 | **No reporting/feedback loop** — owner oversight today = Home KPI tiles only. No per-team dashboards, no leader→admin reports. | Company_Required §19 expected them |

### 2.3 What the original specs already say (we align with them)

- **Master SRS §8** (FINAL_Technical_Requirements.md, in git history¹) already designed: permission resolution algorithm (deny→owner-allow→scope chain→most-specific-wins), `space_members` table with `view|comment|edit|full` levels, guest rules (no member-list access, explicit invitation only), central `permissions.ts` + `can(action, ctx)`, SQL-level visibility filters to kill IDOR, audit-logging all role/permission changes. **This design is adopted below.**
- **Company_Required §18**: "Space-level access control (Operations team only sees Operations space)" — literally this feature.
- **WHAT_DEV_TEAM §3.23**: space-scoped sub-roles (`eng-lead` closes sprints, manages on-call) — folded into the generic Team Leader role here (D-7).
- **ClickUp reference (§32, §1)**: public-by-default + private-by-membership, 4 per-item permission levels, hierarchy "most specific wins", Teams-as-user-groups. Our model mirrors this at V1-appropriate scale.
- **API_DESIGN.md**: response envelope `{data, pagination}`, dotted error codes, snake_case wire fields, cursor pagination — ALL new endpoints follow these conventions. Its Appendix B matrix is extended, not replaced.

¹ Note: `FINAL_Technical_Requirements.md`, `WHAT_SHUTKIHUT_ACTUALLY_NEEDS.md`, `WHAT_DEV_TEAM_NEEDS.md`, `Company_Required_Requirements.md` were deleted from the working tree but are intact in git history (`git show 44933694^:<filename>`).

---

## 3. Proposed design

### 3.1 Concept model

```
Workspace (BeautyBooth — unchanged, single-tenant)
│
├── Workspace roles (unchanged 4): owner > admin > member > guest
│     · owner/admin = management layer ("main admin")
│     · member      = employees
│     · guest       = external/limited (freelancer, supplier)
│
├── Teams  ← NEW first-class entity
│     · e.g. Supply Chain, Customer Support, Product Listing,
│       Marketing, Accounting, Engineering
│     · each team: 1+ Leaders, N Members (team_members.team_role)
│     · a user can belong to 1+ teams (usually 1)
│     · Team Leader = TEAM-level role, NOT a workspace role
│       (an employee stays workspace-"member" while leading their team)
│
├── Spaces → linked to teams (spaces.team_id)
│     · team-linked space  = visible ONLY to that team (+ admin/owner)
│     · unlinked space     = company-wide (visible to all members)
│     · is_private=true    = visible ONLY to explicit space_members
│       (finally enforced) — for sensitive lists inside/across teams
│     · one team may own multiple spaces; spaces can be re-linked
│
└── Tasks — inherit team via list → space → team (no schema change on tasks)
      · PLUS task-level grants: assignee / watcher / creator of a task
        always sees THAT task even outside their team
        (this keeps cross-team flows like report-a-bug working)
```

**Why this shape (and not alternatives):**
- *Teams as separate entity* (not "space = team"): people-grouping and content-grouping are different concerns — a team can own several spaces later, membership is managed once, and it matches Asana Teams / ClickUp user-groups. Migration stays additive.
- *Leader as team-role* (not a 5th workspace role): exactly what WHAT_DEV_TEAM §3.23 prescribed ("space-scoped permissions, not new workspace roles"), avoids JWT/role-matrix churn, and allows per-team leaders naturally.
- *Task-level grants for assignee/watcher*: ClickUp's behavior; without it, report-a-bug (CS → Engineering) would hide the bug from its own reporter.

### 3.2 Permission matrix (FR-1.1) — the heart of RBAC

Legend: ✅ = allowed · ▲ = within own team only · ◐ = own/assigned items only · — = not allowed · (D-n) = pending decision

| # | Action | Owner | Admin | Team Leader | Member | Guest |
|---|---|---|---|---|---|---|
| **Workspace** ||||||
| 1 | Edit workspace settings | ✅ | ✅ | — | — | — |
| 2 | Delete workspace | ✅ | — | — | — | — |
| 3 | Invite users / change roles / deactivate | ✅ | ✅ | — | — | — |
| 4 | View member directory (`GET /users`) | ✅ | ✅ | ✅ | ✅ (D-4) | — |
| 5 | Import / Export | ✅ | ✅ | — | — | — |
| **Teams** ||||||
| 6 | Create/edit/archive teams, assign leaders | ✅ | ✅ | — | — | — |
| 7 | Add/remove members of a team | ✅ | ✅ | ▲ (D-6) | — | — |
| 8 | View team dashboard (workload/staleness) | ✅ all | ✅ all | ▲ | — (D-5) | — |
| 9 | Submit team report | — | — | ▲ | — | — |
| 10 | Review team reports + give feedback | ✅ | ✅ | ▲ own (read) | — | — |
| 11 | Nudge a team member ("please update") | ✅ | ✅ | ▲ | — | — |
| **Structure** ||||||
| 12 | Create company-wide space | ✅ | ✅ | — | — | — |
| 13 | Create space under own team | ✅ | ✅ | ▲ | — | — |
| 14 | Edit/archive space | ✅ | ✅ | ▲ | — | — |
| 15 | Delete space (archived+empty) | ✅ | — | — | — | — |
| 16 | Create/edit/archive lists | ✅ | ✅ | ▲ | — | — |
| 17 | Manage statuses of a list | ✅ | ✅ | ▲ | — | — |
| 18 | Manage space members / private-space grants | ✅ | ✅ | ▲ | — | — |
| **Catalog (workspace-wide)** ||||||
| 19 | Task types, tags, custom fields, templates CRUD | ✅ | ✅ | — | — | — |
| 20 | Manage forms (create/edit/publish) | ✅ | ✅ | ▲ (own team's lists) | — | — |
| **Visibility (read)** ||||||
| 21 | See team-linked spaces | ✅ all | ✅ all | ▲ | ▲ | grants only |
| 22 | See company-wide spaces | ✅ | ✅ | ✅ | ✅ | grants only |
| 23 | See private spaces | ✅ | ✅ | if space_member | if space_member | if space_member |
| 24 | See a task outside own team | ✅ | ✅ | if assignee/watcher/creator | if assignee/watcher/creator | if assignee/watcher |
| 25 | Global search / activity / home KPIs | ✅ full | ✅ full | ▲ scoped | ▲ scoped | grants only |
| **Tasks (inside an accessible space)** ||||||
| 26 | Create task | ✅ | ✅ | ✅ | ✅ | — |
| 27 | Edit any task in own team's spaces | ✅ | ✅ | ▲ | (D-2) | — |
| 28 | Edit tasks created by / assigned to me | ✅ | ✅ | ✅ | ✅ | — |
| 29 | Assign/unassign within team | ✅ | ✅ | ▲ | (D-3) | — |
| 30 | Assign cross-team | ✅ | ✅ | — | — | — |
| 31 | Archive task | ✅ | ✅ | ▲ | ◐ | — |
| 32 | Soft-delete task | ✅ | ✅ | ▲ | ◐ (creator) | — |
| 33 | Hard-delete task | ✅ | ✅ | — | — | — |
| 34 | Comment on visible task | ✅ | ✅ | ✅ | ✅ | ✅ |
| 35 | Edit/delete own comment (existing rules) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 36 | Upload attachments | ✅ | ✅ | ✅ | ✅ | — (existing) |
| 37 | Checklists / dependencies / watchers on visible tasks | ✅ | ✅ | ✅ | ✅ | — |
| **Engineering specials** ||||||
| 38 | Report a bug (→ Bug Triage, cross-team) | ✅ | ✅ | ✅ | ✅ | — |
| 39 | Sprint create/start/close | ✅ | ✅ | ▲ (Eng leader) | — | — |
| 40 | Manage on-call rotation | ✅ | ✅ | ▲ (Eng leader) | — | — |
| 41 | SLA override | ✅ | ✅ | — | — | — |

Rules that are NOT decisions (fixed by design):
- Backend always enforces; frontend only mirrors (never trusts client) — master SRS §8.3.
- Most-specific rule wins: task-level grant > space grant > team link > company-wide.
- `owner` remains unique + immutable (existing in-service guards stay).
- @mention picker offers only users who can SEE that task (no mention-then-leak).
- Deactivated users lose everything immediately (existing status check + team queries filter `status='active'`).

### 3.3 Visibility algorithm (FR-1.2) — one function, used everywhere

New module `src/server/permissions/policy.ts`:

```ts
// resolved once per request (1 indexed query on team_members + space_members)
type ActorCtx = { userId, role, workspaceId, teamIds[], leaderTeamIds[], grantedSpaceIds[] }

accessibleSpaceIds(ctx):
  if role in (owner, admin) → ALL spaces
  else → spaces WHERE workspace_id = ctx.workspaceId AND (
           (is_private = 0 AND team_id IS NULL)            -- company-wide
        OR (is_private = 0 AND team_id IN ctx.teamIds)     -- my team(s)
        OR (id IN ctx.grantedSpaceIds) )                   -- explicit grants

canSeeTask(ctx, task):
  task.space_id IN accessibleSpaceIds(ctx)
  OR task.id IN (my assignee / watcher / created_by)       -- task-level grant

can(ctx, action, resource?) → boolean                      -- the matrix in §3.2
```

- Every read repo gets the space filter pushed into SQL (JOIN lists→spaces + `IN` clause) — **IDOR-proof at the query layer** (master SRS §39.11), not just controller checks. Inaccessible id → 404 (indistinguishable from nonexistent, same as current cross-workspace behavior).
- Every write path calls `can()` before mutating; 403 uses existing dotted error codes (`auth.forbidden`, new `team.forbidden`, `space.forbidden`).
- JWT unchanged (`{sub, role, workspaceId}`) — team membership is looked up per request (indexed, ~1ms), so adding/removing someone from a team takes effect **immediately**, no re-login.

### 3.4 Data model changes (FR-2.1)

New tables (Drizzle + `database/schema.sql` mirrored 1:1, triggers/views in `drizzle/_post.sql` — per repo parity rule):

```sql
teams (
  id TEXT PK,                 -- t_...
  workspace_id → workspaces CASCADE,
  name ciText, UNIQUE(workspace_id, name),
  description TEXT, color TEXT, icon TEXT,
  created_by → users RESTRICT,
  archived_at, created_at, updated_at )

team_members (
  team_id → teams CASCADE,
  user_id → users CASCADE,
  team_role TEXT CHECK IN ('leader','member') DEFAULT 'member',
  added_by → users, created_at,
  PK (team_id, user_id), INDEX (user_id) )

space_members (                        -- explicit grants: private spaces,
  space_id → spaces CASCADE,          -- cross-team collaborators, guests
  user_id → users CASCADE,
  permission TEXT CHECK IN ('view','comment','edit','full') DEFAULT 'edit',
  added_by → users, created_at,
  PK (space_id, user_id), INDEX (user_id) )

team_reports (
  id TEXT PK,
  workspace_id → workspaces CASCADE,
  team_id → teams CASCADE,
  period_start, period_end,            -- epoch-ms day bounds, workspace tz
  status TEXT CHECK IN ('draft','submitted','reviewed') DEFAULT 'draft',
  highlights TEXT, blockers TEXT, needs TEXT,   -- structured sections
  metrics_snapshot TEXT,               -- JSON: auto-captured team KPIs at submit
  submitted_by → users, submitted_at,
  reviewed_by → users, reviewed_at,
  admin_feedback TEXT,
  created_at, updated_at,
  UNIQUE (team_id, period_start) )
```

Column additions:
- `spaces.team_id` TEXT NULL → teams **SET NULL** (+ INDEX) — NULL = company-wide.
- `invitations.team_id` TEXT NULL, `invitations.team_role` TEXT NULL — invite someone straight into a team; accept-invitation auto-inserts `team_members`.

No changes to `tasks` (team derives via `primary_list_id → lists.space_id → spaces.team_id`; existing `idx_lists_space_archived` + new `spaces.team_id` index carry the join). `reporter_team` enum stays for bug attribution (auto-prefilled from the reporter's team — small UX win).

### 3.5 Backend enforcement architecture (FR-1.3)

1. **`permissions/policy.ts`** — single source of truth: `Action` union, `can()`, `accessibleSpaceIds()`, `canSeeTask()`. Unit-tested exhaustively (every matrix row × role).
2. **`middlewares/requirePermission.ts`** — thin wrapper for route-level actions (`requirePermission("team.manage")`); resource-level checks stay in services via `can()`.
3. **Actor context loader** — builds `ActorCtx` per request (one query joining `team_members` + `space_members` by `user_id`); attached to `req.actor`.
4. **Repo retrofits** — every read that today filters only `workspace_id` gains the space-visibility predicate: tasks (list/get/subtasks/activity/my-work stays personal), lists, spaces, search, home KPIs + agenda, workspace activity, eng/home, SLA breached, sprints tasks, forms, templates apply-targets, attachments/comments/checklists/dependencies (via parent-task visibility).
5. **Write gates** per matrix — task create/update/assign/archive/delete, sprint attach, template apply, form manage, structure CRUD (leader ▲ paths added to today's `canAccess([OWNER,ADMIN])` routes via `can()`).
6. **Audit** — new `workspace_activity` entries: `team.created/updated/archived`, `team.member_added/removed`, `team.leader_assigned`, `space.linked_to_team`, `space.member_added/removed`, `report.submitted/reviewed`, plus existing role-change events. (Master SRS §39.12.)
7. **AI assistant** (G-7): `toolCtx` gains `teamIds/grantedSpaceIds`; `search` + `get_my_task_counts` + `get_my_agenda` route through the same `accessibleSpaceIds()` — the bot can never say more than the user can see. KB (`knowledge-base.md`) updated with Teams/Roles sections (AI_ASSISTANT_PLAN §6 rule).

New API surface (all follow API_DESIGN.md conventions — envelope, dotted errors, snake_case):

```
Teams:        GET/POST /teams · GET/PATCH/DELETE /teams/:id
              POST/DELETE /teams/:id/members(/:userId)  (body: team_role)
              GET /teams/:id/dashboard        (leader/admin: workload+staleness)
Space grants: GET/POST/PATCH/DELETE /spaces/:id/members(/:userId)
Reports:      GET/POST /teams/:id/reports · GET /reports (admin inbox, ?status=)
              PATCH /reports/:id (draft edit) · POST /reports/:id/submit
              POST /reports/:id/review        (body: admin_feedback)
Me:           GET /me/teams                   (frontend bootstrap)
```

### 3.6 Team Leader features (FR-3)

**FR-3.1 Leader powers** — matrix column "Team Leader": full task control inside own team, structure management of own team's spaces/lists, team membership (D-6), forms on own lists, Eng leader additionally sprints + on-call (row 39–40).

**FR-3.2 Team Dashboard** (`/teams/:id/dashboard`, leader + admin/owner):
- **Member workload table** — per member: open, due today, overdue, done (7d), **last activity timestamp** (from `task_activity`/`workspace_activity`).
- **"Not updated" tracker (FR-3.5)** — tasks with no activity in N days (default 3 working days, workspace `working_days`-aware) grouped by member — directly answers *"sobai tader kaj perfectly update kortese kina"*.
- **Queues:** overdue, blocked (dependencies), awaiting review, unassigned.
- **Team KPI tiles** — reuse Home KPI infra, team-scoped (open, due-today, overdue, completed-this-week, SLA breaches ▲).
- **FR-3.6 Nudge** — leader clicks "Request update" on a member's stale task → in-app notification (`team.nudge` type, rides existing SSE inbox): *"Your leader requested an update on TASK-123"*. Rate-limited (1/task/day) to stay respectful.

**FR-3.7 Leader home** — Home page gains a compact "My team" card for leaders (top 3 stale + overdue counts + link to dashboard).

### 3.7 Admin features (FR-4.1–4.3)

- **Teams settings page** (`/settings/teams`, admin/owner): CRUD teams, assign leader(s), member management (move people between teams), link/unlink spaces, archive team (guard: warn if it still owns spaces; spaces revert to company-wide or get re-linked).
- **Teams Overview dashboard** (`/teams` for admin/owner): one card per team — leader, member count, open/overdue/completed-7d, staleness %, last report status (submitted/reviewed/missing). The *"main admin sob team check korbe"* screen.
- **Members page upgrades:** show team + team-role chips per member; invite modal gains optional Team + team-role fields (writes `invitations.team_id`).

### 3.8 Leader → Admin feedback loop (FR-4.4–4.7) — "Team Reports"

Professional, lightweight weekly cycle (mirrors Asana status updates / Lattice check-ins):

1. **Compose** — leader opens "Team report" (from their dashboard): 3 structured sections — *Highlights* (ki valo cholche), *Blockers* (ki atke ache), *Needs* (admin er kach theke ki lagbe) — plus an **auto-attached metrics snapshot** (team KPIs at submit time, so numbers are never hand-typed or stale).
2. **Submit** — status `submitted`; all admins + owner notified (`team.report_submitted`, in-app; email optional later).
3. **Review** — admin reads it in the **Reports inbox** (`/reports`), writes feedback, hits Review → leader notified (`team.report_reviewed`) — closing the loop the user described (*"main admin team leader theke feedback nibe"*).
4. **Cadence (D-8)** — weekly period (Mon–Sun, workspace tz). Friday reminder notification to leaders with an unsubmitted report (new `report-reminder` job on the existing cron scheduler). Missing reports show as "⚠ missing" on the admin overview — visibility without nagging.
5. One report per team per period (UNIQUE constraint); drafts autosave.

### 3.9 Frontend / UX plan (FR-5) — "employee ra jeno bujhte pare"

Principles: **show less, not more** (scoping *removes* clutter for employees); zero new jargon (no "RBAC/ACL" in UI — only "Team", "Leader", "Private"); every hidden thing has a graceful fallback (friendly 403/empty state, never a blank screen).

| Surface | Change |
|---|---|
| **Sidebar** | Members see: **"MY TEAM"** section (their team's spaces, team badge with color) + **"COMPANY"** section (company-wide spaces) — nothing else. Admin/owner see all teams grouped. Engineering nav (Eng Home/Sprint/On-call) only for Engineering team members + admins; **Report a bug stays global** (it's the cross-team flow). |
| **Team badge** | User's team chip in sidebar profile area + UserMenu ("CS Team · Member" / "CS Team · Leader"). Answers "ami kothay achi?" at a glance. |
| **Settings** | Nav groups filtered by role: members see My Account only; leaders + Teams section (their team); admin/owner see all. Direct-URL access to gated pages → friendly "Only admins can manage this" screen (and backend 403 regardless). "Delete workspace" rendered only for owner. |
| **Members page** | Read-only directory for members (D-4); manage controls (role/deactivate/invite) admin-only. Team chips shown. |
| **Pickers** | Assignee/reviewer/mention pickers list the task's team members (+ admins); admins see everyone. Bulk-assign same. |
| **Home** | "Open Team Tasks" + "SLA Breaches" tiles become genuinely team-scoped for members/leaders (admin/owner keep workspace-wide). My Work/Agenda unchanged (already personal). Leaders get the "My team" card (FR-3.7). |
| **Search** | Results already filtered server-side; People tab per D-4; zero-result copy explains scope ("Searching within your team + company spaces"). |
| **Task drawer** | Controls disabled-with-tooltip when `can()` says no ("Only your team leader can reassign this") — mirrored from the same matrix, single shared `usePermission()` hook (the FRONTEND_UI_PLAN.md pre-planned `lib/permissions.ts` + `hooks/usePermission.ts` finally built). |
| **Onboarding** | Invitation-accept lands with team pre-assigned → first screen already scoped + a one-time hint ("You're in Customer Support — your team's work lives here"). EmptyStates reused everywhere. |
| **AI bot** | KB updated so employees can ASK the bot "amar team e kivabe task dibo?" in Bangla — the built-in tutorial channel. |

### 3.10 Cross-team flows — explicitly preserved (FR-2.9)

These intentional boundary-crossings keep working (whitelisted in the policy, verified by tests):

1. **Report a bug** — any employee → Bug task in Engineering's Bug Triage list; reporter auto-added as **watcher** → task-level grant lets them track their own report end-to-end (the WHAT_DEV_TEAM Part-8 "killer flow": CS → Eng → fix → CS notified). `reporter_team` auto-prefills from the reporter's team.
2. **Public form submissions** — anonymous internet → task in the form's list (unchanged; forms are managed per-team via row 20).
3. **Template apply** — into accessible lists only.
4. **@mentions & #TASK refs** — picker scoped to users who can see the task; mentioned user notified as today.
5. **Cross-team assignment by admin** (row 30) — assignee gains task-level visibility automatically.

### 3.11 Notifications & jobs (new)

- New notification types: `team.nudge`, `team.report_submitted`, `team.report_reviewed`, `team.member_added` (+ prefs rows, default in-app on). All ride the existing inbox + SSE.
- New cron job: `report-reminder` (weekly, on the existing scheduler + `/api/v1/jobs/report-reminder` internalAuth route, `?dry_run` supported — same pattern as the 5 existing jobs).

---

## 4. Endpoint impact matrix (complete, to-be)

Every existing endpoint, grouped; "TO-BE" = enforcement after this project. ▲ = own team. (New endpoints listed in §3.5.)

| Group / endpoint | Today | To-be |
|---|---|---|
| **Auth** (login/refresh/reset/accept/me/change-pw/logout) | public/self | unchanged |
| GET /users | any member | member: directory per D-4 · guest: — |
| POST /users/invite · PATCH :id/role · deactivate/reactivate · admin reset-pw | owner/admin | unchanged (+ invite carries team) |
| PATCH /users/:id (profile) | self-or-admin (in-svc) | unchanged |
| GET/PATCH /workspace | any / owner+admin | GET unchanged · PATCH unchanged |
| **Spaces** GET list/:id | any member (all spaces) | filtered by `accessibleSpaceIds` |
| POST /spaces | owner/admin | + leader may create under own team (row 13) |
| PATCH /spaces/:id · archive/unarchive | owner/admin | + leader ▲ · `team_id` linking admin-only |
| DELETE /spaces/:id | owner | unchanged |
| **Lists** GET all/by-space/:id · GET :listId/tasks | any member | visibility-filtered |
| POST/PATCH/archive lists | owner/admin | + leader ▲ |
| DELETE /lists/:id | owner | unchanged |
| **Statuses** GET | any member | visible lists only |
| Statuses write (create/reorder/patch/delete) | owner/admin | + leader ▲ (own team's lists) |
| **Task types / Tags** GET | any member | unchanged (workspace catalog) |
| Task types / Tags write | owner/admin | unchanged |
| **Custom fields** GET | any member | field defs unchanged; values follow task visibility |
| Custom fields write | owner/admin | unchanged · PUT/DELETE task values → task-visibility + edit rule |
| **Tasks** POST / bulk | any member | accessible list + row 26 |
| GET my-work | personal | unchanged |
| GET /tasks/:id · subtasks · activity | any member | `canSeeTask` (404 otherwise) |
| PATCH /tasks/:id | any member | rows 27–28 (leader ▲ / member D-2) |
| assignees/watchers/tags add-remove | any member | rows 29–30 + task visibility |
| archive/unarchive · DELETE (soft) | any member | rows 31–32 |
| DELETE ?hard=true | owner/admin (in-svc) | unchanged |
| **Comments / Checklists / Dependencies** (all) | any member | parent-task visibility + rows 34–37; existing author rules kept |
| **Attachments** sign/finalize/download/list/upload/delete | any member (guest blocked upload) | + parent-task visibility; existing uploader-delete rule kept |
| **Sprints** reads | any member | Engineering team + admins |
| Sprints lifecycle writes | owner/admin | + Eng leader (row 39) |
| POST/DELETE sprint tasks | any member | Eng team members, task-visibility |
| **Engineering** POST /eng/report-bug | any member | any member/leader (row 38) — cross-team preserved |
| GET /eng/home | any member | Eng team + admins (nav hidden otherwise) |
| POST incidents/:id/postmortem | any member | Eng team + admins |
| **SLA** GET /sla/breached | any member | admin full · leader/member ▲ scoped |
| PATCH /tasks/:id/sla | owner/admin | unchanged |
| **On-call** GET current/schedule | any member | unchanged (badge is workspace-visible) |
| PUT/DELETE /on-call/:weekStart | owner/admin | + Eng leader (row 40) |
| **Forms** GET list/:id/submissions | any member | visibility of the form's list |
| Forms write | owner/admin | + leader ▲ (row 20) |
| Public form GET/submit | public | unchanged |
| **Templates** GET | any member | unchanged (catalog) |
| Templates write | owner/admin | unchanged |
| POST /templates/:id/apply | any member | target list must be accessible + row 26 |
| **Notifications** (all 9) | user-scoped | unchanged + new types |
| **Search** GET /search | workspace-wide | `accessibleSpaceIds` filter (tasks/lists/spaces/comments) + People per D-4 |
| **Activity** GET /activity, /activity/recent | workspace-wide | admin full · others scoped to accessible spaces |
| **Home** kpis/agenda | workspace-wide KPIs | team-scoped for member/leader (row 25); agenda personal unchanged |
| **Assistant** chat/conversations | workspace-wide tools | tools team-scoped (§3.5.7); conversations user-scoped unchanged |
| **SSE** /stream/inbox | user-scoped | unchanged |
| **Health/metrics/jobs** | public / internalAuth | unchanged + new `report-reminder` job |

---

## 5. Decisions needed (D-1 … D-9) — with recommendations

Reply with one line per item (or just "sob recommended").

**D-1. Team list + space mapping (MUST answer).** Proposed initial teams and how today's 6 spaces map:

| Team (proposed) | Existing space(s) it owns | Note |
|---|---|---|
| Supply Chain | Orders & Fulfillment, Inventory | your "Supply chain team" |
| Customer Support | Customer Support | |
| Product Listing | Product Listings | ops doc lists it as its own ~5–10 person team; alt: fold into Marketing |
| Marketing | Marketing | |
| Engineering ("Developer Team") | Engineering | leader gets sprint/on-call powers |
| Accounting | — (new space, created at setup) | no space exists today |
| — Company-wide | (any space you want everyone to see) | e.g. a future "Announcements" |

→ Confirm/edit this table (names are freely editable in the UI later; this is just Day-1 setup).

**D-2. Member task-edit inside own team.** (a) **Collaborative — any member edits any task in their team's spaces (RECOMMENDED**, ClickUp default; small teams, low friction; leader still oversees) · (b) Strict — members edit only tasks they created or are assigned (more control, more "please update this for me" overhead).

**D-3. Member assign powers.** (a) **Members can assign teammates within their team (RECOMMENDED)** · (b) Only leaders/admins assign.

**D-4. Employee directory (`GET /users`, Members page, search People).** (a) **All members see the full directory — read-only (RECOMMENDED**; one ~100-person company, needed for mentions/watchers UX) · (b) Members see only own team + admins.

**D-5. Team dashboard visibility.** (a) **Leader + admin/owner only (RECOMMENDED** — workload data per person can be sensitive) · (b) Whole team sees their own team's dashboard (transparency culture).

**D-6. Leader manages own team membership.** (a) **Yes — leader adds/removes existing workspace members in own team (RECOMMENDED**; inviting NEW people to the workspace stays admin-only) · (b) No — all membership admin-only.

**D-7. Engineering sub-roles.** (a) **Fold `eng-lead` into the generic Team Leader (RECOMMENDED** — Eng leader = leader of Engineering team, gets sprint+on-call powers via matrix rows 39–40; no separate role system) · (b) Build separate `eng-lead/eng-dev/eng-qa` sub-roles per WHAT_DEV_TEAM §3.23 (more machinery, V2-able).

**D-8. Report cadence.** (a) **Weekly, Mon–Sun, Friday reminder (RECOMMENDED)** · (b) Daily mini check-in · (c) Monthly. (Cadence is a setting; this picks the default.)

**D-9. Guest policy V1.** (a) **Minimal-correct (RECOMMENDED):** guests see ONLY spaces where they're explicit `space_members` + tasks they're assigned/watching; excluded from directory; existing upload-block + field-redaction stay · (b) Defer guests entirely (keep today's behavior — NOT recommended; today guests read everything, which contradicts FR-1).

---

## 6. Migration & rollout — zero-breakage by design

1. **Additive schema** — 4 new tables + 2 nullable columns; no existing rows touched. Drizzle + `database/schema.sql` + `_post.sql` parity maintained; `drizzle-kit push` (same workflow as today).
2. **Dormant until configured** — with zero teams defined, every space is company-wide → visibility identical to today. RBAC hardening (Phase 1) is the only intended Day-1 behavior change (locking admin surfaces that were never meant to be open).
3. **Setup wizard** (admin, one-time, ~10 min): create teams (D-1 table pre-filled) → assign leaders → drag members in → link spaces → done. Until done, nothing is hidden from anyone.
4. **Safety rails** — archiving a team reverts its spaces to company-wide (or re-link prompt); the last leader of a team can't be removed without a replacement warning; owner/admin can never lock themselves out (always-all access).
5. **Rollback** — clearing team links restores flat visibility instantly; new tables are inert if unused.
6. **Prod prerequisites (already flagged, still open):** delete/rotate demo accounts (owner@company.local is live on public prod — HIGH) + secrets-in-git rotation before real employees onboard.

---

## 7. Phase-wise build plan (each phase: build → test → your check → next)

| Phase | Scope | Size |
|---|---|---|
| **P0 — Foundation** | Schema (4 tables + 2 columns + indexes, schema.sql parity), `permissions/policy.ts` + `ActorCtx` loader + `requirePermission`, `GET /me/teams`, seed/demo updates, policy unit tests (every matrix row × role) | M |
| **P1 — RBAC hardening** (no teams visible yet) | Enforce matrix rows that need no team data: settings/catalog/import-export gating (backend already mostly gated → frontend parity + friendly 403s), Delete-workspace owner-only UI, `is_private` + `space_members` enforcement (G-2 fixed), guest policy D-9, audit events, negative tests (member hits admin surface → 403) | M |
| **P2 — Teams core** (the big one) | Teams CRUD + membership + leader role + space linking + setup wizard; **visibility filter into every read path** (spaces/lists/tasks/search/home/activity/eng/sla/sprints/forms/assistant); write gates per matrix; scoped sidebar + pickers + team badges; invitation-with-team; IDOR + cross-team negative tests; full regression | XL |
| **P3 — Leader console** | Team dashboard (workload, staleness tracker, queues, KPIs), nudge notification, leader home card, leader structure powers (▲ rows), Eng leader sprint/on-call | L |
| **P4 — Reports & admin overview** | `team_reports` lifecycle (draft/submit/review + feedback), admin Teams Overview + Reports inbox, notifications, `report-reminder` cron job | L |
| **P5 — Polish + ship** | AI-bot KB + tool scoping finalization, empty states/onboarding copy pass, full-system regression (existing ~1690-check baseline + new RBAC suite), deploy + live verification | M |

Each phase ends deployable; you say "run P<n>" style prompts exactly like the go-live plan. Test-DB isolation rules (Phase-0 gotcha memory) apply to every phase.

---

## 8. Non-functional requirements

- **NFR-1 Security testing:** per-role positive+negative API tests for every changed endpoint; IDOR probes (foreign team's task/list/space id → 404); privilege-escalation attempts (member → admin action, leader → other team) → 403; assistant-tool leak tests.
- **NFR-2 No regression:** existing behavior for owner/admin identical except where the matrix intends change; the go-live regression suite re-runs green in P2 and P5.
- **NFR-3 Performance:** +1 indexed query per request (actor context); visibility joins covered by new indexes (`spaces.team_id`, `team_members.user_id`, `space_members.user_id`); hot list reads keep using `idx_tasks_list_active`. Perf smoke on `/home/kpis` + `/search` (worst joins) before/after.
- **NFR-4 Audit:** all team/role/grant mutations + report lifecycle logged to `workspace_activity` (§3.5.6).
- **NFR-5 UX acceptance:** an employee logging in post-setup sees ONLY: their team section, company spaces, their work — and can self-serve "what can I do?" via the updated AI bot.
- **NFR-6 Docs:** API_DESIGN.md Appendix B matrix updated; assistant KB updated; admin setup guide (1 page, Banglish) written in P5.

## 9. Out of scope (V2+)

Custom roles (ClickUp Enterprise-style) · per-field permissions beyond `hidden_from_guests` · per-view sharing (`view_shares`) · folders · public task/doc sharing to non-users · time tracking / capacity planning · SSO/SCIM · email digests of reports · multi-workspace.

---

*Prepared from the 2026-07-14 full-system scan. Reply with your D-1…D-9 choices (or "sob recommended") + "kaj shuru koren" to begin at P0.*
