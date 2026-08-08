# 🧪 TESTING MASTER PLAN — BeautyBooth Task Management System

**Created:** 2026-07-29
**Mode:** TESTING ONLY. No fixes are made in any phase of this plan.
**Phases:** 42 testing phases across 7 blocks.

---

## 0. THE TWO-MODE CONTRACT

This document governs **TESTING MODE** only. Fixing is a separate document and a separate run.

### Rules that apply to EVERY testing phase

| # | Rule |
|---|---|
| **R1** | **Nothing is fixed.** Not a typo, not a one-line bug, not a "while I'm here". Found → logged → move on. |
| **R2** | **A failure does not stop the phase.** Log it and keep testing the rest of the phase's checklist. |
| **R3** | **Every issue needs evidence** — the exact request/response, SQL output, screenshot, or stack trace. No "seems wrong". |
| **R4** | **Every issue needs a repro** — numbered steps a person can follow, plus the account used. |
| **R5** | **No new features.** A genuinely missing capability is logged as a `GAP`, never built. |
| **R6** | **Known issues are referenced, not re-filed.** The 4 HIGH + 11 MEDIUM + 8 LOW in `FULL_SYSTEM_SCAN_2026-07-29.md` already exist. If a test trips one, write `dup: SCAN-H1` and move on. Only file a NEW issue if the behaviour differs from what the scan documented. |
| **R7** | **Test data is cleaned up or clearly marked.** Prefix anything created with `TEST-` so a later phase does not mistake it for real demo data. Destructive probes run in a transaction that is rolled back, or against a throwaway workspace. |
| **R8** | **One phase at a time.** A phase is finished when its exit criteria are met and its result file is written. Then it stops and waits. |
| **R9** | **Do not change the environment mid-phase** (no restarts, no seed re-runs) unless the phase says so — otherwise a failure cannot be attributed. |
| **R10** | **If a phase is blocked**, say so explicitly, log the blocker as an issue, complete every part that is not blocked, and mark the phase `PARTIAL`. Never silently skip. |

### What happens after testing mode

Issues are triaged in `testing/ISSUES.md`, grouped into fixing phases in a separate `FIXING_MASTER_PLAN.md`, and only then touched.

---

## 1. FILE + FOLDER LAYOUT

```
TESTING_MASTER_PLAN.md              ← this file (the plan; does not change during the run)
testing/
├── ISSUES.md                       ← THE master issue log. Every finding lands here.
├── STATUS.md                       ← phase board: which phases are DONE / PARTIAL / PENDING
├── results/
│   ├── PHASE-01.md                 ← one result file per phase
│   ├── PHASE-02.md
│   └── …
└── evidence/
    ├── PHASE-01/                   ← screenshots, response dumps, SQL output, logs
    └── …
```

`ISSUES.md` is the single source of truth for the fixing phase. `results/PHASE-XX.md` records
what was run (including everything that **passed**), so coverage is provable.

---

## 2. ISSUE FORMAT

Every issue gets one block in `testing/ISSUES.md`:

```markdown
### ISS-042 · [P17] Removing the last assignee leaves subtasks_count stale
- **Severity:** HIGH
- **Type:** BUG                      (BUG | GAP | UX | PERF | SECURITY | DATA | DOC)
- **Phase:** P17 — Task membership
- **Area:** server/src/services/TaskMembershipService.ts:213 · DELETE /tasks/:id/assignees/:userId
- **Account:** nusrat@beautybooth.com.bd (member, Marketing head)
- **Repro:**
  1. POST /tasks/t-abc/assignees  {user_ids:["u-1"]}
  2. DELETE /tasks/t-abc/assignees/u-1
  3. GET /tasks/t-abc
- **Expected:** assignees_count = 0
- **Actual:** assignees_count = 1
- **Evidence:** testing/evidence/PHASE-17/iss-042-response.json
- **Status:** OPEN                   (OPEN | DUP | WONTFIX | FIXED)
- **Notes:** —
```

### Severity scale

| | Meaning |
|---|---|
| **CRITICAL** | Data loss, auth bypass, cross-tenant leak, or the system is unusable. Stop-ship. |
| **HIGH** | A core flow is broken or produces wrong data. Ship only with a known workaround. |
| **MEDIUM** | A feature misbehaves in a real but non-blocking way, or a control does not do what the UI says. |
| **LOW** | Cosmetic, copy, minor UX, dead code, doc rot. |
| **GAP** | Not a bug — a capability that does not exist. Decision needed, never built during testing. |

### The `dup: SCAN-xx` shorthand

`FULL_SYSTEM_SCAN_2026-07-29.md` already documents: **H1** (25 RBAC permissions unenforced),
**H2** (SLA 6h late), **H3** (`db:migrate` trap), **H4** (stale dev triggers), **M1**–**M11**,
**L1**–**L8**. Referencing one costs a single line; do not re-investigate them.

---

## 3. THE SURFACE — what "no gaps" means

The plan is complete when every row below is covered by at least one phase. §12 proves it.

| Surface | Count | Covered by |
|---|---|---|
| v1 API endpoints | **178** | P3–P33 (full map in §12.1) |
| Root endpoints (`/health`, `/health/ready`, `/health/version`, `/metrics`) | **4** | P1 |
| API spec sections (`API_DESIGN.md` §1–§33) | **33** | §12.2 |
| Error codes | **143** | P2 (catalog sweep) + owning phase |
| DB tables | **41** | P37 + owning phase |
| DB views | **5** | P30, P28, P29, P37 |
| DB triggers | **7** | P37 |
| Background jobs | **6** | P32 |
| Client pages | **39** | P35, P36 + owning phase |
| Client components | **92** | P35, P36 |
| Client views (List/Board/Calendar/Form) | **4** | P35 |
| Zustand stores | **5** | P36 |
| RBAC permissions | **56** | P5 |
| Seeded + custom roles | **5** | P5 |
| Demo accounts | **16 users** | P4, P5, P39 |
| Departments/spaces | **8** | P8, P31, P39 |
| Existing server test files | **164** | P42 |
| Existing e2e specs | **12** | P42 |

---

## 4. ENVIRONMENT + ACCOUNTS

**Stack:** API `http://localhost:5501/api/v1` · App `http://localhost:5173` · MySQL `taskmanagement`

```bash
# API   (tsx watch — nodemon ignores .ts and serves stale code)
cd server && NODE_ENV=dev npx tsx watch src/server.ts
# Client
cd client && npm run dev
```

**Password for every account: `Owner@12345`**

| Account | Role | Use for |
|---|---|---|
| `owner@company.local` | Owner (56 perms) | Setup, destructive ops, owner-only paths |
| `farhana@beautybooth.com.bd` | Admin (53) | Admin-vs-owner boundary |
| `tanvir@beautybooth.com.bd` | Admin + Engineering head | Eng module, dept review |
| `nusrat@` `sadia@` `imran@` `mitu@` | Member + dept head | Head-scoped review/report paths |
| `arif@` `sumaiya@` `jhankar@` `priya@` | Member (20) | Ordinary member paths |
| `guest@beautybooth.com.bd` | Guest (19) | Guest restrictions (upload denial) |
| `marketing.only@` / `cs.only@` | Department Only (8) | RBAC scoping + IDOR |

> ⚠️ `rakib@` is documented as a member in `DEMO_ACCOUNTS.md` but is **admin** in the DB — do not
> use it for member-scoped tests. `tanver018765@gmail.com` is `invited`, cannot log in.

**Gotchas that will otherwise waste a phase**

- Login limiter is **5/min/IP**. Batch logins, reuse tokens, or start the API with
  `DISABLE_RATE_LIMIT=1` (never in prod). A phase that tests rate limits must NOT set it.
- The access token lives **in memory only**; a page reload refreshes via the `bb_refresh` cookie.
- Server jest default timeout is 5 s but `resetTestDb()` costs ~7–8 s here → **always pass
  `--testTimeout=60000`**, or every DB-backed test mass-fails in `beforeEach` (`SCAN-M10`).
- The dev DB carries 3 stale subtask triggers (`SCAN-H4`) → **subtask status changes 500 locally.**
  P18 must record this as environment, not re-file it.
- Never run two jest invocations against the same `*_test` DB concurrently.
- Kill a stuck API with PowerShell `Get-NetTCPConnection -LocalPort 5501`, not `pkill`.

---

## 5. HOW EACH PHASE RUNS

1. Read the phase block below.
2. Confirm preconditions.
3. Execute the checklist — **every** line, in order.
4. Log issues to `testing/ISSUES.md` as they appear (do not batch to the end — a crash loses them).
5. Write `testing/results/PHASE-XX.md`: what ran, what passed, what failed, issue IDs, coverage
   notes, anything deliberately not covered and why.
6. Update `testing/STATUS.md`.
7. Stop. Report a short summary. Wait.

**Methods used, by shorthand:**

| | |
|---|---|
| `API` | Direct HTTP against `:5501` with a real token (node fetch script) |
| `UI` | Browser against `:5173` (Playwright or Chrome automation) |
| `DB` | Direct MySQL assertions on state after an action |
| `JEST` | Existing server suites (`--testTimeout=60000`) |
| `VITEST` | Existing client unit suites |
| `CODE` | Static reading where runtime observation is impossible |

---

# BLOCK A — FOUNDATION & CROSS-CUTTING (P1–P5)

## P1 — Environment, build & health
**Methods:** API · DB · CODE
**Why first:** if the build or config is wrong, every later failure is unattributable.

- [ ] Server boots clean from `tsx` and from the **compiled `dist/`**; compare startup logs
- [ ] `npm run build` (server) + `npm run build` (client) both succeed; `tsc --noEmit` both 0 errors
- [ ] `dist/` parity: every `src/**.ts` has a `dist/**.js` and it is newer (`SCAN-M9`)
- [ ] `GET /health` · `/health/ready` (DB up **and** DB down) · `/health/version` · `/metrics`
- [ ] `/metrics` counters actually increment after traffic; format is valid Prometheus v0.0.4
- [ ] `ENCRYPTION_KEY` absent → warn + form submissions 503; malformed → hard no-boot
- [ ] Missing `ACCESS_TOKEN_SECRET` / `DB_PASSWORD` → what actually happens (`SCAN-M8`)
- [ ] `DB_TIMEZONE` set vs unset: driver + session agree; a written timestamp round-trips
- [ ] `DB_SOCKET_PATH` branch selects socket over host/port
- [ ] Graceful shutdown: SIGTERM closes SSE streams then the pool, exit 0
- [ ] `db:setup` on an empty DB → 41 tables / 5 views / **7 triggers**
- [ ] `db:setup` on a non-empty DB → refuses
- [ ] `db:setup:fresh` and `db:seed:demo` under `NODE_ENV=prod` → both refuse (`SCAN-B4`)

**Exit:** boot paths, health surface and provisioning behaviour are all characterised.

---

## P2 — API conventions & the error catalog
**Methods:** API · CODE

- [ ] Success envelope: single resource is bare; collections are `{data, pagination}`
- [ ] `pagination`: `next_cursor`, `has_more`, `total_estimate` — correct at page 1, mid, last, empty
- [ ] Cursor is a keyset on `internal_id`: no duplicates and no skips across page boundaries
- [ ] Tampered/garbage cursor → `pagination.invalid_cursor`
- [ ] `limit` bounds: 0, 1, max, max+1, negative, non-numeric
- [ ] Wire casing is snake_case everywhere; the documented camelCase exceptions
      (`/home/kpis`, `/postmortem`, `/me/permissions`, `/roles*`, `/spaces/:id/members`) hold
- [ ] Error envelope `{error:{code,message,request_id,details?}}` on 400/401/403/404/409/413/422/429/500
- [ ] `request_id` is present, unique per request, and matches the server log line
- [ ] `422` carries `details[]` with `field` + `issue`
- [ ] **All 143 error codes**: each is reachable or explicitly marked unreachable-by-design
- [ ] Malformed JSON body → 400 envelope (not an HTML stack)
- [ ] Body > 1 MB on a JSON route → 413 envelope
- [ ] Unknown route → 404 envelope; unknown method on a known route → 405/404 as designed
- [ ] Rate-limit buckets: auth 5/min, api 600/min, public-form 30/min, assistant 20/min,
      report-generate 10/min, upload-sign 60/min, invitation 5/min — each returns its documented code
- [ ] Rate-limit keying: two users on one IP get **separate** buckets
- [ ] Security headers present on success **and** on error responses
- [ ] CORS: allowed origin, LAN origin, disallowed origin, no-origin (curl)

**Exit:** the contract every other phase relies on is proven.

---

## P3 — Authentication
**Methods:** API · UI · DB · JEST

- [ ] Login: correct, wrong password, unknown email, inactive user, invited-not-accepted user
- [ ] Login response shape; `bb_refresh` cookie attributes (`httpOnly`, `sameSite=strict`, `path`, maxAge)
- [ ] Access token TTL 15 min; expired token → `auth.expired_token`
- [ ] Malformed / wrong-signature / `alg=none` / another user's token → `auth.invalid_token`
- [ ] `Bearer` scheme case-insensitivity; `Basic <jwt>` rejected; literal `"undefined"` rejected
- [ ] Refresh: valid, missing cookie, revoked session, expired session, tampered
- [ ] Refresh rotates the session; the old refresh token is dead afterwards
- [ ] Logout revokes one session; `logout-all` revokes every session for that user
- [ ] Change-password: correct, wrong current, same-as-old, weak new; sessions after change
- [ ] Forgot-password: existing email, unknown email (must **not** be an existence oracle), rate limit
- [ ] Reset: valid token, used token, expired token, tampered token
- [ ] Invitation: `GET /auth/invitation/:token` valid/expired/used/unknown; accept flow end-to-end
- [ ] `GET /auth/me` shape and freshness after a role change
- [ ] UI: reload keeps the session; logout clears store + query cache; a second tab follows
- [ ] Concurrent 401s trigger exactly **one** refresh (no thundering herd)
- [ ] A wrong-password 401 is surfaced as-is, never converted into a refresh attempt

**Exit:** every auth path characterised, including the deactivated-user token window.

---

## P4 — Legacy role authorization (owner / admin / member / guest)
**Methods:** API · DB

- [ ] Build the actual 4×N matrix by executing every guarded endpoint as each of the 4 roles
- [ ] Owner-only: `space.delete`, `list.delete`, hard delete, owner-role changes
- [ ] Admin can reach Settings > Roles but not owner-only deletes
- [ ] Guest: `attachment.upload` denied; the guest redaction paths in Tasks/Search/Home/Eng/CustomFields
- [ ] Guest redaction is consistent — no endpoint leaks a field another one hides
- [ ] Self-service rules: cannot change own role, cannot deactivate self, cannot demote the owner
- [ ] `role.last_admin` — the final admin cannot be removed/demoted
- [ ] Role change takes effect on the **next** token, and the ≤15-min stale window is characterised

**Exit:** the real (as-built) role matrix is documented, not the spec's.

---

## P5 — Dynamic RBAC (the 56-permission system)
**Methods:** API · UI · DB
**Note:** `SCAN-H1` says 25 permissions are unenforced. This phase **measures** exactly which, not re-argues it.

- [ ] `GET /me/permissions` for all 5 roles: shape, scopes, `visible_space_ids`, `version`, owner floor
- [ ] Permission keys are **not** camelized on the wire
- [ ] Roles CRUD: create, rename, update, delete; `role.key_taken`, `role.system_immutable`,
      `role.owner_immutable`, `role.unknown_permission`, `role.unsupported_scope`
- [ ] `role.escalation_blocked` — a role cannot grant more than its editor holds
- [ ] `PUT /roles/:id/permissions` replaces the whole grant set atomically
- [ ] Assign / revoke a role, workspace-scoped and space-scoped; `GET /roles/:id/holders`
- [ ] `GET /spaces/:id/members`
- [ ] **Enforcement probe — one test per permission, all 56.** For each: grant/revoke it, then call
      the endpoint it claims to govern. Record `ENFORCED` / `NOT ENFORCED`. Produces the definitive table.
- [ ] Scope behaviour: `all` vs `space` vs `own` vs `own_space` on every permission that offers them
- [ ] Visibility: `space.view=space` hides other spaces in Spaces/Lists/Tasks/Search/Home
- [ ] `own` escape hatch: a bug filed into another department stays visible to its reporter
- [ ] IDOR sweep: `marketing.only@` against ~20 known ids from other spaces (task, list, comment,
      attachment, checklist, custom field, form, sprint, report) → every one must 404
- [ ] Revocation is instant (`permissions_version` bump), not 15 minutes
- [ ] `is_private` on spaces/lists is decorative by design — confirm it changes nothing
- [ ] UI: `/settings/roles` grid, role creation, permission toggling, save, reload

**Exit:** a 56-row `ENFORCED / NOT ENFORCED` table with evidence per row.

---

# BLOCK B — CORE HIERARCHY (P6–P12)

## P6 — Workspace
**Methods:** API · UI
- [ ] `GET /workspace` shape · `PATCH /workspace` all settable fields
- [ ] Business-hours validation (`workspace.invalid_business_hours`), timezone, week start
- [ ] Settings changes are reflected where they are consumed (due dates, reports, KPIs)
- [ ] Permission gate `workspace.settings`
- [ ] UI `/settings/workspace`: load, save, validation errors, optimistic vs server state

## P7 — Users & members
**Methods:** API · UI · DB
- [ ] `GET /users` filters/pagination/sorting · `GET /users/:id` · cross-workspace 404
- [ ] Invite: new email, duplicate (`user.email_already_exists`), invalid, resend; **email actually sent**
- [ ] Accept invitation end-to-end → user becomes active with the intended role
- [ ] `PATCH /users/:id` self vs other (`user.forbidden_edit`), field-by-field
- [ ] Deactivate / reactivate: `user.cannot_deactivate_owner`, `cannot_self_deactivate`,
      `not_active`, `not_deactivated`; what happens to their assigned tasks
- [ ] Deactivated user's live token: the ≤15-min window — measure it
- [ ] Admin reset-password → user can log in with the new one
- [ ] `PATCH /users/:id/role` full matrix + `user.cannot_change_own_role`
- [ ] UI `/settings/members` + `/settings/profile`

## P8 — Spaces
**Methods:** API · UI · DB
- [ ] CRUD; `space.not_found`, cross-workspace isolation
- [ ] Archive / unarchive; `space.archived`, `space.not_archived`; archived spaces hidden from lists
- [ ] Delete: `space.not_empty`, `space.has_reports`
- [ ] `head_user_id`: set, clear, `space.head_invalid`, guest-as-head rejection
- [ ] `GET /spaces/:id/review-summary` and `/review-queue` for head / non-head / admin
- [ ] UI: sidebar space tree, create/rename/archive, deep link to an archived space

## P9 — Lists
**Methods:** API · UI · DB
- [ ] CRUD; per-space listing; workspace-wide `GET /lists`; `GET /lists/:id`
- [ ] Task-type binding + `list.invalid_task_type`
- [ ] Archive / unarchive / delete: `list.not_empty`, `list.archived`, `list.not_archived`
- [ ] `GET /lists/:listId/tasks` — filters, sorting, pagination, archived handling
- [ ] Deleting a list with tasks; moving a list between spaces if supported
- [ ] UI: create list modal, list page, breadcrumb, favourites

## P10 — Statuses
**Methods:** API · UI · DB
- [ ] Per-list listing; create; update; reorder (`PATCH /lists/:listId/statuses/reorder`)
- [ ] Status groups (`todo`/`in_progress`/`done`/`closed`) and `status.last_in_group`
- [ ] `status.duplicate`, `status.in_use` on delete
- [ ] Reorder with a partial id set, duplicate ids, foreign ids
- [ ] Default statuses on a newly created list
- [ ] UI `/settings/statuses` + inline status edit on a task

## P11 — Task types & Tags
**Methods:** API · UI
- [ ] Task types CRUD; `task_type.system` (immutable), `task_type.in_use`, `task_type.duplicate`
- [ ] `is_dev_type` gates the engineering fields on tasks
- [ ] Tags CRUD; `tag.duplicate`, `tag.not_found`; colours; tag in use on delete
- [ ] Permission gates `catalog.task_types` / `catalog.tags`
- [ ] UI `/settings/task-types` + `/settings/tags`

## P12 — Custom fields
**Methods:** API · UI · DB
- [ ] Definition CRUD for **every** field type; `custom_field.unsupported_type`
- [ ] Scope: workspace vs list (`custom_field.invalid_scope`); `GET /lists/:listId/custom-fields`
- [ ] Options for selection types: add, reorder, delete an in-use option
- [ ] `PUT /tasks/:id/custom-fields/:fieldId` per type: valid, wrong type, out-of-range, null
- [ ] `DELETE` a value; deleting a definition that has values
- [ ] The `config` and `custom_field_values` blobs survive the case-transform untouched
- [ ] Guest redaction of custom-field values
- [ ] UI: `/settings/custom-fields` + every field renderer on the task drawer

---

# BLOCK C — TASKS (P13–P20)

## P13 — Task creation
**Methods:** API · UI · DB
- [ ] Minimum valid payload; every optional field individually; all fields at once
- [ ] `custom_id` generation, uniqueness, `task.duplicate_custom_id`
- [ ] Validation: `task.invalid_status`, `invalid_task_type`, `invalid_assignee`, `invalid_tag`,
      `invalid_reviewer`, `invalid_date_range`, `invalid_parent`, `nesting_too_deep`
- [ ] Engineering fields on a dev-type list vs a non-dev list
- [ ] Recurrence fields are stored (`SCAN` note: no generator exists — log as GAP once)
- [ ] `POST /tasks/bulk`: all-valid, partial-invalid (atomic or partial?), empty, oversized
- [ ] Side effects on create: activity row, notifications, counters, `workspace_activity`
- [ ] UI: quick-create input, create-task modal, create from a board column

## P14 — Task reading
**Methods:** API · UI · DB
- [ ] `GET /tasks/:id` by internal id **and** by `custom_id`; collision precedence
- [ ] Cross-workspace and out-of-scope ids → 404, never an existence oracle
- [ ] `GET /lists/:listId/tasks`: every filter, every sort, pagination, archived, empty list
- [ ] `GET /tasks/my-work` buckets: today / overdue / next / unscheduled / done
- [ ] `GET /tasks/:id/subtasks`
- [ ] Serializer completeness: every documented field present and correctly typed
- [ ] Guest redaction on read paths
- [ ] UI: task drawer opens from list/board/calendar/search/inbox, deep link `/t/:taskKey`

## P15 — Task update
**Methods:** API · UI · DB
- [ ] `PATCH /tasks/:id` field by field — every writable field
- [ ] Partial-update semantics: omitted ≠ null; explicit null clears
- [ ] Rejected-in-PATCH fields (`patch.status_id`, `patch.assignee_add`, `patch.tag_add`)
- [ ] Optimistic concurrency: `If-Match` / `updated_at`, `task.conflict`
- [ ] Status transitions across groups; effect on `completed_at`, counters, parent rollup
- [ ] Date rules: start > due, due in the past, clearing dates, timezone boundaries at Dhaka midnight
- [ ] Priority, story points, reviewer, bug severity/environment/reproducibility
- [ ] `PATCH /tasks/:id/sla` (`sla.invalid_due_at`) — and confirm `SCAN-H2` behaviour
- [ ] Every update writes exactly one activity row with the right `context`
- [ ] UI: every inline editor (name, status, assignee, date, priority, tag, story points, reviewer)

## P16 — Task lifecycle & deletion
**Methods:** API · DB
- [ ] Archive → hidden from default lists, still reachable by id; unarchive restores
- [ ] Editing an archived task → `task.archived`
- [ ] `DELETE /tasks/:id` soft vs hard (`tasks.hard_deleted`, admin/owner gate)
- [ ] Cascades on delete: comments, checklists, attachments, custom-field values, dependencies,
      assignees, watchers, tags, activity, sprint membership, reviews
- [ ] Deleting a parent with children; deleting a task referenced by a dependency
- [ ] Counters on the parent after a child is deleted
- [ ] **UI gap check:** archive exists in the client, unarchive does not (`SCAN-L5`) — confirm

## P17 — Task membership (assignees · watchers · tags)
**Methods:** API · DB
- [ ] Add assignees: single, multiple, duplicate, unknown user, cross-workspace user, self
- [ ] Remove assignee: assigned, not-assigned (idempotent), unknown id
- [ ] Auto-watch on assign; watcher survives un-assign
- [ ] `POST/DELETE /tasks/:id/watchers/self` idempotency
- [ ] Add/remove tags; duplicate; unknown tag; tag from another workspace
- [ ] Notification on assign (`assigned`) — created for others, **never** for the actor
- [ ] **No email is sent on assign** — confirm and reference `SCAN-M2`
- [ ] `updated_at` bumps so the ETag stays honest
- [ ] Concurrency: two clients assigning the same user simultaneously

## P18 — Subtasks & dependencies
**Methods:** API · DB
- [ ] Create a subtask; nesting depth limit (`task.nesting_too_deep`)
- [ ] `subtasks_count` / `subtasks_completed` accuracy on: create, status change, delete, un-parent
- [ ] ⚠️ Expect `SCAN-H4` (stale trigger) to break status changes locally — record as environment
- [ ] Dependencies: create, list, delete; `dep.self`, `dep.duplicate`, `dep.cycle` (2-node and N-node)
- [ ] Cross-list and cross-space dependencies
- [ ] The two `no_self` DB triggers actually fire on INSERT and UPDATE
- [ ] Deleting a task that others depend on
- [ ] UI: subtasks section, dependencies section

## P19 — My Work, Home KPIs & Agenda
**Methods:** API · UI · DB
- [ ] `GET /home/kpis` — every tile's number recomputed by hand against the DB
- [ ] `GET /home/agenda` (orphan endpoint, `SCAN-L3`) vs what `AgendaCard` actually shows
- [ ] Bucket boundaries at Dhaka midnight; "today" for a user vs the workspace timezone
- [ ] KPI behaviour for a scoped user (`marketing.only@`) — must reflect only their spaces
- [ ] Guest redaction on Home
- [ ] UI: greeting, KPI row, My Work card, Agenda card, Lineup card, Recent activity card, empty states

## P20 — Task activity
**Methods:** API · DB
- [ ] `GET /tasks/:id/activity` pagination + ordering
- [ ] One row per action type, with correct actor and `context` payload
- [ ] Actor hydration; a deactivated/deleted actor
- [ ] Bulk operations do not spam duplicate rows
- [ ] `GET /activity/recent` and `GET /activity` (workspace feed) — scoping and shape
- [ ] UI: task activity section, Recent Activity card

---

# BLOCK D — COLLABORATION (P21–P25)

## P21 — Comments
**Methods:** API · UI · DB
- [ ] Create top-level; reply; `comment.reply_to_reply`; `comment.parent_not_found`
- [ ] Edit inside the 15-min window; after it (`comment.edit_window_expired`); by a non-author
      (`comment.not_author`)
- [ ] Delete: author, admin/owner (`comment.forbidden_delete`), soft-delete tombstone in the tree
- [ ] `@mention` resolution by email local-part and by first name; unmatched tokens; self-mention
- [ ] `#TASK-ID` cross-references; unknown ref; ref to another workspace
- [ ] Notifications: `mentioned` and `comment` to the right people, never the actor
- [ ] `comments_count` trigger accuracy on insert and delete
- [ ] Body limits, empty body, HTML/script in body (stored and rendered)
- [ ] UI: comment box, threading, edit, delete, mention autocomplete, rendered mentions

## P22 — Checklists
**Methods:** API · UI
- [ ] Checklist CRUD on a task; ordering
- [ ] Item add, bulk add, update, toggle, delete; `checklist_item.invalid_parent`
- [ ] Item assignee (`checklist_item.invalid_assignee`) and due date
- [ ] Progress rollup on the task
- [ ] Bulk add: empty array, very large array, mixed valid/invalid
- [ ] UI: checklists section, inline add, drag-reorder if present

## P23 — Attachments
**Methods:** API · DB · UI
- [ ] Proxied upload `POST /tasks/:id/attachments`: small, at 25 MB, over 25 MB (`attachment.too_large`),
      empty (`attachment.empty`), disallowed MIME (`attachment.mime_not_allowed`)
- [ ] `X-Filename` handling: unicode, spaces, path traversal (`../`), very long, missing
- [ ] Presign flow `POST /uploads/sign` → PUT → `POST /attachments/:id/finalize`
      (orphaned in the client — test the API anyway) + `attachment.upload_expired`
- [ ] `GET /attachments/:id/download` — signed URL, TTL, another user's attachment
- [ ] `DELETE /attachments/:id` — soft delete, `attachments_count` trigger, permission
- [ ] Guest cannot upload
- [ ] R2 reachability; behaviour when R2 is unreachable
- [ ] `deleted_at` stamping (`SCAN-H2` second site) — record the value written
- [ ] UI: attachments section, upload progress, download, delete, image preview

## P24 — Notifications
**Methods:** API · UI · DB
- [ ] Produce **every** producible type: `assigned`, `mentioned`, `comment`, `status_change`,
      `pr_review`, `incident_alert`, `form_submitted`, `automation_failed`, `task_reviewed`, `report_ready`
- [ ] Confirm `due_soon` / `overdue` cannot be produced (`SCAN-M3`) — one GAP entry, no re-investigation
- [ ] List + filters + pagination; `unread-count`; mark read / unread / mark-all-read
- [ ] Snooze: future time, past time, clearing; the `snooze-wake` job re-surfaces it
- [ ] Soft delete hides it from feed **and** count
- [ ] `notification.not_owner` — another user's notification id
- [ ] Preferences: read defaults, write partial, write all types
- [ ] **Confirm preferences change nothing** (`SCAN-M1`) — turn a type off, produce it, see it arrive
- [ ] UI: bell badge (60 s poll), inbox list, filters, snooze, mark-read, empty state

## P25 — Search
**Methods:** API · UI · DB
- [ ] Query across tasks, lists, spaces, comments, users — whatever the endpoint covers
- [ ] FULLTEXT ngram behaviour: 1-char, 2-char, Bangla text, mixed script, punctuation, emoji
- [ ] Empty query, whitespace-only, very long, SQL-ish and regex-ish input
- [ ] Result scoping for `marketing.only@` — nothing from other spaces
- [ ] Guest redaction in results
- [ ] Pagination + relevance ordering
- [ ] UI: `⌘K` palette, search page, highlight rendering, `&`-in-query edge (`SCAN-L6`)

---

# BLOCK E — SPECIALIZED MODULES (P26–P31)

## P26 — Forms
**Methods:** API · UI · DB
- [ ] Form CRUD; slug generation + `form.slug_taken`; per-list listing
- [ ] Field add / update / delete / reorder; `form_field.duplicate`, `not_in_form`, `not_found`
- [ ] Every field type renders and validates on the public page
- [ ] `GET /public/forms/:slug` unauthenticated — active, closed (`form.submission_closed`), unknown
- [ ] `POST /public/forms/:slug/submit`: valid, missing required, wrong types, extra keys
      (`form.invalid_field_key`), oversized, spam-rate (30/min)
- [ ] Submission creates the intended task with the intended field mapping
- [ ] PII encryption at rest — verify the DB column is ciphertext
- [ ] `ENCRYPTION_KEY` absent → `form.encryption_unavailable` 503
- [ ] `GET /forms/:id/submissions` — visibility, pagination, decryption on read
- [ ] `form_submission_expiry` job removes rows past retention
- [ ] `submission_count` trigger accuracy
- [ ] `form_submitted` notification
- [ ] UI: form builder, field editor, public form page, submit + confirmation, deep link works

## P27 — Templates
**Methods:** API · UI · DB
- [ ] CRUD; `template.duplicate`, `template.empty_structure`, `invalid_task_type`, `invalid_tag`
- [ ] `structure` blob survives the request-side case transform verbatim (`skipDecamelize`)
- [ ] `POST /templates/:id/apply`: to a list, with nested tasks, with checklists, with tags
- [ ] Apply into a list whose task types do not match
- [ ] Apply twice → duplicates or idempotent? Characterise
- [ ] Large structure (50+ tasks) — timing and atomicity
- [ ] UI `/settings/templates` + apply flow

## P28 — Sprints
**Methods:** API · UI · DB
- [ ] CRUD; `sprint.duplicate`, `sprint.not_found`
- [ ] Lifecycle: start, close, `sprint.another_active`, `sprint.invalid_status`
- [ ] `GET /sprints/active`; `v_active_sprint` view correctness
- [ ] Add / remove tasks; `sprint.task_not_in_sprint`; task from another space
- [ ] Story-point rollup; carry-over on close
- [ ] Permission `sprint.manage` vs `sprint.assign_tasks`
- [ ] UI: sprint board, drag between columns, WIP limits, swimlanes

## P29 — On-call & Engineering specials
**Methods:** API · UI · DB
- [ ] `GET /on-call/current` and `/schedule`; `v_current_on_call` view (CURDATE semantics)
- [ ] `PUT /on-call/:weekStart` — valid week, mid-week date, invalid engineer, overwrite
- [ ] `DELETE /on-call/:weekStart`; `on_call.not_found`
- [ ] `POST /eng/report-bug` from every role; resulting task shape and routing
- [ ] `GET /eng/home` tiles vs hand-computed DB values; guest redaction; `eng.not_configured`
- [ ] Postmortem: `incident.not_incident`, `incident.not_resolved`, create, read; the label-keyed
      `items` map is not case-transformed
- [ ] Stale-task detection (`NOW() - INTERVAL n DAY`) correctness
- [ ] UI: eng home, on-call rotation page (gated), report-bug button, postmortem checklist,
      git panel (manual fields only — no real integration)

## P30 — SLA
**Methods:** API · DB
- [ ] `GET /sla/breached`: filters `severity`, `team`, `team=engineering` dev-type alias
- [ ] `minutes_breached` correctness — expect the `SCAN-H2` 6-hour error; **measure**, do not fix
- [ ] `v_breached_sla` view vs the endpoint (they query differently)
- [ ] `PATCH /tasks/:id/sla` override; `sla.invalid_due_at`; archived task
- [ ] SLA recompute on `bug_severity` change overwrites a manual override (documented V1 behaviour)
- [ ] No UI exists (`SCAN-L4`) — confirm

## P31 — Department review & weekly HR reports
**Methods:** API · UI · DB
- [ ] `POST /tasks/:id/review` — approve, flag; `review.not_head`, `review.not_completed`,
      `review.forbidden`; admin/owner override
- [ ] `GET /tasks/:id/reviews` history
- [ ] Space review-summary and review-queue for head / other head / admin / member
- [ ] `POST /reports/generate` — a given week, current week, future week (`report.invalid_week`),
      re-generate (idempotent?)
- [ ] `GET /reports` list + `GET /reports/:id`; `report.forbidden` for a non-head
- [ ] `PATCH /reports/:id` head note; `POST /reports/:id/ack`
- [ ] Every report statistic recomputed by hand from the DB
- [ ] `department-report` job → Monday 09:00 Dhaka; `report_ready` notifications
- [ ] Report for a space with no head / no tasks / an archived space
- [ ] UI `/dept` (queue + summary) and `/reports` (list + detail); nav visibility per role

---

# BLOCK F — PLATFORM & UX (P32–P38)

## P32 — Background jobs
**Methods:** API · DB
- [ ] All 6 via `POST /jobs/*` with a valid `X-Internal-Token`
- [ ] Missing / wrong / empty token → 401; unset `INTERNAL_JOB_TOKEN` → still 401 (fails closed)
- [ ] `?dry_run=true` reports without mutating
- [ ] Idempotency: run each twice, second run is a no-op
- [ ] `session-cleanup`: expired sessions only; live sessions untouched
- [ ] `attachment-janitor`: stale pending only; complete rows untouched
- [ ] `r2-purge`: the 7-day window (note the `SCAN-H2` skew)
- [ ] `snooze-wake`: due snoozes only; not-yet-due untouched
- [ ] `form-submission-expiry`: retention boundary exactly
- [ ] `department-report`: week boundary, all spaces, notifications
- [ ] Failure path returns `200 {"ok":false}` so `run-job.sh` exits non-zero
- [ ] `run-job.sh` reads the token from `.env` and behaves correctly when the API is down

## P33 — AI Help Assistant
**Methods:** API · UI
- [ ] `POST /assistant/chat` SSE streaming; multi-turn via `X-Conversation-Id`
- [ ] `GET /assistant/conversations` + `/:id` (orphaned in the client — test the API)
- [ ] Answers in Bangla; no fabricated facts; every in-app link resolves to a real route
- [ ] Tool calls are JWT-scoped and read-only — a scoped user cannot read another space's data
- [ ] Prompt injection: instructions inside a task name/comment must not change behaviour
- [ ] `assistant.rate_limited` (20/min), `assistant.timeout`, `assistant.openai_error`,
      `assistant.upstream_error`, `assistant.empty_reply`
- [ ] Missing `OPENAI_API_KEY` → clean degradation
- [ ] `node server/scripts/assistant-eval.cjs --assert` passes
- [ ] `route-parity.test.ts` and `kb-coverage.test.ts` still green
- [ ] UI widget: open, stream, stop, history, markdown/link rendering, mobile

## P34 — Real-time, offline & session behaviour
**Methods:** UI · API
- [ ] SSE `/stream/inbox` from a raw client with a Bearer token (works) vs the browser (cannot) — `SCAN-M4`
- [ ] Bell 60 s poll actually refreshes
- [ ] Two browsers, same user: does action A in one show in the other, and how late
- [ ] Two users on the same task simultaneously — last-write-wins vs conflict
- [ ] Offline indicator; going offline mid-request; coming back
- [ ] React Query invalidation: after every mutation, is the right cache key busted
- [ ] Token expiry mid-session → silent refresh, no lost work
- [ ] Session revoked server-side → the UI notices and signs out cleanly

## P35 — Frontend views (List / Board / Calendar / Form)
**Methods:** UI
- [ ] **List view:** grouping, sorting, column config, inline edit, multi-select, bulk toolbar, empty
- [ ] **Board view:** columns from statuses, drag between columns, WIP limits, swimlanes, card fields
- [ ] **Calendar view:** month grid, event cards, unscheduled panel, drag to schedule, month nav
- [ ] **Form view:** rendering and submission
- [ ] View switching preserves filters; the `/:viewId` route param
- [ ] Large list (200+ tasks): scroll, virtualisation, perceived speed
- [ ] Drag-and-drop edge cases: drop on self, drop outside, cancel mid-drag, rapid drags

## P36 — Frontend shell, routing & UX states
**Methods:** UI
- [ ] Every one of the 39 routes loads for a permitted user
- [ ] Deep link + hard refresh on each (SPA fallback)
- [ ] Unknown route → currently redirects to Home, no 404 page (`SCAN-L2`)
- [ ] Route guards: `RequireAuth`, `RequireGuest`, `RequirePermission` (each gated route)
- [ ] Loading, error, and empty states on every page
- [ ] `ErrorBoundary` actually catches a thrown render error
- [ ] Sidebar: space tree, favourites (localStorage-only — device-local, log as a finding),
      collapse/expand, nav visibility per role (Engineering shown to all — `SCAN-M5`)
- [ ] Topbar, breadcrumb, user menu, command palette, quick-create
- [ ] Keyboard: `⌘K`, escape closes drawers/modals, tab order, focus trap
- [ ] Responsive: 1920 / 1440 / 1024 / 768 / 390 px
- [ ] Accessibility pass: labels, roles, contrast, screen-reader landmarks on the main flows
- [ ] Browser console is free of errors/warnings during a normal session

## P37 — Data integrity & concurrency
**Methods:** DB · API
- [ ] All 7 triggers fire correctly (and confirm the 3 extra dev ones — `SCAN-H4`)
- [ ] Every counter (`comments_count`, `attachments_count`, `subtasks_count`,
      `subtasks_completed`, `submission_count`) after every mutating path
- [ ] All 5 views return correct rows against hand-computed expectations
- [ ] FK cascades: delete a user, a space, a list, a task, a workspace — nothing orphaned
- [ ] Transaction atomicity: force a mid-transaction failure, confirm full rollback
- [ ] Concurrency: two simultaneous updates to one task; two assigns; two archives
- [ ] Unique constraints under a race (same `custom_id`, same slug, same tag name)
- [ ] Timezone: create a task at 23:59 and 00:01 Dhaka, verify bucket and report attribution
- [ ] Every `TIMESTAMP` round-trips through the API without drift
- [ ] Orphan sweep: run integrity queries across all 41 tables

## P38 — Security & abuse
**Methods:** API · UI · DB
- [ ] IDOR across **every** resource type using ids harvested as owner, replayed as `marketing.only@`
- [ ] Cross-workspace access with a hand-crafted JWT naming another workspace
- [ ] JWT tampering: `alg=none`, wrong signature, swapped `sub`, extended `exp`
- [ ] Stored XSS: `<script>`, `<img onerror>`, `javascript:` URLs into task name, description,
      comment, checklist item, tag, custom-field value, form submission — then view every render site
- [ ] SQL-ish and NoSQL-ish payloads into every filter/sort/search parameter
- [ ] Path traversal in filenames and slugs
- [ ] Mass assignment: send `role`, `workspace_id`, `id`, `created_by` in a PATCH body
- [ ] Rate-limit bypass attempts: header spoofing, `X-Forwarded-For`, casing, token rotation
- [ ] CORS from a hostile origin; credential inclusion
- [ ] Response headers on the API and on the SPA origin (`SCAN-M7`)
- [ ] Secrets: nothing sensitive in responses, logs, error messages, or the client bundle
- [ ] Password policy, hashing cost, timing on login for known vs unknown email
- [ ] Public form endpoints as an anonymous attacker: enumeration, spam, oversized payloads

---

# BLOCK G — WHOLE-SYSTEM (P39–P42)

## P39 — Realistic multi-user scenarios (BeautyBooth day-in-the-life)
**Methods:** UI · API
Run each department's real workflow end-to-end, as the real people would.

- [ ] **Customer Service:** complaint arrives via public form → task → assign → comment thread →
      attachment → escalate priority → resolve → head reviews
- [ ] **Orders & Fulfillment:** order issue → checklist → subtasks → dependency on Inventory →
      due today → complete
- [ ] **Product & Inventory:** restock task → recurring intent → custom fields → sprint-less flow
- [ ] **Marketing:** campaign task → template applied → multiple assignees → calendar scheduling
- [ ] **Social Media & Content:** content calendar → board view → status flow → attachments
- [ ] **Engineering:** bug reported via `/eng/report-bug` → sprint → branch/PR fields → SLA →
      incident → postmortem → on-call
- [ ] **Weekly management cycle:** Monday report generation → heads read → ack → notes
- [ ] **New hire:** invite → accept → first login → what they can and cannot see
- [ ] **Offboarding:** deactivate → their tasks, sessions, and notifications
- [ ] Two departments collaborating on one task (the cross-space `own` escape hatch)

## P40 — Performance & scale
**Methods:** API · DB
- [ ] Seed a realistic volume (5k tasks, 20k comments, 50k activity rows) into a scratch workspace
- [ ] Response times for list, search, home KPIs, reports, my-work at that volume
- [ ] N+1 detection: enable the general query log, count queries per endpoint
- [ ] `EXPLAIN` the 15 hottest queries; confirm index usage, no filesort/temp on the hot paths
- [ ] Pagination at depth (page 1 vs page 50)
- [ ] Connection-pool behaviour under 50 concurrent requests; queue limit
- [ ] Memory over a sustained run (pm2 restarts at 400 MB in prod)
- [ ] Client bundle size, initial paint, route-chunk sizes, largest component

## P41 — Production parity
**Methods:** CODE · API
- [ ] `NODE_ENV=prod` build served locally: cookie `secure`, HSTS, CORS list, no dev fallbacks
- [ ] The committed `client/dist` bundle: correct `BASE_URL`, no secrets, no dev-only code
- [ ] nginx config replayed locally: SPA fallback, `/api/v1` proxy, SSE location, body size,
      cache headers, `/metrics` unreachable from outside
- [ ] pm2 ecosystem: single instance, `TZ`, memory cap, log paths
- [ ] cron entries: UTC↔Dhaka conversion is right for all 6 jobs
- [ ] logrotate `copytruncate` behaviour
- [ ] `db:setup` on a fresh prod-shaped DB → exactly 41/5/7
- [ ] Follow `DEPLOY_READINESS_SCAN_2026-07-28.md` §6 runbook literally; log every step that is
      wrong or missing
- [ ] Prod env matrix: every variable `Config` reads is present and correct

## P42 — Regression sweep & consolidation
**Methods:** JEST · VITEST · UI

- [ ] Full server jest, per module, with `--testTimeout=60000` — record pass/fail per module
- [ ] Full client vitest
- [ ] All 12 Playwright e2e specs
- [ ] `assistant-eval.cjs --assert`
- [ ] Re-verify every issue logged in P1–P41 still reproduces (no phantom entries)
- [ ] De-duplicate `ISSUES.md`; assign final severities; group into fixing batches
- [ ] Produce `testing/TESTING_SUMMARY.md`: coverage achieved, gaps deliberately not covered,
      the issue counts by severity, and the recommended fixing-phase order
- [ ] Confirm every surface row in §3 is covered; list anything that is not, with the reason

---

# 12. TRACEABILITY — proving there is no gap

## 12.1 All 178 v1 endpoints → owning phase

| Router (endpoints) | Phase |
|---|---|
| `auth` (10) | **P3** |
| `me` (1) — `/me/permissions` | **P5** |
| `roles` (11) — roles CRUD, user roles, space members | **P5** |
| `workspace` (2) | **P6** |
| `users` (8) | **P7** |
| `spaces` (9) | **P8** (review-summary/queue also **P31**) |
| `lists` (9) | **P9** (`/lists/:listId/tasks` also **P14**) |
| `statuses` (5) | **P10** |
| `taskTypes` (4) · `tags` (4) | **P11** |
| `customFields` (7) | **P12** |
| `tasks` (18) | **P13** create/bulk · **P14** reads · **P15** patch · **P16** archive/delete · **P17** assignees/watchers/tags · **P31** review |
| `taskDependencies` (3) | **P18** |
| `home` (2) | **P19** |
| `workspaceActivity` (2) | **P20** |
| `comments` (4) | **P21** |
| `checklists` (9) | **P22** |
| `attachments` (6) | **P23** |
| `notifications` (9) | **P24** |
| `search` (1) | **P25** |
| `forms` (13) | **P26** |
| `templates` (6) | **P27** |
| `sprints` (10) | **P28** |
| `onCall` (4) · `engineering` (4) | **P29** |
| `sla` (2) | **P30** |
| `reports` (5) | **P31** |
| `jobs` (6) | **P32** |
| `assistant` (3) | **P33** |
| `sse` (1) | **P34** |
| `health` (3) + inline `/health` (1) | **P1** |

## 12.2 API_DESIGN.md sections → phase

§1 → P2 · §2 → P3 · §3 → P6 · §4 → P7 · §5 → P8 · §6 → P9 · §7 → P10 · §8 → P11 · §9 → P11 ·
§10 → P13–P16 · §11 → P17 · §12 → P18 · §13 → P20 · §14 → P21 · §15 → P22 · §16 → P23 ·
§17 → P12 · §18 → P26 · §19 → P24 · §20 → P28 · §21 → P29 · §22 → P29 · §23 → P27 · §24 → P25 ·
§25 → P19 · §26 → P20 · §27 → P34 · §28 → P32 · §29 → P30 · §30 → P1 · §31 → P38, P41 ·
§32 → P2 · §33 → P31 · Appendix B → P4, P5

## 12.3 Cross-cutting concerns covered in every phase

Even when a phase does not name them, each phase checks: **permission/role behaviour**,
**cross-workspace isolation**, **error-envelope correctness**, **activity/audit side effects**,
**counter accuracy**, and **the UI's behaviour for the same operation**.

---

# 13. PHASE BOARD

| # | Phase | Block | Est. | Status |
|---|---|---|---|---|
| P1 | Environment, build & health | A | M | PENDING |
| P2 | API conventions & error catalog | A | L | PENDING |
| P3 | Authentication | A | L | PENDING |
| P4 | Legacy role authorization | A | M | PENDING |
| P5 | Dynamic RBAC (56 permissions) | A | XL | PENDING |
| P6 | Workspace | B | S | PENDING |
| P7 | Users & members | B | M | PENDING |
| P8 | Spaces | B | M | PENDING |
| P9 | Lists | B | M | PENDING |
| P10 | Statuses | B | M | PENDING |
| P11 | Task types & tags | B | S | PENDING |
| P12 | Custom fields | B | L | PENDING |
| P13 | Task creation | C | L | PENDING |
| P14 | Task reading | C | L | PENDING |
| P15 | Task update | C | XL | PENDING |
| P16 | Task lifecycle & deletion | C | M | PENDING |
| P17 | Task membership | C | M | PENDING |
| P18 | Subtasks & dependencies | C | M | PENDING |
| P19 | My Work, Home KPIs & Agenda | C | M | PENDING |
| P20 | Task activity | C | S | PENDING |
| P21 | Comments | D | L | PENDING |
| P22 | Checklists | D | M | PENDING |
| P23 | Attachments | D | L | PENDING |
| P24 | Notifications | D | L | PENDING |
| P25 | Search | D | M | PENDING |
| P26 | Forms | E | XL | PENDING |
| P27 | Templates | E | M | PENDING |
| P28 | Sprints | E | M | PENDING |
| P29 | On-call & Engineering | E | L | PENDING |
| P30 | SLA | E | S | PENDING |
| P31 | Dept review & HR reports | E | L | PENDING |
| P32 | Background jobs | F | M | PENDING |
| P33 | AI assistant | F | L | PENDING |
| P34 | Real-time, offline & session | F | M | PENDING |
| P35 | Frontend views | F | XL | PENDING |
| P36 | Frontend shell, routing & UX | F | XL | PENDING |
| P37 | Data integrity & concurrency | F | L | PENDING |
| P38 | Security & abuse | F | XL | PENDING |
| P39 | Realistic multi-user scenarios | G | XL | PENDING |
| P40 | Performance & scale | G | L | PENDING |
| P41 | Production parity | G | M | PENDING |
| P42 | Regression sweep & consolidation | G | L | PENDING |

Size key: **S** ≈ under 30 checks · **M** ≈ 30–60 · **L** ≈ 60–100 · **XL** ≈ 100+

---

# 14. ORDERING RULES

- **P1 → P2 → P3 → P4 → P5 run first, in order.** Everything after depends on knowing the
  build, the contract, auth and authorization behave as expected.
- Blocks **B and C are strictly ordered** (spaces before lists before statuses before tasks) —
  each creates the fixture the next one needs.
- Blocks **D and E can be reordered** freely if a particular module is more urgent.
- **P42 runs last**, always.
- **P39–P41 should run after every module phase**, so the scenarios exercise known behaviour.

If a phase must be taken out of order, note it in `testing/STATUS.md` with the reason.

---

*This plan is frozen once testing starts. New checks discovered mid-run are appended to the
relevant phase's result file as "extra coverage", not edited into this document — so the plan
stays a stable reference for what was promised versus what was delivered.*
