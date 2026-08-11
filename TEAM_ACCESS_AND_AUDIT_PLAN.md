# TEAM ACCESS CONTROL + TASK AUDIT LOG — PHASE-WISE PLAN

**Written:** 2026-08-11 · **Baseline:** HEAD `13eeaea`, working tree clean
**Scanned before writing:** RBAC visibility machinery · task-audit coverage · every assignment path ·
the live dev + QA databases. Every claim below was verified against code or data, not assumed.

---

## 0. THE TWO REQUIREMENTS, RESTATED

**R1 — Teams, visibility, and cross-team assignment**
1. Every member belongs to a team, and that is recorded.
2. Every team has a Head / Team Leader.
3. A member sees only their own team's lists and tasks — **unless** their team has been granted
   visibility of another team (permission is granted **team → team**, not person → person).
4. If team A assigns work to a member of team B, it must be **approved** before it takes effect.
5. The receiving member can instead raise a **query** ("this needs 2 more days, not 3") which goes
   back to the requester.
6. It must stay smooth: one team routinely assigns work to another, and several teams' members work
   on one task together.

**R2 — Task audit log and edit rights**
1. Every task shows its own audit log: who created it, who changed what, when.
2. Only the task's **assignees** may edit it — plus the **Head of the team that owns the task**, even
   if the Head is not assigned.
3. Nobody else.

---

## 1. THE GOOD NEWS — MOST OF THE ENGINE ALREADY EXISTS

This is not a rebuild. Verified facts:

| What you need | What already exists |
|---|---|
| Teams | **`spaces` = departments.** 7 exist today (Customer Service, Dev Team, Engineering, Marketing, Orders & Fulfillment, Product & Inventory, Social Media & Content) |
| Team Head | **`spaces.head_user_id`** — 6 of 7 already set. Helper `isHeadOfSpace()` at `ReviewsService.ts:56` |
| Member → team | **`user_roles` rows with `scope_type='space'`** — 15 already exist (rakib → Customer Service, sadia → Orders & Fulfillment, …) |
| "See only my team" | **The whole scoping engine is built and live-proven.** `space.view` at scope `space` → `materialiseScope` → SQL predicates in 8 repos |
| A working example | The **"Department Only"** role already has exactly your model: `space.view = space`, `task.view = space`, `task.edit = own`. `cs.only@` and `marketing.only@` run on it today, and a live probe confirmed cross-team reads return 404 and non-own edits return 403 |
| "Only assignees edit" | `own` scope already means created-by **or** assignee, and `assertScoped` already runs on task edit/archive/delete/assign |
| Per-task audit log | **`task_activity`** — 27 action codes, and `task_updated` already stores real `{field: {from, to}}` diffs |

**So why is nothing restricted today?** Because the seeded **Member** role holds `space.view = all`.
The 15 space rows exist but restrict nothing — they are currently decorative.

**And why can't anyone see the audit log?** Because of one line:
`client/src/components/task/TaskDetailDrawer.tsx:396` renders the activity section only
`{isDev && …}` — i.e. **only on Engineering-type tasks**. On every Operations, CS or Marketing task
the data is written and never shown.

---

## 2. WHAT IS GENUINELY MISSING (the real build list)

| # | Gap | Evidence |
|---|---|---|
| G1 | No "home team" on a user | `users` has no such column (verified via `SHOW COLUMNS`) |
| G2 | **Setting a Head does not make them a member** | `spaces.head_user_id` writes no `user_roles` row; `SpacesService.update:234-259` writes only the column. **The moment visibility narrows, every Head is locked out of their own department** (`SpacesRepo.findByIdInWorkspace` is scope-filtered → 404) |
| G3 | No team → team visibility | No table, no code. The single insertion point is `visibleSpaceIds()` at `rbac/scope.ts:94-102` |
| G4 | No "Head" reach in RBAC | `PermissionEntry` is `{all, spaceIds, own, ownSpaceIds}`. "Head of the owning space may edit" is not expressible |
| G5 | `own` cannot mean "assignee only" | `isOwnResource` (`can.ts:100-108`) is `createdBy OR assignee` |
| G6 | 28 of 36 repositories never filter by visibility | Only Tasks, Lists, Spaces, Search, Home(2 of 7), Forms, TaskDependencies, WorkspaceActivity do |
| G7 | `SlaRepo` unfiltered while `HomeRepo.slaBreachesSeries` **is** filtered | The SLA tile and the SLA queue will show different numbers the moment visibility narrows |
| G8 | Dept-review protection is accidental | `elevate()` / `elevateToSpaces()` / `systemPrincipal()` / `publicFormPrincipal()` have **zero callers**. Reviews survive only because `ReviewsRepo` happens to be unfiltered |
| G9 | No team-member management UI or API | `space.members_manage` gates exactly one **read** endpoint. `RolesAdminService.spaceMembers` returns assignment rows with **no user names**. And `rbacApi.assign/revoke` have zero callers in the client |
| G10 | Audit log hidden on non-dev tasks | `TaskDetailDrawer.tsx:396` |
| G11 | `GET /tasks/:id/activity` has **no permission gate** | Any member — including a guest — can read any task's full history, across teams |
| G12 | The `{from, to}` diffs are written but never rendered | `TaskActivitySection.tsx:62-79` reads only `context.fields` |
| G13 | 14 operations write no audit row | incl. **bulk assignee/tag changes**, attachments, comment edit/delete, hard delete, checklist rename, bulk item add, descendant archive, postmortem |
| G14 | No approval mechanism of any kind | 4 assignment paths, all immediate |
| G15 | **Bulk assign fires no notification, email or push at all** | `TaskWriteService.bulk` has no `notifications.createMany` — a bulk-assigned person is silently assigned today |

---

## 2b. ⚠️ SELF-REVIEW FINDINGS — two plan-breaking bugs, caught before any code was written

The first draft of this plan would have shipped two real defects. Both are fixed in the phases below.

### 🔴 B1 — Cross-team collaboration would have become invisible

Your stated core case: *"multiple team er member mile ekta task complete korte pare."*

Under team-scoped visibility as first drafted, a Software member assigned to a **Supply Chain** task
would **not be able to see that task at all** — assigned, but 404.

The escape hatch for exactly this exists (`rbac/ownEscape.ts`) — its own comment names the case:
> *"A person scoped to Marketing still has to see the bug they filed into Engineering, and the task
> Engineering assigned to them."*

But it is **gated on holding `task.view` with `own` reach** (`ownEscape.ts:31`):
```ts
const ownReach = !!entry && (entry.own || entry.ownSpaceIds.size > 0);
if (!ownReach) return [];
```
and the "Department Only" template — the model this plan copies — grants `task.view = space`, which
produces **no `own` reach**. The mechanism is built and switched off.

**Fix (configuration, not code):** the team role must grant `task.view` at scope **`own`**, not
`space`. A space-scoped assignment of an `own` grant fills `ownSpaceIds`, which turns the escape on.
Net rule becomes: **"my team's tasks — plus any task I created or am assigned to, anywhere."**
`space.view = space` still supplies the team boundary; `task.view` only feeds the escape.

**Consequence to accept:** the escape applies to **tasks**, not lists. A cross-team assignee opens the
task from Inbox / My Work / search / a `/t/<id>` link, but cannot browse the other team's list page.
That is the right boundary — but the UI must never dead-end them there.

### 🔴 B2 — The query flow would have deadlocked

Your flow: the receiver flags *"I need 2 more days"* → the requester extends the deadline.

But after Phase 7 (`task.edit = own`), the requester — who is not an assignee — **loses the right to
edit that task**. The query could be raised and never answered.

**Fix:** answering a query is **not** a generic task edit. It is a dedicated endpoint authorised by
*"you are the requester of this pending request"*, which then performs the date change through the
normal task-update path (so the overdue-alert re-arm still fires).

### Four smaller gaps also found

| # | Gap | Consequence | Fix |
|---|---|---|---|
| B3 | **The invite form has no team field** | A newly invited person would have no team, so after the switch they log in to an **empty app** | Team becomes a required field on invite (Phase 1) |
| B4 | **Guest has no space grant** | Guest would see nothing at all after the switch | Needs your decision — Q9 |
| B5 | A cross-team assignee cannot open the **list** their task lives in | Sidebar/list navigation dead-ends | Deliberate; route them via task links and show a clear message, never a raw 404 |
| B6 | **"Dev Team" has no Head** | A cross-team request into it would have no approver | If a team has no Head, the assignee alone accepts (admins can always step in) |

---

## 3. DESIGN DECISIONS (kept deliberately small)

To honour *"jeno complex na hoye jay"*, the design adds **three tables and one column** — nothing else.

| Decision | Choice | Why |
|---|---|---|
| **Team = ?** | **The existing `space`.** No new hierarchy, no `teams` table | Spaces already own lists and tasks, already have a head, already drive visibility |
| **Membership = ?** | **The existing `user_roles` row** (`scope_type='space'`) | Already exists, already feeds the scoping engine. A separate members table would need syncing forever |
| **Home team** | New column `users.primary_space_id` | One explicit answer to "which team is this person in" |
| **Team → team visibility** | New table `space_visibility_grants (viewer_space_id, target_space_id)` | Exactly matches "permission is given to the team". One row per grant instead of one row per member |
| **Head may edit** | A **hard-wired head branch** beside the existing owner branch in `can.ts:83-94` | Same shape the code already uses for `isOwner`. No new RBAC concept for an admin to understand |
| **Approval** | New table `task_assignment_requests` + a small `task_assignment_request_events` ledger | Copies the proven `task_reviews` shape: current state on one row, full history in an append-only ledger |
| **The "flag"** | Called **`query`**, in its own table | ⚠️ **"Flag" is already taken.** In Dept Review, `flagged` means a Head rejecting *finished* work. Reusing the word or the `reviewStatuses` enum would break the dept queue, the summary tiles, the Home KPI and the weekly report |

---

## 4. QUESTIONS I NEED ANSWERED BEFORE PHASE 1

Each has my recommendation. Say "sob recommendation thik ache" and I will proceed with these.

| # | Question | My recommendation |
|---|---|---|
| Q1 | Can a person be in **more than one** team? | **One home team**, plus optional extra team memberships for people who genuinely straddle (the data already has some). Home team is what shows on their profile and drives defaults |
| Q2 | Who accepts a cross-team request — the **assignee**, or their **Head**? | **Either.** The assignee accepts their own work; the Head can accept or decline on the team's behalf (capacity is a Head decision). Both are notified |
| Q3 | Does the **creator** keep edit rights after assigning someone else? | **Yes, until the task is accepted by an assignee; after that, no.** Otherwise a person cannot fix a typo in a task they just wrote. (Strict "assignee only" is available if you prefer) |
| Q4 | Should **Admin / Owner** still see everything? | **Yes.** They keep `space.view = all`. Only Member and Guest become team-scoped |
| Q5 | Same-team assignment — approval too? | **No.** Only *cross-team* assignment needs approval. Inside your own team it must stay instant, or the tool becomes friction |
| Q6 | What happens to a request nobody answers? | **Auto-expires after 7 days**, notifies the requester, and the task is left unassigned. Copies the invitation-expiry pattern |
| Q7 | S0/S1 incident auto-paging the on-call engineer | **Exempt from approval.** An incident page that waits for an accept is not a page |
| Q8 | Bulk-assign across teams | **Creates requests, same as single assign**, and the toolbar reports "*12 assigned, 3 pending approval*" instead of today's silent success |
| Q9 | What should a **Guest** see after the switch? | **Only the team they are given.** A guest with no team sees nothing — so the invite flow must always ask for a team (B3) |
| Q10 | Where does a cross-team task **live**? | **In the requesting team's own list.** Supply Chain creates the task on their own board and assigns a Software member to it. (The alternative — putting a task directly onto Software's board — is impossible under team scoping, since Supply Chain cannot see Software's lists) |
| Q11 | What counts as **"cross-team"** for approval? | **The assignee is not a member of the space that owns the task.** This is better than comparing home teams: someone who genuinely belongs to two teams is handled correctly with no special case |
| Q12 | Can the **assignee's own Head** edit a task owned by another team? | **No** — only the Head of the team that *owns* the task, exactly as you specified. If you want the working team's Head to be able to reassign within their team, say so and I will add it |

---

## 5. PHASE MAP

Ordering rule: **everything additive and reversible first; the restrictive switch only after every
leak is closed.** Each phase ships, is verified, and is safe to stop at.

| Phase | Delivers | Risk | Serves |
|---|---|---|---|
| **P1** | Teams and Heads become real data + a management screen | 🟢 none (additive) | R1.1, R1.2 |
| **P2** | The audit log becomes visible and readable on **every** task | 🟢 none (UI + read gate) | **R2.1** |
| **P3** | The audit log becomes complete (the 14 missing events) | 🟢 low | **R2.1** |
| **P4** | Team → team visibility grants (built, not yet enforced) | 🟢 none (dormant) | R1.3 |
| **P5** | Close every visibility leak, wire elevation | 🟡 medium | R1.3 safety |
| **P6** | **THE SWITCH** — team-scoped visibility goes live | 🔴 high | **R1.3** |
| **P7** | Edit rights: assignees + team Head only | 🟡 medium | **R2.2** |
| **P8** | Cross-team approval + query — backend | 🟡 medium | R1.4, R1.5 |
| **P9** | Approval + query — UI, notifications, email, push | 🟢 low | R1.4, R1.5, R1.6 |
| **P10** | Full regression, docs, demo data, rollback rehearsal | 🟢 none | all |

> **Why the audit log (P2–P3) comes before the visibility switch:** it is zero-risk, it is half of R2,
> and it is the complaint your office raised most sharply — *"ke ki change korse kichui bujha jacche na"*.
> It also becomes the tool you use to verify every later phase.

---

## PHASE 1 — Teams and Heads become real ✅ SHIPPED 2026-08-11

> **Status: DONE.** Upgrade `016_team_membership.sql` applied (dev + qa; re-run proven no-op).
> `users.primary_space_id` + backfills (11/15 users got a home team; owner/guest/farhana/sumaiya
> stay unassigned → visible in the new UI). New server surface: `GET /teams`,
> `POST/DELETE /spaces/:id/members`, `PATCH /users/:id/team`, invite `space_id`
> (`TeamMembershipService` + `routes/teams.ts`); G2 head-sync live in `SpacesService`
> create+update. Client: `/settings/teams` page, Members team column, invite modal
> requires a team; assistant KB links the page. Tests: **23 new**
> (rbac `team-membership` 14 · spaces `head-membership` 4 · users `invite-team` 5);
> full modules green — rbac 303, spaces 250, users (see commit), assistant guards green;
> vitest 44; both `tsc` clean; live proof on the dev stack (directory · add/remove ·
> head-sync · `team.head_locked`) then reverted net-zero. API_DESIGN §34 documents it.
> One deliberate deviation from the draft below: instead of hydrating the roles-admin
> `GET /spaces/:id/members` (whose wire+gate a dozen tests pin), the directory got its
> own purpose-built `GET /teams` read — zero churn on the RBAC admin surface, and the
> canonical wire `User` stays untouched (a dozen exact-key-set tests pin it too).

**Goal:** every member has a recorded team; every Head is also a member of their own team; there is a
screen to manage both. **No visibility changes yet.**

**Server**
- Schema (three synchronized edits + `database/upgrades/016_team_membership.sql`):
  - `users.primary_space_id` VARCHAR(64) NULL, FK → `spaces.id` ON DELETE SET NULL, index
- Backfill in the same upgrade: for each user with exactly one `scope_type='space'` grant, set that as
  the home team; for each Head, set their own space.
- **Fix G2 (the critical one):** `SpacesService.update` and `.create` must ensure a `user_roles`
  space row exists whenever `head_user_id` is set, and the old Head's membership is preserved (never
  auto-removed — a former Head usually stays on the team).
- Wire up the already-existing, currently-dead `UserRolesRepo.spaceIdsForUser` as "my teams".
- New endpoints (gated by `space.members_manage`, which today opens only one read route):
  - `GET /spaces/:id/members` — **hydrated with user rows** (name, email, avatar, status, role, is-head)
  - `POST /spaces/:id/members` — add a member (creates the `user_roles` space row)
  - `DELETE /spaces/:id/members/:userId` — remove
  - `PATCH /users/:id/team` — set a person's home team
- Give the Head `space.members_manage` on their own space so they can run their own roster.

**Client**
- New **Settings → Teams** page: team list, Head (with a picker), member list, add/remove member,
  set home team. This is also the first UI for the dormant `rbacApi.assign/revoke` (G9).
- Show the person's team on their profile row and in the member list.
- **Add a required Team field to the invite form (B3)** — otherwise, after Phase 6, every newly
  invited person signs in to a completely empty application.

**Verify / exit criteria**
- Every active user has a `primary_space_id`.
- **Every Head has a `user_roles` row for their own space** (this is the gate for P6 — if it fails,
  the switch will lock Heads out).
- Adding and removing a member works from the UI and is reflected in `user_roles`.
- No behaviour change anywhere else: existing tests stay green.

**Rollback:** drop the column; the new endpoints are additive.

---

## PHASE 2 — The audit log becomes visible (R2.1, part 1) ✅ SHIPPED 2026-08-11

> **Status: DONE.** Server: `GET /tasks/:id/activity` now gated `requirePermission("task.view")`
> (G11 closed) — object reach was ALREADY the task read's reach (the service resolves through the
> scope-filtered `TasksRepo.findByIdOrCustomIdInWorkspace`, which carries the own-escape), so the
> B1 caveat held with zero extra code; proven by `tests/rbac/task-activity-scope.test.ts` (3 tests:
> space-scoped reach, cross-team-assignee escape, no-key 403). Client: `isDev` gate removed at the
> drawer — activity on EVERY task; `TaskActivitySection` now renders the stored F21 `{from,to}`
> diffs as readable rows (status ids → status names via the drawer's cached maps, `user_id` →
> full names on assign/unassign, priority numbers → labels, dates as YMD, description/sprint
> value-less by design, deleted refs degrade to "(deleted …)"); ⚠️ the response camelizer renames
> CONTEXT KEYS (`changes.task_type_id` → `taskTypeId`) — the renderer speaks camelCase on purpose.
> Verified: activity.test.ts 55/55 (pinned wire + all-four-roles intact), tasks + rbac modules
> green, vitest 44, both builds; LIVE UI proof on a Marketing task (screenshot): "moved status —
> In Progress → To Do", "assigned — Mitu Rahman", "updated / due date: 2026-08-11 → 2026-08-15 /
> priority: High → Urgent". API_DESIGN §13 updated (gate + the real 27-action vocabulary).

**Goal:** open any task, see who created it and every change since, in plain language.

**Client**
- **Remove the `isDev` gate** at `TaskDetailDrawer.tsx:396` — show the activity section on every task.
- **Render `context.changes`** — the `{from → to}` values are already stored and simply not read
  (G12). "Priority: Normal → Urgent", "Due date: 11 Aug → 14 Aug".
- **Hydrate ids into names** — status, user, tag, custom field, sprint. Today `status_changed` shows
  raw ids and "added an assignee" never says who.
- Absolute timestamps on hover (an audit line reading "180d ago" is not an audit line).
- "Load more" (the server already paginates; the client asks for one page and shows a wrong count).
- Filter by action (the server already accepts `?action=`).
- Invalidate `["task-activity", taskId]` after any task mutation — today the log never refreshes.

**Server**
- **Add the missing permission gate on `GET /tasks/:id/activity`** (G11). Today any member, including
  a guest, can read any task's whole history — which would defeat R1 before it even ships.
- ⚠️ The gate must resolve the task through the **normal task-read path** (which carries the own-escape
  from B1), **not** a plain space check. Otherwise, after Phase 6, a cross-team assignee could open
  their own task but not read its history.

**Verify:** open an Operations task → full history visible; a user outside the team gets 403/404;
edit a field → the new entry appears without a reload.

**Rollback:** revert the UI; the gate stays (it is strictly safer).

---

## PHASE 3 — The audit log becomes complete (R2.1, part 2) ✅ SHIPPED 2026-08-11

> **Status: DONE.** Every G13 gap closed, all rows in the same transaction as their mutation:
> **bulk** assignee/tag/(un)archive now write the single-path row shapes per (task, pair) that
> ACTUALLY changed (pre-state captured F21-style; `bulk: true` marker; `archived_at` no longer
> leaks into `task_updated` diffs) · **attachments** add/remove (`AttachmentsService` gained
> db+activity deps; first-finalize only, idempotent re-finalize silent) · **comment edit/delete**
> (delete carries `author_id` — an admin deleting someone else's words stays attributable) ·
> **checklist** rename `{from,to}` + bulk-item per-item rows + item field-detail
> (`text_from/text_to`, `assignee_from/to`) + template-apply now audits its checklist into being ·
> **postmortem_submitted** `{items, revised}` + ETag bump · **archive cascade** writes `via_parent`
> rows per descendant that transitioned (new `TasksRepo.descendantIdsByArchivedState`) · **hard
> delete** writes `workspace_activity` (entity `'task'` — upgrade `017_task_audit.sql`, dev+qa
> applied) BEFORE the cascade wipes the task's own trail · **names denormalised** into rows
> (`status_changed` from_name/to_name single+bulk via `StatusesRepo.namesByIds`, tag `name`,
> custom-field `field_name` + clipped `value`) · **description diffs clipped** at 280 chars.
> `created_from_template` context keys fixed to snake_case (`template_id`, `name`).
> Client: 6 new VERBS + renderer branches (prefers denormed names; statusMap stays the
> pre-P3-row fallback). Deliberately still silent (documented in API_DESIGN §13): uploads/sign,
> watcher self-toggle, position shuffles, initial content at creation (form CF values, create's
> initial tags). Tests: **16 new** across tasks/collab/attachments/eng + extended
> set-value/apply assertions; full regressions green (see commit).

**Goal:** no change to a task can happen without a row.

**Server — close all 14 gaps (G13):**
- **Bulk assignee / tag changes** — currently written straight to the repo, bypassing the service, so
  reassigning 50 tasks is invisible. Route them through the service or log inline.
- Attachment upload / delete.
- Comment edit / delete (including an admin deleting someone else's comment).
- Checklist rename, bulk item add (the template path), item field-level detail.
- Archive / unarchive of **descendant** tasks and **bulk** archive.
- **Hard delete** — write a `workspace_activity` row *before* the cascade wipes the task's own trail.
- Postmortem submit.
- Custom field set/clear — record the value, not just the field id.
- Truncate huge `description` diffs (today a large edit writes the full old + new text into one row).
- Denormalise names into `context` so a row stays readable after a status or tag is renamed.

**Verify:** a coverage test that walks every task write endpoint and asserts a row is produced.

---

## PHASE 4 — Team → team visibility grants (built, dormant)

**Goal:** the mechanism for *"Supply Chain can also see Software"* exists and is manageable — but
changes nothing yet, because visibility is still `all`.

**Server**
- New table `space_visibility_grants` (+ `database/upgrades/017`): `viewer_space_id`,
  `target_space_id`, `granted_by`, `created_at`, unique on the pair.
- Expand `visibleSpaceIds()` at `rbac/scope.ts:94-102` — **the single choke point** — so a user's
  visible set = their own team(s) ∪ every team granted to their team(s).
- Endpoints to grant / revoke (admin only), and to read a team's grants.

**Client**
- On the Teams page: *"This team can also see: [Software] [Marketing] + Add"*.

**Verify:** unit tests on the expanded set. Live behaviour unchanged (still `all`).

---

## PHASE 5 — Close every visibility leak (the safety phase)

**Goal:** make sure that when the switch is thrown in P6, **every** screen agrees. This phase exists
because 28 of 36 repositories never filter (G6), and two screens would openly contradict each other.

**Server**
- **`SlaRepo`** (G7) — otherwise the SLA tile and the SLA queue show different numbers.
- **Reviews and Reports** — wire the elevation that already exists but has zero callers (G8), so a
  Head keeps their department view instead of losing it by accident.
- **Notifications** — a notification whose deep link 404s is worse than no notification. Either scope
  the fan-out or accept and document it.
- `StatusesService.update/delete`, `CustomFieldsService.setValue`, `SprintsService.addTasks/removeTask`,
  `FormsService` field writes — the write paths that are open today.
- Comments / attachments / checklists / task-activity reads — currently protected only indirectly.
- Assistant tools: `get_my_task_counts` promises "across the whole workspace"; after the switch that
  description becomes false and must be corrected.

**Verify:** with a test account forced to a narrow scope, walk every screen and confirm no
contradiction and no leak. This is the phase that earns the right to do P6.

---

## PHASE 6 — THE SWITCH (R1.3)

**Goal:** a member sees only their own team, plus teams granted to their team.

- Change the seeded **Member** role: `space.view` → `space`, and **`task.view` → `own`** (⚠️ **`own`,
  not `space` — this is fix B1**; `space` would make every cross-team assignment invisible).
  **Guest** likewise. **Admin / Owner stay `all`** (Q4).
- Ship as its own upgrade with a **one-statement revert** documented next to it.
- Roll out on the QA database first, with the real member list, and walk each department.

**Pre-flight gate — do not proceed unless all are true:**
- ✅ Every Head is a member of their own space (P1)
- ✅ Every member has a home team (P1), and the invite form asks for one (B3)
- ✅ Every leak in P5 is closed
- ✅ **A cross-team assignment test passes**: assign a Marketing member to an Engineering task and
  confirm they can open it, read its history, comment and complete it (this is fix B1, and it is the
  single most important check in the whole plan)
- ✅ The demo accounts `cs.only@` / `marketing.only@` behave correctly (they already run this model)

**Verify:** Marketing cannot see Customer Service tasks; a granted team can; every Head sees their own
department; a cross-team assignee sees their own task; Home KPIs, search, SLA queue and activity feed
all agree.

**Rollback:** one UPDATE returning the two grants to `all`. Instant, no data loss.

---

## PHASE 7 — Edit rights (R2.2)

**Goal:** only assignees — plus the Head of the owning team — may edit a task.

**Server**
- Add a **head-of-owning-space** allow-path beside the existing owner branch (G4). The predicate
  `isHeadOfSpace` already exists; what is missing is the task → space → head composition, which two
  services already do by hand in two different ways (worth unifying into one helper).
- Apply Q3's answer for the creator.
- Change the Member role's `task.edit` to `own`.
- Add the scope check to the task-adjacent services that currently have none: checklists, comments,
  attachments, custom-field values, dependencies, SLA override.

**Client**
- Hide or disable edit controls the person cannot use, so a 403 is never the first feedback.

**Verify:** a matrix test — assignee / Head / same-team non-assignee / other-team — against every edit
path.

---

## PHASE 8 — Cross-team approval + query, backend (R1.4, R1.5)

**Goal:** cross-team assignment becomes a request; the receiver can accept, decline, or query.

**Server**
- New tables (+ upgrade): `task_assignment_requests` (current state) and
  `task_assignment_request_events` (append-only history — copies the `task_reviews` shape so the UI
  can show the whole negotiation).
- Fields: task, requested user, requested by, status `pending|accepted|declined|expired|cancelled`,
  note, proposed due date, decided by/at, expires at.
- **Insert the gate in the 3 assignment paths.** Same-team → immediate (Q5). Cross-team → request.
  Exempt the S0/S1 on-call auto-assign (Q7).
- **Accept** uses the atomic-claim pattern already proven twice in this codebase, so a double-click or
  two open tabs can never double-accept.
- **Query** records the note + proposed date and notifies the requester.
- ⚠️ **Answering a query is its own endpoint, not a generic task edit (fix B2).** After Phase 7 the
  requester is not an assignee and therefore has no `task.edit` right — so if the date change went
  through the normal edit permission, the query could be raised and never answered. Authorisation is
  *"you are the requester of this pending request"*; the endpoint then performs the date change
  through the normal task-update path, so the overdue-alert re-arm marker is still cleared and the
  new deadline actually alerts.
- **Cross-team is decided by membership, not home team (Q11):** approval is required when the
  assignee is **not a member of the space that owns the task**. Someone who genuinely belongs to two
  teams is then handled with no special case.
- New notification type(s), appended at the end of both enums per the existing rule.
- A small expiry job for unanswered requests (Q6), copying the attachment-janitor shape.

**Verify:** state-machine tests — accept, decline, query→adjust→accept, expire, cancel, double-accept,
requester withdraws, assignee deactivated mid-request.

---

## PHASE 9 — Approval + query, UI and delivery (R1.4–R1.6)

**Goal:** the flow feels smooth, which is the stated requirement.

- **Pending panel in the task drawer** — a one-line insert; every drawer section is already
  self-contained and self-gating.
- **Inbox "Requests" filter** with Accept / Decline / Query inline.
- **Assignee picker** shows each person's team and warns "*this will need Software team's approval*"
  before you commit.
- **Bulk toolbar** reports honestly — "12 assigned, 3 pending approval" (today it silently succeeds).
- Email + Web Push for: request received, request accepted, request declined, query raised, query
  answered. All reuse the existing fire-and-forget post-commit convention.
- **Bonus fix (G15):** bulk assignment currently sends no notification at all — this phase gives it one.

---

## PHASE 10 — Regression, docs, demo data

- Full per-module test sweep + the client suites.
- New Playwright specs: team-scoped visibility, edit restriction, the approval round-trip.
- Update the demo seed so the 7 teams, their Heads, their members and one cross-team request all exist
  for demonstration.
- Write the operator/admin guide (Bangla): how to create a team, set a Head, add members, grant a
  team visibility of another, and how approval works.
- Record the decisions from §4 in the project's decision log.
- Update `API_DESIGN.md` and `LOCAL_RUN_GUIDE.md`.

---

## 6. RISKS AND HOW EACH IS CONTAINED

| Risk | Containment |
|---|---|
| **Cross-team assignees blinded** (B1) | `task.view = own` on the team role + a mandatory pre-flight test in P6 |
| **Query flow deadlocks** (B2) | Answering a query is its own endpoint with its own authorisation |
| **Newly invited people see an empty app** (B3) | Team becomes a required invite field in P1 |
| **Heads locked out of their own department** (G2) | Fixed in P1 and made a hard pre-flight gate for P6 |
| Rollback gets harder as phases stack | P6 is trivially reversible **only until P7 ships**. If you want a long soak, stop after P6 |
| A watcher or @mentioned person outside the team | Their notification would deep-link to a task they cannot open. Show "you no longer have access" rather than a raw 404 |
| Two screens showing different numbers | P5 exists solely for this; the SLA pair is the known case |
| A restriction that cannot be undone | P6 is one UPDATE in each direction; P1–P5 are additive |
| The word "flag" colliding with Dept Review | New table, new enum, different name (`query`) |
| Approval friction inside a team | Same-team assignment stays instant (Q5) |
| An incident page waiting for approval | On-call auto-assign exempt (Q7) |
| A request blocking a task forever | 7-day expiry + janitor (Q6) |
| Negotiated due date not re-alerting | The date change goes through the normal update path, not a direct write |
| Regression in the 169 existing tests | Each phase ends with the affected module suites green before the next begins |

---

## 7. WHAT I NEED FROM YOU

1. Answer the 8 questions in §4 (or say "recommendations thik ache").
2. Tell me to start **Phase 1** — and only Phase 1.

I will ship each phase, verify it, show you the evidence, and stop. Nothing moves to the next phase
until you say so.
