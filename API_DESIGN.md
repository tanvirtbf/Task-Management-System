# BeautyBooth — API Design (v1)

Production-grade REST API specification. Every endpoint here maps **one-to-one** to a real call the React frontend already makes (`mockApi.X.Y()` in `client/src/lib/mock-api.ts`), plus the production-only endpoints the mock can't model (file upload signing, refresh-token rotation, SSE).

If a backend implementation matches the contract in this document, the frontend swap is `mockApi.X` → `realApi.X` only — no UI rewrite.

- **Base URL (prod):** `https://api.beautybooth.com`
- **Base URL (dev):**  `http://localhost:8000`
- **Version prefix:** `/api/v1`
- **Total endpoints:** ~140 grouped into 22 domains
- **Companion schema:** `database/schema.sql` (31 tables, 3NF)

---

## Table of contents

1. [Conventions](#1-conventions)
2. [Authentication](#2-authentication)
3. [Workspace](#3-workspace)
4. [Users & members](#4-users)
5. [Spaces](#5-spaces)
6. [Lists](#6-lists)
7. [Statuses](#7-statuses)
8. [Task types](#8-task-types)
9. [Tags](#9-tags)
10. [Tasks](#10-tasks)
11. [Task assignees · watchers · tags](#11-task-membership)
12. [Subtasks & dependencies](#12-subtasks-and-dependencies)
13. [Task activity](#13-task-activity)
14. [Comments](#14-comments)
15. [Checklists](#15-checklists)
16. [Attachments & file uploads](#16-attachments)
17. [Custom fields](#17-custom-fields)
18. [Forms (public + internal)](#18-forms)
19. [Notifications](#19-notifications)
20. [Sprints](#21-sprints)
21. [On-call rotation](#22-on-call)
22. [Engineering specials](#23-engineering-specials)
23. [Templates](#24-festival-campaigns)
24. [Search](#25-search)
25. [Home / KPIs](#26-home-kpis)
26. [Workspace activity](#27-workspace-activity)
27. [Server-Sent Events (real-time inbox)](#29-sse-realtime)
28. [Background jobs](#30-background-jobs)
29. [SLA management](#32-sla)
30. [Health & diagnostics](#33-health)
31. [Cross-cutting production essentials](#34-production)
32. [Error code catalog](#35-error-codes)

---

## 1. Conventions

### Request

| Header | Required | Notes |
|---|---|---|
| `Authorization` | yes (except `/auth/*`, `/public/*`) | `Bearer <access_token>` |
| `Content-Type` | yes for `POST/PATCH/PUT` | `application/json` (or `multipart/form-data` for binary upload) |
| `Accept-Language` | optional | `en` or `bn` — used for emails & error messages |
| `X-Request-Id` | optional | Echoed back. Server generates if absent. |
| `Idempotency-Key` | recommended for `POST` | UUID/ULID. Server caches response 24 h, returns cached body on retry. |
| `If-Match` | optional | ETag for optimistic concurrency on `PATCH` |

### Response — single resource

```json
{ "id": "t-90042", "name": "Pack order ORD-1042", ...  }
```

### Response — list (cursor pagination)

```json
{
  "data": [ /* … resources … */ ],
  "pagination": {
    "next_cursor": "eyJpZCI6OTAwMDB9",
    "has_more": true,
    "total_estimate": 1240
  }
}
```

`next_cursor` is opaque base64 — clients pass it back in `?cursor=…`. `total_estimate` is best-effort (may be `null` for very large sets).

> **F23 (ISS-012 / D10) — the four response families, documented.** The shipped
> API uses four collection shapes, and they are now DELIBERATE exceptions
> rather than drift:
>
> | shape | endpoints | why |
> |---|---|---|
> | `{data, pagination}` | `/spaces` `/lists` `/users` `/tags` `/task-types` `/templates` `/notifications` `/activity` `/reports` `/forms/:id/submissions` | the §1 default. Since F23 the first four honour `limit` + a real cursor (ISS-007) |
> | bare array | `/forms` `/sprints` `/sla/breached` | small, unpaginated sets; their own sections say so |
> | `{data}` | `/activity/recent` `/roles` | fixed-size reads (no pagination will ever apply) |
> | custom buckets | `/search` `/tasks/my-work` `/home/kpis` | shaped for their single consumer |
>
> D10 chose documenting over re-shaping: normalising the last three families
> would break the only existing client for zero functional gain. A malformed or
> foreign `cursor` is always `400 pagination.invalid_cursor` (ISS-008: strict
> round-trip decode, F23); an unknown query parameter on the main collection
> endpoints is `422 validation.failed` naming the parameter (ISS-014).

### Response — error

```json
{
  "error": {
    "code": "task.not_found",
    "message": "Task ORD-9999 does not exist.",
    "request_id": "req_01H2…",
    "details": [
      { "field": "due_date", "issue": "must be after start_date" }
    ]
  }
}
```

| HTTP | Use |
|---|---|
| 200 | OK — body returned |
| 201 | Created — body is the new resource |
| 204 | No content — successful delete / toggle |
| 400 | Malformed JSON / bad parameter |
| 401 | Missing/expired access token |
| 403 | Authenticated but not allowed |
| 404 | Resource doesn't exist |
| 409 | Conflict — concurrent edit (ETag mismatch), duplicate unique key |
| 422 | Validation failed — `details[]` lists field errors |
| 429 | Rate limit exceeded — `Retry-After` header set |
| 500 | Server bug — logged with `request_id` |
| 503 | Maintenance / downstream service down |

### Pagination defaults

| Endpoint family | Default limit | Max limit |
|---|---|---|
| Lists, spaces, users, tags | 100 | 200 |
| Tasks | 50 | 200 |
| Comments, attachments, activity | 50 | 100 |
| Notifications | 30 | 100 |
| Search | 20 | 50 |

Cursors are `internal_id` based (see `schema.sql`). Sort is always **stable**: primary key `internal_id` ASC unless documented otherwise.

### Rate limits

Bucketed per `user_id` (or per IP for `/auth/*` and `/public/*`).

| Bucket | Limit |
|---|---|
| `/auth/login`, `/auth/forgot-password` | 5 / minute / IP |
| `/api/v1/*` (authenticated) | 600 / minute / user |
| `/public/forms/:slug/submit` | 30 / minute / IP |
| `/uploads/sign` | 60 / minute / user |

Headers on every 200/4xx response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### Idempotency

`POST` endpoints that create resources (tasks, comments, attachments, …) accept `Idempotency-Key: <ulid>`. Server caches the **exact response body + status** for 24 h. A retry with the same key returns the cached response. Different body with same key → 409.

### Soft delete

`DELETE /tasks/:id` sets `archived_at`. The task disappears from list queries (`archived_at IS NULL` is the default filter) but the row + its comments/attachments are preserved. Pass `?include_archived=true` to surface them. True deletion is `DELETE /tasks/:id?hard=true` (admin only, audit-logged).

### Time

All timestamps are RFC3339 / ISO 8601 in UTC: `2026-05-28T09:12:00Z`. Dates without a time component use `YYYY-MM-DD`.

### Money

BDT amounts are integers in **paisa** (1/100 BDT). The frontend's `formatBdt()` divides by 100 for display. Wire format: `{ "amount": 117000, "currency": "BDT" }` → "৳1,170.00".

---

## 2. Authentication

### POST `/api/v1/auth/login`
**Public.** Validates email + password. Returns a short-lived access token + httpOnly refresh-token cookie.

**Body**
```json
{ "email": "owner@beautybooth.com", "password": "••••••••" }
```

**200 OK**
```json
{
  "access_token": "eyJhbGc…",
  "expires_in": 900,
  "user": { /* User */ }
}
```
Sets cookie `bb_refresh=<refresh_token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000`.

**Errors:** 401 `auth.invalid_credentials`, 429 `auth.rate_limited`, 422 `validation`.

---

### POST `/api/v1/auth/refresh`
**Public** (reads the `bb_refresh` cookie). Rotates the refresh token (old one revoked, new one issued).

**200 OK** — same shape as `/auth/login`. Cookie rotated.
**401:** `auth.invalid_refresh` (token reused, revoked, or expired → force re-login).

---

### POST `/api/v1/auth/logout`
**Authenticated.** Revokes the current refresh token. Access token continues to validate until it expires naturally (max 15 min).

**204 No Content.** Cookie cleared.

---

### POST `/api/v1/auth/logout-all`
**Authenticated.** Revokes every refresh token for the user (signs out all devices).

**204.**

---

### GET `/api/v1/auth/me`
Returns the current user.

**200 OK** — `User`.

---

### POST `/api/v1/auth/forgot-password`
**Public.** Always returns 202 regardless of whether the email exists (don't leak which emails are registered). Sends an email with a reset link if the account exists.

**Body** `{ "email": "…" }`
**202 Accepted** `{}`

---

### POST `/api/v1/auth/reset-password`
**Public.** Consumes a one-time reset token (delivered via email).

**Body** `{ "token": "…", "new_password": "min 8 chars" }`
**204.** All refresh tokens for the user are revoked.

---

### POST `/api/v1/auth/change-password`
**Authenticated.** User changes their own password (requires current password).

**Body** `{ "current_password": "…", "new_password": "…" }`
**204.** Other sessions revoked; current session keeps working.

---

### GET `/api/v1/auth/invitations/:token`
**Public.** Returns invitation details (email, role, inviter name, workspace name) so the accept page can render.

**200 OK** `{ "email", "role", "invited_by_name", "workspace_name", "expires_at" }`
**404:** `invitation.invalid_or_expired`.

---

### POST `/api/v1/auth/invitations/:token/accept`
**Public.** Accepts the invite, creates the user account, signs them in.

**Body** `{ "first_name": "…", "last_name": "…", "password": "…" }`
**201 Created** — same shape as `/auth/login`.

---

## 3. Workspace

### GET `/api/v1/workspace`
**200 OK** — `Workspace`.

### PATCH `/api/v1/workspace`
**Role required:** admin/owner.

**Body** — partial `Workspace` (name, logo_url, timezone, week_starts_on, working_days, business_hours_start/end).

> F28 (ISS-029, decision D12.2) dropped `fiscal_year_start_month` from the schema: it was stored,
> validated 1-12, and read by nothing, and this product has no financial-reporting surface. It is
> now an unknown key -- this endpoint picks known fields rather than rejecting unknown ones, so
> sending it is ignored rather than a 422. `working_days` and `business_hours_*` survived the
> same audit because they gained a real consumer in that phase: **they now decide when an SLA
> deadline falls** (see 29. SLA).

**200 OK** — updated `Workspace`.

---

## 4. Users

### GET `/api/v1/users`
Query params: `?status=active|invited|deactivated&role=admin|member|guest&q=<name|email>&cursor=…&limit=…`.

**200 OK** — paginated list of `User`.

### GET `/api/v1/users/:id`
**200 OK** — `User`. **404** if not found in your workspace.

### POST `/api/v1/users/invite`
**Role required:** admin/owner.

**Body** `{ "first_name", "last_name", "email", "role": "admin|member|guest" }`
**201 Created** — `User` (status `invited`). Server emails the invitation link.
**409** `user.email_already_exists`.

### PATCH `/api/v1/users/:id`
Updates profile fields. Users can edit themselves; admins can edit anyone in the workspace.

**Body** — partial `{ first_name?, last_name?, email?, timezone?, avatar_url? }`.
**200 OK** — updated `User`.

### PATCH `/api/v1/users/:id/role`
**Role required:** admin/owner. Owner cannot demote themselves.

**Body** `{ "role": "admin|member|guest" }`
**200 OK** — updated `User`.

### POST `/api/v1/users/:id/deactivate`
**Role required:** admin/owner. Sets `status = 'deactivated'`, revokes all refresh tokens. User's tasks/comments are kept; they cannot log in.

**204.**

### POST `/api/v1/users/:id/reactivate`
**Role required:** admin/owner.

**204.**

### POST `/api/v1/users/:id/reset-password`
**Role required:** admin/owner. Sends the user a password-reset email (same flow as forgot-password).

**202.**

---

## 5. Spaces

### GET `/api/v1/spaces`
**200 OK** — list of `Space` (excludes archived by default). `?include_archived=true` includes them.

### GET `/api/v1/spaces/:id`
**200 OK** — `Space`. **404** if not found.

### POST `/api/v1/spaces`
**Body** `{ "name", "description?", "icon", "color", "is_private?": false, "position?": 0 }`
**201 Created** — new `Space`.

### PATCH `/api/v1/spaces/:id`
**Body** partial — any of the create fields.
**200 OK** — updated `Space`.

### POST `/api/v1/spaces/:id/archive`
**204.** Sets `archived_at`. Cascades to its lists (also archived).

### POST `/api/v1/spaces/:id/unarchive`
**204.** Clears `archived_at`.

### DELETE `/api/v1/spaces/:id`
**Role required:** owner only. Hard delete with cascade. Audit-logged.
**204.**

---

## 6. Lists

### GET `/api/v1/spaces/:spaceId/lists`
**200 OK** — list of `List`.

### GET `/api/v1/lists`
Cross-space — list every list the user can see.
Query: `?space_id=...&include_archived=false&cursor=…`
**200 OK** — paginated.

### GET `/api/v1/lists/:id`
**200 OK** — `List`. **404** if not found.

### POST `/api/v1/lists`
**Body** `{ "space_id", "name", "icon?", "color?", "default_task_type_id?" }`
**201 Created** — `List`. Server seeds 5 default statuses (`To Do` / `In Progress` / `In Review` / `Done` / `Closed`).

### PATCH `/api/v1/lists/:id`
**Body** partial — `name`, `description`, `icon`, `color`, `default_task_type_id`, `space_id`.
**200 OK** — `List`.

**`space_id` MOVES the list to another space** (F28, ISS-036, decision D12.7). Before F28 a list was
permanently bound to the space that created it; the only way out was to build a replacement and
hand-move every task.

| case | response |
|---|---|
| target space unknown, or in another workspace | `404 space.not_found` |
| target space archived | `409 space.archived` |
| target space already has a list with this name | `409 list.duplicate` (F27's `uq_lists_space_name`; the check is case-insensitive and uses the INCOMING name when the patch also renames) |
| target space is the list's current space | `200`, no-op |

⚠️ **Reach in this product is space-scoped, so a move changes who can see the list's tasks.** That is
the feature, not a side effect — but it is worth saying out loud before someone moves a list.

`is_private` is deliberately **not** patchable on a list, and this is not an oversight:
`lists.is_private` is enforced nowhere (`server/src/rbac/scope.ts`), so a settable toggle would let a
user mark a list private while every member keeps seeing it. Narrow `space.view` is the real
mechanism. (`PATCH /spaces/:id` *does* accept `is_private` — the asymmetry is intentional.)

### POST `/api/v1/lists/:id/archive`
**204.**

### POST `/api/v1/lists/:id/unarchive`
**204.**

### DELETE `/api/v1/lists/:id`
**Role required:** admin/owner.
**204.**

---

## 7. Statuses

### GET `/api/v1/lists/:listId/statuses`
**200 OK** — array sorted by `position`.

### POST `/api/v1/lists/:listId/statuses`
**Body** `{ "name", "color", "status_group": "not_started|active|done|closed", "position?" }`
**201 Created** — `Status`.

### PATCH `/api/v1/statuses/:id`
**Body** partial.
**200 OK** — `Status`.

### DELETE `/api/v1/statuses/:id`
**409** if any task currently uses this status. Caller must move tasks first.

### PATCH `/api/v1/lists/:listId/statuses/reorder`
Bulk re-position.

**Body** `[ { "id": "s-1", "position": 0 }, { "id": "s-2", "position": 1 }, … ]`
**200 OK** — updated array.

---

## 8. Task types

### GET `/api/v1/task-types`
**200 OK** — workspace-wide list.

### POST `/api/v1/task-types`
**Body** `{ "name", "icon", "color", "is_milestone_type?": false, "is_dev_type?": false, "description?" }`
**201 Created.**

### PATCH `/api/v1/task-types/:id`
**Body** partial. `is_system` types: only `icon`, `color`, `description` are mutable.
**200 OK.**

### DELETE `/api/v1/task-types/:id`
**409** if any task currently uses this type or if `is_system=true`.

---

## 9. Tags

### GET `/api/v1/tags`
**200 OK** — workspace-wide.

### POST `/api/v1/tags`
**Body** `{ "name", "color" }`
**201 Created.**

### PATCH `/api/v1/tags/:id`
**200 OK.**

### DELETE `/api/v1/tags/:id`
Removes from all tasks. **204.**

---

## 10. Tasks

### GET `/api/v1/lists/:listId/tasks`
**The big one.** Powers List view, Board view, Calendar view.

Query params (all optional):
- `status=s-1,s-2` — filter by status IDs
- `status_group=not_started,active` — filter by 4-bucket grouping
- `assignee=u-001,u-002` — filter by assignees (any of)
- `reviewer=u-001` — filter by reviewer (engineering)
- `priority=1,2` — filter by priority
- `task_type=tt-bug,tt-feature` — filter by task type
- `tag=tag-001,tag-002` — filter by tag (any of)
- `sprint=spr-23` — sprint board filter
- `bug_severity=S0,S1` — engineering filter
- `q=word` — search in name + custom_id
- `due_before=2026-05-30` / `due_after=2026-05-28`
- `include_archived=false` (default)
- `include_subtasks=false` (default; when true, include rows with `parent_task_id != NULL`)
- `sort=position|due_date|created_at|updated_at|priority` (default: position within status)
- `sort_dir=asc|desc`
- `cursor=…&limit=50`

**200 OK** — paginated `Task[]` (fully hydrated with assignees, watchers, tags, custom_field_values inline).

---

### GET `/api/v1/tasks/:id`
Accepts either internal `id` (`t-90042`) or `custom_id` (`ORD-1042`).

**200 OK** — fully hydrated `Task`.

---

### GET `/api/v1/tasks/:id/subtasks`
**200 OK** — array of `Task` where `parent_task_id = :id`.

---

### POST `/api/v1/tasks`
**Body** — minimum `{ "primary_list_id", "name" }`. All other fields optional.
Special:
- If `parent_task_id` is provided, server enforces 2-level max nesting (`nesting_depth + 1 ≤ 2`).
- If `recurrence_pattern != 'none'`, server schedules a cron entry.
- `custom_id` auto-generated as `<list.prefix>-<task_number>` if not provided.
- For Bug task type, severity defaults to `S2` if omitted.
- **F29 (ISS-039) — the type decides which engineering fields it may carry**, checked on the
  RESOLVED type (explicit, list default, or fallback):
  - `story_points`, `reviewer_id`, `branch_name`, `pr_url`, `pr_status` need a type with
    `is_dev_type` → else `422 task.not_dev_type` (details list the offending fields);
  - `bug_severity` needs a **bug-named** type — the same name key §29's SLA switch uses, so
    severity and its SLA always travel together → else `422 task.severity_requires_bug_type`.
  - Explicit `null`s always pass (null is the columns' rest state; clearing junk is never blocked).
- **F29 (ISS-045)** — `pr_url` is validated as an **http(s) URL** (the `logo_url`/`avatar_url`
  rule); `javascript:` is a 422.

**201 Created** — full `Task`. `Idempotency-Key` strongly recommended.

---

### PATCH `/api/v1/tasks/:id`
**Body** partial. Server emits `task_activity` rows on status / assignee / sprint / pr_status changes.

If `If-Match: <etag>` is sent and doesn't match current `updated_at`, **409** `task.conflict`.

**F29 (ISS-039)** — the engineering-field gate applies to the type the task **will have** after the
patch: `{task_type_id: <dev>, branch_name}` in one request is fine; a git field patched onto a
non-dev task (or alongside a non-dev `task_type_id`) is `422 task.not_dev_type`; `bug_severity` off
a bug-named type is `422 task.severity_requires_bug_type`. **Re-typing RESHAPES the task:** moving
it onto a non-dev type clears the stored git/planning fields — and a stranded severity plus, when
the new type has no §29 SLA policy, its `sla_due_at` — in the same write, honouring the schema's
"NULL for non-dev task types" promise. `pr_url` is an http(s) URL here too (ISS-045).

**200 OK** — updated `Task`.

---

### POST `/api/v1/tasks/:id/archive`
**204.** Sets `archived_at`. Cascades to subtasks.

### POST `/api/v1/tasks/:id/unarchive`
**204.**

### DELETE `/api/v1/tasks/:id`
Soft by default. **204.**

### DELETE `/api/v1/tasks/:id?hard=true`
**Role required:** admin/owner. Cascades. Audit-logged.

---

### POST `/api/v1/tasks/bulk`
Bulk update — used by `BulkActionToolbar`.

**Body**
```json
{
  "ids": ["t-1", "t-2", "t-3"],
  "patch": { "status_id": "s-done", "assignee_add": ["u-1"], "tag_add": ["tag-x"] }
}
```
Supported patch keys: `status_id`, `priority`, `due_date`, `start_date`, `sprint_id`, `assignee_add[]`, `assignee_remove[]`, `tag_add[]`, `tag_remove[]`, `archived_at`.

**200 OK** `{ "updated": 3, "tasks": [ /* full Task[] */ ] }`

---

### GET `/api/v1/tasks/my-work`
Per-user dashboard data — used by `MyWorkCard` on Home.

Query: `?bucket=today|overdue|next|unscheduled|done`. If omitted returns all 5 buckets in one shot:

**200 OK**
```json
{
  "today":       [ /* Task[] */ ],
  "overdue":     [ /* Task[] */ ],
  "next":        [ /* Task[] */ ],
  "unscheduled": [ /* Task[] */ ],
  "done":        [ /* Task[] */ ]
}
```

---

## 11. Task assignees · watchers · tags <a id="11-task-membership"></a>

These are M2M endpoints — kept separate from `PATCH /tasks/:id` because they accept arrays and avoid sending the full Task.

### POST `/api/v1/tasks/:id/assignees`
**Body** `{ "user_id": "u-001" }` (or `{ "user_ids": [...] }` for bulk).
**204.**

### DELETE `/api/v1/tasks/:id/assignees/:userId`
**204.**

### POST `/api/v1/tasks/:id/watchers/self`
Current user starts watching. **204.**

### DELETE `/api/v1/tasks/:id/watchers/self`
Current user stops watching. **204.**

### POST `/api/v1/tasks/:id/tags`
**Body** `{ "tag_id": "tag-001" }` or `{ "tag_ids": [...] }`.
**204.**

### DELETE `/api/v1/tasks/:id/tags/:tagId`
**204.**

---

## 12. Subtasks and dependencies <a id="12-subtasks-and-dependencies"></a>

Subtasks are just `Task` rows with `parent_task_id != NULL` — covered by §10. Dependencies are explicit edges.

### GET `/api/v1/tasks/:id/dependencies`
Returns both directions in a single payload.

**200 OK**
```json
{
  "blocks":     [ { "id": "dep-1", "task": Task, "type": "blocks",     "created_at": "…" } ],
  "blocked_by": [ { "id": "dep-2", "task": Task, "type": "blocked_by", "created_at": "…" } ]
}
```

### POST `/api/v1/task-dependencies`
**Body** `{ "task_id": "t-1", "related_task_id": "t-2", "type": "blocks" }`
Server rejects with **422** `dep.cycle` if it would create a cycle.
**201 Created.**

### DELETE `/api/v1/task-dependencies/:id`
**204.**

---

## 13. Task activity <a id="13-task-activity"></a>

### GET `/api/v1/tasks/:id/activity`
Paginated, newest first.
**200 OK** — paginated `TaskActivity[]`.

`TaskActivity` shape:
```json
{
  "id": "act-001",
  "task_id": "t-90042",
  "actor": User | null,
  "action": "status_changed",
  "context": { "from": "s-confirmed", "to": "s-packed" },
  "created_at": "…"
}
```

Known `action` values: `created`, `status_changed`, `assignee_added`, `assignee_removed`, `priority_changed`, `due_date_changed`, `branch_created`, `pr_opened`, `pr_merged`, `comment_posted`, `completed`, `archived`, `deployed`, `rolled_back`.

---

## 14. Comments

### GET `/api/v1/tasks/:id/comments`
Returns top-level comments + their replies (1-level threading).
**200 OK** — `Comment[]` with `replies: Comment[]` inline.

### POST `/api/v1/tasks/:id/comments`
**Body** `{ "body": "string", "parent_comment_id?": "c-001" }`
Server parses `@username` and `#BUG-1042` tokens and fires notifications.
**201 Created** — `Comment`.

### PATCH `/api/v1/comments/:id`
Author only. Sets `edited_at`.
**Body** `{ "body": "…" }`
**200 OK.**

### DELETE `/api/v1/comments/:id`
Author or admin. Soft delete (tombstone) — preserves thread structure.
**204.**

---

## 15. Checklists

### GET `/api/v1/tasks/:id/checklists`
**200 OK** — array of `Checklist`, each with `items: ChecklistItem[]`.

### POST `/api/v1/tasks/:id/checklists`
**Body** `{ "name": "string" }`
**201 Created.**

### PATCH `/api/v1/checklists/:id`
**Body** `{ "name?": "…", "position?": n }`
**200 OK.**

### DELETE `/api/v1/checklists/:id`
**204.**

### POST `/api/v1/checklists/:id/items`
**Body** `{ "text", "assignee_id?", "parent_item_id?", "position?" }`
**201 Created** — `ChecklistItem`.

### POST `/api/v1/checklists/:id/items/bulk`
Bulk-create — for "one per line" textarea in the UI.
**Body** `{ "texts": ["item 1", "item 2", "item 3"] }` — **1–200 items** (F29 / ISS-068; was
unbounded — 5,000 items landed in one transaction and every later read of the task paid for it).
The same cap bounds a template's `structure.checklistItems`, the other entry point to this surface.
**201 Created** — array of `ChecklistItem`.

### PATCH `/api/v1/checklist-items/:id`
**Body** partial `{ text?, assignee_id?, position? }`
**200 OK.**

### POST `/api/v1/checklist-items/:id/toggle`
Flips `is_completed`. Records `completed_by` + `completed_at`.
**200 OK** — updated `ChecklistItem`.

### DELETE `/api/v1/checklist-items/:id`
**204.**

---

## 16. Attachments

### Upload flow (production — signed URLs to R2/S3)

```
┌──────────┐    POST /uploads/sign        ┌────────┐
│  Client  │ ───────────────────────────▶│ Server │
└──────────┘                              └────────┘
     │                                         │
     │  201 { url, fields, attachment_id }     │
     ◀─────────────────────────────────────────┘
     │
     │  POST <signed-url> multipart   ┌────────┐
     ├──────────────────────────────▶│ R2/S3  │
     │                                └────────┘
     │  204
     ◀────────────────────────────────────────────
     │
     │  POST /attachments/:id/finalize  ┌────────┐
     ├──────────────────────────────────▶│ Server │
     │                                   └────────┘
     │  200 { Attachment }
     ◀──────────────────────────────────
```

### POST `/api/v1/uploads/sign`
**Body**
```json
{
  "scope_type": "task",
  "scope_id": "t-90042",
  "filename": "damage-photo.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 1843200
}
```
Server validates: size ≤ 25 MB (configurable), mime in allow-list, user has write permission on scope.

**201 Created**
```json
{
  "attachment_id": "att-01H…",
  "upload_url": "https://r2.beautybooth.com/…",
  "fields": { "Content-Type": "image/jpeg", "key": "ws-main/att/01H….jpg", … },
  "expires_in": 900
}
```

The `attachment` row is created in pending state; if `/finalize` is never called within 1 h, a janitor job hard-deletes it.

---

### POST `/api/v1/attachments/:id/finalize`
Client calls this after the upload to R2 succeeds.
**Body** `{ "storage_key": "...", "thumbnail_key?": "..." }`
**200 OK** — full `Attachment`.

---

### GET `/api/v1/tasks/:id/attachments`
**200 OK** — `Attachment[]`.

### DELETE `/api/v1/attachments/:id`
Soft delete (sets `deleted_at`). Janitor job purges R2 objects 7 days later.
**204.**

### GET `/api/v1/attachments/:id/download`
Returns 302 to a fresh signed download URL (5 min validity). Used when the original `url` has expired.

---

## 17. Custom fields

### GET `/api/v1/custom-fields`
Optional query `?scope_type=workspace|space|list&scope_id=…`
**200 OK** — `CustomField[]` (options inline).

### GET `/api/v1/lists/:listId/custom-fields`
Returns workspace-scoped + space-scoped + list-scoped fields applicable to this list.
**200 OK.**

### POST `/api/v1/custom-fields`
**Body**
```json
{
  "scope_type": "list",
  "scope_id": "l-fb-orders",
  "name": "Tracking ID",
  "type": "text",
  "config": { "max_length": 60 },
  "is_required": false,
  "options": null
}
```
For `type: "dropdown"` pass `options: [{ "label": "Facebook", "color": "#1877F2", "position": 0 }, …]`.

**201 Created** — `CustomField`.

### PATCH `/api/v1/custom-fields/:id`
**Body** partial. Cannot change `type` (data integrity).
**200 OK.**

### DELETE `/api/v1/custom-fields/:id`
Cascades to all stored values. **204.**

### PUT `/api/v1/tasks/:id/custom-fields/:fieldId`
Set/replace a custom-field value on a task.

**F29 (ISS-043) — `phone` and `money` validate what their names promise:**
- `phone`: `config.default_country` **defaults to `"BD"`** (it used to default to nothing, so the
  BD regex never once fired and the field was free text). Under BD, the value must be a BD mobile —
  `01XXXXXXXXX`, `+880…` or `880…` spellings all pass, stored verbatim. A field opts out by
  configuring another country.
- `money`: `amount` must be a **non-negative** integer (a refund is its own record, not a negative
  order) and `currency` a real **ISO-4217** code — uppercase three letters, checked against ICU's
  list (`BDT`/`USD` pass; `NOTACURRENCY`, `XYZ`, `bdt` are 422s).

**Body** — the JSON envelope per `schema.sql §25`:
```json
// text/phone
{ "text": "01712345678" }
// money
{ "amount": 117000, "currency": "BDT" }
// date
{ "date": "2026-05-28", "include_time": false }
// dropdown
{ "option_id": "src_facebook" }
// files
{ "file_ids": ["att-001", "att-002"] }
```
**200 OK** — updated `Task`.

### DELETE `/api/v1/tasks/:id/custom-fields/:fieldId`
**204.**

---

## 18. Forms

### GET `/api/v1/forms`
**200 OK** — `Form[]`.

### GET `/api/v1/lists/:listId/forms`
**200 OK** — forms targeting this list.

### GET `/api/v1/forms/:id`
**200 OK** — `Form` with `fields: FormField[]`.

### POST `/api/v1/forms`
**Body** `{ "list_id", "title", "description?", "settings?", "branding?" }`
**201 Created.**

### PATCH `/api/v1/forms/:id`
**Body** partial. To replace fields, use the `fields` endpoints below.
**200 OK.**

### DELETE `/api/v1/forms/:id`
**204.**

### POST `/api/v1/forms/:id/fields`
**Body** `{ "field_kind": "task_attr|custom_field", "field_key": "name|description|<cf_id>", "label", "is_required?", "position?", "placeholder?", "help_text?", "default_value?" }`
**201 Created.**

### PATCH `/api/v1/form-fields/:id`
**200 OK.**

### DELETE `/api/v1/form-fields/:id`
**204.**

### PATCH `/api/v1/forms/:id/fields/reorder`
**Body** `[ { "id": "ff-1", "position": 0 }, … ]`
**200 OK.**

### GET `/api/v1/forms/:id/submissions`
**200 OK** — paginated `FormSubmission[]`.

---

### Public form endpoints (no auth)

#### GET `/api/v1/public/forms/:slug`
**200 OK** — public-safe view of `Form` (omits internal IDs, exposes `fields`, `branding`, `settings.successMessage`).

#### POST `/api/v1/public/forms/:slug/submit`
Open to anyone with the slug. Rate-limited per IP.

**Body** `{ "data": { "name": "…", "phone": "…", "cf_issue_type": { "option_id": "…" }, … } }`
**201 Created** `{ "submission_id": "…", "task_id": "t-…", "message": "Thank you" }`

---

## 19. Notifications

### GET `/api/v1/notifications`
Query: `?filter=all|unread|mentions|assigned&cursor=…&limit=…`
**200 OK** — paginated `Notification[]`.

### GET `/api/v1/notifications/unread-count`
**200 OK** `{ "count": 12 }`.

### POST `/api/v1/notifications/:id/read`
**204.**

### POST `/api/v1/notifications/:id/unread`
**204.**

### POST `/api/v1/notifications/mark-all-read`
**204.** Bumps `is_read=true` for every notification of the current user.

### POST `/api/v1/notifications/:id/snooze`
**Body** `{ "until": "2026-05-29T08:00:00Z" }` or `{ "hours": 2 }`
**200 OK** — updated `Notification`.

### DELETE `/api/v1/notifications/:id`
**204.**

### GET `/api/v1/notifications/preferences`
**200 OK** `{ "email": { "comment": true, "mention": true, "due_soon": false }, ... }`

### PUT `/api/v1/notifications/preferences`
**Body** — same shape.
**200 OK.**

---

## 20. Sprints

### GET `/api/v1/sprints`
Query: `?status=planned|active|closed`
**200 OK** — `Sprint[]`.

### GET `/api/v1/sprints/active`
**200 OK** — current active sprint, or 404 if none.

### GET `/api/v1/sprints/:id`
**200 OK** — `Sprint`.

### POST `/api/v1/sprints`
**Body** `{ "name", "goal?", "start_date", "end_date", "committed_points?" }`
**201 Created.**

### PATCH `/api/v1/sprints/:id`
**200 OK.**

### POST `/api/v1/sprints/:id/start`
Sets status → `active`. Only one sprint can be active at a time.
**200 OK.**

### POST `/api/v1/sprints/:id/close`
Sets status → `closed`. Unfinished tasks roll over to the next planned sprint if one exists (configurable).
**200 OK** `{ "rolled_over": 3 }`

### DELETE `/api/v1/sprints/:id`
**Role required:** `sprint.manage` (the same grant that creates and updates one).
Delete a sprint outright — there is no archive concept for a sprint.

**204.** · `404 sprint.not_found` · **`409 sprint.active_immutable`** when the sprint is `active`.

Added in F28 (ISS-013, decision D12.6): there was no way to remove a sprint at all, so one created
with wrong dates or a typo'd name was permanent and cleanup meant direct SQL.

**Its tasks are detached, never deleted** — `tasks.sprint_id` is `ON DELETE SET NULL`, so the blast
radius is the sprint row alone. An **active** sprint is refused so that one click cannot silently
un-sprint work the team is currently doing; close it or move it back to `planned` first.

### POST `/api/v1/sprints/:id/tasks`
Add task(s) to sprint.
**Body** `{ "task_ids": [...] }`
**204.**

### DELETE `/api/v1/sprints/:id/tasks/:taskId`
Remove a task from the sprint.
**204.**

---

## 21. On-call

### GET `/api/v1/on-call/current`
**200 OK** — current `OnCallShift` with `engineer: User`.

### GET `/api/v1/on-call/schedule`
Query: `?from=2026-05-01&to=2026-08-01`
**200 OK** — `OnCallShift[]`.

### PUT `/api/v1/on-call/:weekStart`
Set / overwrite the on-call engineer for a given week (Monday date).
**Body** `{ "engineer_id": "u-002" }`
**200 OK** — updated shift.

### DELETE `/api/v1/on-call/:weekStart`
Clear. **204.**

---

## 22. Engineering specials <a id="23-engineering-specials"></a>

### POST `/api/v1/eng/report-bug`
Cross-team bug intake (the "Report a bug" sidebar button). Creates a `Bug` task in Bug Triage with auto-routing to on-call for S0/S1.

**Body**
```json
{
  "steps": "1. open product page …",
  "happened": "Cart counter stays at 0",
  "expected": "Increments to 1",
  "severity": "S2",
  "reporter_team": "cs",
  "url": "https://shop.beautybooth.com/p/…",
  "screenshots": ["att-001"]
}
```
**201 Created** — `Task`.

### GET `/api/v1/eng/home`
Dashboard data for `/eng` page in one call.

**200 OK**
```json
{
  "open_bugs": { "count": 6, "top": [Task, ...] },
  "my_sprint_tasks": [Task, ...],
  "prs_awaiting_me":  [Task, ...],
  "open_incidents":   { "count": 2, "top": [Task, ...] },
  "stale_tickets":    [Task, ...],
  "current_on_call":  User,
  "active_sprint":    Sprint
}
```

### POST `/api/v1/eng/incidents/:id/postmortem`
Save postmortem checklist state.
**Body** `{ "items": { "Timeline reconstructed": true, … } }`
**200 OK.**

---

## 23. Templates

User-defined reusable task structures with pre-built checklists. Backed by the `templates` table (schema §32). Surfaced in two places:
- **Settings → Templates** — CRUD UI for managing the workspace's templates.
- **Space header → "Apply template" button** — picks a template + spawns a task.

Per FINAL_REQUIREMENTS.md §5.18 templates are workspace-wide and generic — any team can create their own. The `type` field is `task | list | space` (V1 ships only `task`; the other two are reserved for V2 list/space templating).

### GET `/api/v1/templates`
List the workspace's templates.

Query:
- `?type=task|list|space` — optional filter (default: all)
- `?q=…` — optional name search

**200 OK**
```json
{
  "data": [
    {
      "id": "tpl-eid-campaign",
      "workspace_id": "ws-main",
      "type": "task",
      "name": "Eid Campaign — 12-step playbook",
      "description": "Festival campaign with budget, creative, scheduling and post-launch review.",
      "icon": "Sparkles",
      "color": "#10B981",
      "structure": {
        "taskTypeId": "tt-campaign",
        "priority": 2,
        "tags": ["tag-eid"],
        "checklistName": "Eid Campaign 12-step playbook",
        "checklistItems": [
          { "text": "Confirm budget with owner", "dueOffsetDays": 0 },
          { "text": "Pick hero products (5-8)", "dueOffsetDays": 1 }
        ],
        "description": null
      },
      "usage_count": 8,
      "created_by": "u-001",
      "created_at": "2026-04-01T10:00:00Z",
      "updated_at": "2026-05-12T08:30:00Z"
    }
  ],
  "pagination": { "next_cursor": null, "has_more": false }
}
```

### GET `/api/v1/templates/:id`
**200 OK** — single `Template`. **404** if not found.

### POST `/api/v1/templates`
Create a new template.

**Body**
```json
{
  "type": "task",
  "name": "New Product Launch — 7-step pipeline",
  "description": "Source → Photo → Content → Price → Upload → FB Post → Live.",
  "icon": "Package",
  "color": "#8B5CF6",
  "structure": {
    "taskTypeId": "tt-product",
    "priority": 3,
    "tags": ["tag-new-arrival"],
    "checklistName": "Product launch checklist",
    "checklistItems": [
      { "text": "Source supplier + confirm cost", "dueOffsetDays": 0 },
      { "text": "Photo shoot", "dueOffsetDays": 2 },
      { "text": "Write content + description", "dueOffsetDays": 4 }
    ]
  }
}
```

Server validates:
- `name` unique per workspace (DB enforces via `uq_templates_workspace_name`)
- `type` is one of `task | list | space`
- `structure.taskTypeId` (if provided) exists in the workspace
- `structure.tags[]` (if provided) all exist in the workspace
- `structure.checklistItems` non-empty (at least 1 step)

**201 Created** — the created `Template`. **409** `template.duplicate` on name conflict.

### PATCH `/api/v1/templates/:id`
Update template metadata or structure. Partial body — only fields supplied are changed.

**Body** (any subset of)
```json
{
  "name": "…",
  "description": "…",
  "icon": "…",
  "color": "#RRGGBB",
  "structure": { /* full replacement of structure */ }
}
```

Note: `type` is immutable after creation (changing it would require re-validating against a different scope's rules). `usage_count` is read-only. Editing `structure` does **not** retroactively affect tasks that were already spawned from this template.

**200 OK** — the updated `Template`. **409** on name conflict.

### DELETE `/api/v1/templates/:id`
Hard delete (templates have no lifecycle worth preserving — if you need to keep a record, it's the spawned tasks themselves). Existing tasks spawned from this template are unaffected.

**204 No Content.**

### POST `/api/v1/templates/:id/apply`
"Apply template" — spawn a parent task with the template's checklist materialised.

**Body**
```json
{
  "list_id": "l-campaigns",
  "task_name": "Eid Campaign 2026",
  "anchor_date": "2026-05-15"
}
```

Fields:
- `list_id` (required) — the target list. List's `space_id` is used for any space-scoped validations (e.g., status workflow lookup).
- `task_name` (optional) — defaults to the template's `name`.
- `anchor_date` (optional, ISO date) — every checklist item's `dueOffsetDays` is computed relative to this. If omitted, `dueOffsetDays` is ignored (no item-level due dates).

Server-side effect (single transaction):
1. Insert a new row in `tasks` with `task_type_id`, `priority`, `tags` from the template's `structure`.
2. Insert a row in `checklists` with `name = structure.checklistName`.
3. Insert one row in `checklist_items` per `structure.checklistItems[]`, computing `due_date = anchor_date + dueOffsetDays` where set.
4. Increment `templates.usage_count`.
5. Append a `task_activity` row: `action = "created_from_template"`, `context = { templateId, templateName }`.

**201 Created**
```json
{
  "id": "t-90042",
  "task_number": 90042,
  "name": "Eid Campaign 2026",
  "primary_list_id": "l-campaigns",
  "task_type_id": "tt-campaign",
  "priority": 2,
  "tags": ["tag-eid"],
  "subtasks_count": 0,
  "checklists": [
    {
      "id": "ch-xxx",
      "name": "Eid Campaign 12-step playbook",
      "items": [ /* materialised ChecklistItem[] */ ]
    }
  ],
  "created_at": "2026-05-28T09:00:00Z"
}
```

**Error codes:**
- `404 template.not_found` — template id doesn't exist
- `404 list.not_found` — list_id invalid
- `422 template.empty_structure` — template has no checklist items

---

## 24. Search

### GET `/api/v1/search`
Global typeahead.
Query: `?q=…&types=task,list,space,note,comment,user&limit=20`

**200 OK**
```json
{
  "tasks":    [Task, ...],
  "lists":    [List, ...],
  "spaces":   [Space, ...],
  "comments": [Comment, ...],
  "users":    [User, ...],
  "total": 42
}
```

---

## 25. Home / KPIs <a id="26-home-kpis"></a>

### GET `/api/v1/home/kpis`
The 6 task-management KPI tiles on the home page.

**200 OK**
```json
{
  "my_tasks":         { "label", "value", "value_display", "trend", "trend_direction": "up|down|flat", "is_positive", "sparkline": [n,n,n,n,n,n,n] },
  "due_today":        { … },
  "overdue":          { … },
  "awaiting_review":  { … },
  "open_team_tasks":  { … },
  "sla_breaches":     { … }
}
```

### GET `/api/v1/home/agenda`
Calendar agenda for the day.
Query: `?date=2026-05-28`
**200 OK** — `Task[]`.

---

## 26. Workspace activity <a id="27-workspace-activity"></a>

### GET `/api/v1/activity/recent`
RecentActivityCard on Home expects to see both per-task events ("Rashida moved ORD-1024 to Delivered") and admin events ("Tanvir invited Karim"). Backend therefore returns a **UNION** of `task_activity` and `workspace_activity`, merged by `created_at DESC`. Each entry carries a `source` discriminator.

Query: `?limit=20`

**200 OK** — `{ data: RecentActivityEntry[] }` where:

> **F23 (ISS-012) — spec corrected to match the shipped contract.** This
> section used to promise a BARE array while the server has always returned
> `{ data: [...] }`; the shipped client reads `.data`. D10 chose
> documentation-only alignment — re-shaping working endpoints for symmetry
> would break the only client for zero functional gain. The response shapes
> across the API are now documented in §1 as four deliberate families:
> `{data, pagination}` (the §1 default), bare arrays (`/forms`, `/sprints`,
> `/sla/breached` — small unpaginated sets), `{data}` (`/activity/recent`,
> `/roles`), and custom buckets (`/search`, `/tasks/my-work`, `/home/kpis`).
```ts
type RecentActivityEntry = {
  id: string;
  source: "task" | "workspace";
  actor: User | null;
  entity_type: string;     // "task" when source=task; admin types when source=workspace
  entity_id: string;
  action: string;
  context: Record<string, unknown> | null;
  created_at: string;
};
```

Reference SQL (backend implementation):
```sql
(
  SELECT 'task' AS source, id, task_id AS entity_id, 'task' AS entity_type,
         actor_id, action, context, created_at
    FROM task_activity
   WHERE created_at > NOW() - INTERVAL 30 DAY
)
UNION ALL
(
  SELECT 'workspace' AS source, id, entity_id, entity_type,
         actor_id, action, context, created_at
    FROM workspace_activity
   WHERE created_at > NOW() - INTERVAL 30 DAY
)
ORDER BY created_at DESC
LIMIT 20;
```

### GET `/api/v1/activity`
Filtered, paginated.
Query: `?actor_id=…&entity_type=task,list&action=created,archived&from=…&to=…&cursor=…`
**200 OK** — paginated.

---

## 27. Server-Sent Events (real-time inbox) <a id="29-sse-realtime"></a>

### GET `/api/v1/stream/inbox`
**Authenticated.** As built the endpoint accepts the normal `Authorization: Bearer` header (the client streams it with `fetch` + a `ReadableStream`, not `EventSource`, precisely so the standard Bearer + refresh-once flow applies) or the `accessToken` cookie. There is no `?access_token=` query param — a token in a URL lands in access logs.

Three event types are emitted; each `notification` frame carries the §19 wire `Notification` and an `id:` line holding its `internal_id` (the resume token). Heartbeats deliberately carry no `id`, so they never move the cursor.

```
event: connected
data: { "now": "2026-08-08T09:12:00Z" }

event: notification
data: { "id":"ntfy-001","type":"assigned","entity_type":"task","entity_id":"t-90042","title":"You were assigned to …","is_read":false,"created_at":"…" }
id: 4412

event: heartbeat
data: { "now": "2026-08-08T09:12:30Z" }
```

A fresh connect goes LIVE (only notifications created after it opens); reconnecting with `Last-Event-ID` replays everything missed since that id, ascending. Heartbeat every 30 s keeps proxies from dropping the connection — `deploy/nginx` gives this exact path `proxy_buffering off` and a 1-hour read timeout. Cadence knobs: `SSE_POLL_MS` (3 s), `SSE_HEARTBEAT_MS` (30 s).

**Client (since 2026-08-08):** `hooks/useInboxStream.ts` holds one stream per signed-in app instance. Each frame invalidates the `["notifications", …]` query family — the bell badge and Inbox update in about a second instead of on the 60 s poll — and, when the tab is hidden and Web Push is NOT handling it, raises an OS notification with the same collapse `tag` the push payload uses, so one event can never produce two bubbles.

---

## 29c. Web Push (browser / desktop / phone notifications) <a id="29c-web-push"></a>

Level 2 of notification delivery: the operating system shows the notification even when the app tab is **closed**. Desktop Chrome/Edge/Firefox and Android work in a normal browser; iOS delivers only to a site the user installed via *Share → Add to Home Screen* (iOS 16.4+, Apple's rule). Requires a secure context — `https://` in production, `http://localhost` in development.

Delivery is server-side via VAPID (`web-push`). Producers are the same two the in-app `assigned` notification and the assignment email already have — task create with initial assignees, and `POST /tasks/:id/assignees` — plus the `overdue-alert` job. All three dispatch **after commit, fire-and-forget**: a push failure never fails the request or the job.

These routes are **authenticated and user-scoped only** (no RBAC permission, exactly like §19): a caller manages their own devices and nothing else.

### GET `/api/v1/push/public-key`
The VAPID `applicationServerKey` the browser subscribes with.
**200 OK** — `{ "public_key": "B…" }`
**503** `push.not_configured` — the server has no VAPID keypair; the feature is off and the client silently skips it.

### POST `/api/v1/push/subscriptions`
Register (or refresh) the calling browser. Body is verbatim `PushSubscription.toJSON()`:
```json
{ "endpoint": "https://fcm.googleapis.com/fcm/send/…",
  "keys": { "p256dh": "B…", "auth": "…" } }
```
**204 No Content.** Idempotent — the same endpoint upserts. A device that re-subscribes under a **different** user (shared computer) is REASSIGNED, so it always delivers to whoever is signed in.
**422** `validation.failed` — the endpoint must be an `https://` URL ≤1000 chars and both keys base64url.

### DELETE `/api/v1/push/subscriptions`
Drop this browser's subscription (sign-out / opt-out). Body `{ "endpoint": "…" }`.
**204 No Content.** Idempotent and scoped to the caller — an unknown endpoint is a silent no-op, never an existence oracle.

**Lifecycle:** rows live in `push_subscriptions` (`database/upgrades/015`), keyed by `SHA-256(endpoint)`. `PushService` deletes a row the moment the push service answers **404/410** (the browser revoked or expired it), so dead devices never accumulate. Payload shape: `{ title, body, url, tag }` — `url` is the SPA path the service worker opens on click, `tag` the collapse key shared with the Level 1 in-tab path.

---

## 28. Background jobs <a id="30-background-jobs"></a>

Internal — invoked by cron, not by clients. Documented for ops visibility.

The SEVEN built jobs (cron cadences per `deploy/cron/bbtasks-jobs`):

| Endpoint | Schedule | What it does |
|---|---|---|
| `POST /jobs/snooze-wake` | every 5 min | Marks snoozed notifications back as unread when their snooze elapses |
| `POST /jobs/overdue-alert` | every 10 min | The moment a task's `due_date` has passed on the WORKSPACE's calendar (`workspaces.timezone` decides "today"), every assignee gets an `overdue` in-app notification + an email. Exactly once per task per deadline: `tasks.overdue_notified_at` is claimed in the same tx as the fanout, and any `due_date` change re-arms it. Tasks with no assignees stay unclaimed so a late assignee still alerts on the next tick |
| `POST /jobs/session-cleanup` | daily 02:10 UTC | Hard-deletes `sessions` past `expires_at + 30 d`, and revoked ones past 7 d (F10) |
| `POST /jobs/attachment-janitor` | daily 02:20 UTC | Hard-deletes attachments whose upload never finalised after 1 h (R2 object first) |
| `POST /jobs/r2-purge` | daily 02:30 UTC | Hard-deletes R2 objects soft-deleted > 7 days ago + drains `r2_purge_queue` (F16) |
| `POST /jobs/form-submission-expiry` | daily 02:40 UTC | Hard-deletes form submissions past their 90-day PII retention (`expires_at`) |
| `POST /jobs/department-report` | Mon 09:00 Dhaka | Weekly per-department HR report + exactly-once `report_ready` fanout; one-week self-heal |

All jobs accept a `?dry_run=true` query to log what they would do without writing (truthy/falsy forms per F14; a bare `?dry_run` means true). Guarded by an `X-Internal-Token` header so they can be triggered from cron but not from the public internet. A failed job still answers `200 { ok:false, error }` — cron branches on the body (`deploy/cron/run-job.sh` exits 1 on it).

> Spec-era jobs still unbuilt (deferred features, not bugs): `recurrence-spawn`
> (recurring-task instances) and `email-digest` (daily summary mail).
> `sla-breach-scan` in its spec form is superseded: due-date overdue alerting is
> `overdue-alert` above; `sla_due_at` breaches surface in `GET /sla/breached` + `/sla` UI.

---

## 29. SLA management <a id="32-sla"></a>

Wraps `tasks.sla_due_at` + the `v_breached_sla` view.

### GET `/api/v1/sla/breached`
Tasks past their SLA window that aren't done. Powers red flags in the CS UI and the eng on-call paging job.

Query: `?team=cs|engineering&severity=S0,S1`
**200 OK** — `[{ task_id, custom_id, name, task_type_id, sla_due_at, minutes_breached, assignees: User[] }, …]`

### PATCH `/api/v1/tasks/:id/sla`
Set or clear the SLA on a task. Admins can override system-set SLAs (e.g., escalating a complaint).

**Body**
```json
{ "sla_due_at": "2026-05-29T12:00:00Z" }
// OR clear:
{ "sla_due_at": null }
```
**200 OK** — updated `Task`.

### Implicit SLA assignment

The application layer sets `sla_due_at` at task-create time based on a hardcoded policy (env-overridable):

| Task type / condition | SLA |
|---|---|
| Complaint task created | created_at + 24h |
| Bug task, severity = S0 | created_at + 2h |
| Bug task, severity = S1 | created_at + 24h |
| Bug task, severity = S2 | created_at + 7d |
| Bug task, severity = S3 | no SLA (NULL) |
| All other task types | no SLA (NULL) |

Updating `bug_severity` after creation triggers a recompute of `sla_due_at` unless the field was manually overridden.

---

## 30. Health & diagnostics <a id="33-health"></a>

Production-essential endpoints — **not authenticated** but only reachable from internal network or behind reverse-proxy ACL.

### GET `/health`
Cheap liveness probe — no DB hit. Always returns 200 if the process is up. Used by Kubernetes `livenessProbe`.

**200 OK** `{ "status": "ok", "service": "beautybooth-api", "version": "1.0.0", "uptime_seconds": 12345 }`

### GET `/health/ready`
Readiness probe — checks downstream dependencies. Used by Kubernetes `readinessProbe`.
**200 OK**
```json
{
  "status": "ready",
  "checks": {
    "mysql":  { "ok": true, "latency_ms": 4 },
    "r2":     { "ok": true, "latency_ms": 38 },
    "smtp":   { "ok": true, "latency_ms": 120 },
    "redis":  { "ok": true, "latency_ms": 1 }
  }
}
```
**503** if any check fails — load balancer pulls instance from rotation.

### GET `/health/version`
Build info for debugging.
**200 OK** `{ "version": "1.4.2", "build_sha": "a1b2c3d", "built_at": "2026-05-28T07:00:00Z", "node_version": "20.10.0" }`

### GET `/metrics`
Prometheus exposition format. Gated by `X-Internal-Token` header.

```
# HELP http_requests_total Number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/tasks",status="200"} 12345
http_request_duration_seconds_bucket{le="0.1"} 12000
mysql_pool_connections_in_use 4
mysql_pool_connections_max 20
sse_connections_open 23
background_job_runs_total{job="sla-breach-scan",status="success"} 192
```

Recommended metrics:
- `http_requests_total{method,route,status}` — counter
- `http_request_duration_seconds_bucket` — histogram
- `mysql_pool_connections_in_use` — gauge
- `redis_pool_connections_in_use` — gauge
- `sse_connections_open` — gauge
- `background_job_runs_total{job,status}` — counter
- `background_job_duration_seconds_bucket{job}` — histogram

---

## 31. Cross-cutting production essentials <a id="34-production"></a>

The backend implementer needs zero decisions on these — this section is the contract.

### 34.1 Global error handler

**Every** request goes through a single error-handler middleware that:
1. Generates a `request_id` (ULID) if the request didn't carry `X-Request-Id`.
2. Maps the thrown error to the standard envelope (§1 Response — error).
3. Logs structured JSON to stdout with the request_id, route, user_id, error code, stack trace.
4. Strips stack traces from the response body in production; includes them only when `NODE_ENV !== 'production'`.

Example (Express + Zod, single source of truth for all 4xx/5xx):

```ts
import { ZodError } from "zod";
import { ULID } from "ulid";

// Domain error class — every business error throws this
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) { super(message); }
}

// Single error middleware — registered LAST
export function errorMiddleware(err, req, res, next) {
  const requestId = req.header("X-Request-Id") ?? ULID();
  res.setHeader("X-Request-Id", requestId);

  if (err instanceof ZodError) {
    const details = err.issues.map(i => ({ field: i.path.join("."), issue: i.message }));
    logger.warn({ requestId, code: "validation", path: req.path, details });
    return res.status(422).json({
      error: { code: "validation", message: "Validation failed", request_id: requestId, details }
    });
  }

  if (err instanceof AppError) {
    logger.warn({ requestId, code: err.code, status: err.status, path: req.path, user_id: req.user?.id });
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, request_id: requestId, details: err.details }
    });
  }

  // Unhandled — log full stack, return generic 500
  logger.error({ requestId, path: req.path, user_id: req.user?.id, err });
  res.status(500).json({
    error: { code: "internal", message: "An unexpected error occurred.", request_id: requestId }
  });
}
```

Domain code throws `AppError` (never bare `throw new Error()`):
```ts
if (!task) throw new AppError("task.not_found", 404, `Task ${id} does not exist`);
if (task.archived_at) throw new AppError("task.archived", 409, "Cannot edit archived task");
```

### 34.2 CORS

Configured via env. Defaults shipped:

```
Allowed origins:
  prod    https://app.beautybooth.com
  staging https://staging.beautybooth.com
  dev     http://localhost:5173 + http://localhost:5174 + http://localhost:5177

Allowed methods:    GET, POST, PATCH, PUT, DELETE, OPTIONS
Allowed headers:    Authorization, Content-Type, Idempotency-Key, X-Request-Id, If-Match, Accept-Language
Exposed headers:    X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, ETag
Credentials:        true             (refresh-token cookie requires this)
Max-Age:            86400            (preflight cache 1 day)
```

`/public/*` uses **looser CORS** (allow any origin) since public forms may be embedded on external intake pages.

### 34.3 Security headers

Set globally on every response (use `helmet` for Express or equivalent):

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Force HTTPS for 1 year |
| `X-Content-Type-Options` | `nosniff` | Block MIME sniffing |
| `X-Frame-Options` | `DENY` | No clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak full URL to 3rd parties |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Lock down powerful APIs |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' https://*.r2.cloudflarestorage.com data:; …` | XSS defense — set on frontend HTML, mirrored here for JSON-only mistakes |
| `Cross-Origin-Resource-Policy` | `same-site` | Block cross-origin embeds |

JSON responses additionally set `Content-Type: application/json; charset=utf-8`.

### 34.4 Request size limits

| Endpoint family | Body max | On exceed |
|---|---|---|
| `/api/v1/*` JSON | 1 MB | 413 `payload.too_large` |
| `/api/v1/uploads/sign` (metadata) | 4 KB | 413 |
| `/api/v1/public/forms/:slug/submit` | 64 KB | 413 |
| Multipart upload to R2 | 25 MB | enforced by signed-URL policy (server doesn't proxy bytes) |

### 34.5 Database connection pool

Default config (env-overridable):

```
mysql2 pool:
  connectionLimit:      20
  queueLimit:            50
  enableKeepAlive:       true
  keepAliveInitialDelay: 30000
  acquireTimeout:        10000
  connectTimeout:        10000
  decimalNumbers:        true       # money is paisa, but BIGINT can lose precision in JS
  bigNumberStrings:      true       # internal_id BIGINT → string
  timezone:              "+00:00"   # always UTC
```

At startup, run a `SELECT 1` ping on each pool connection. Fail fast if MySQL isn't reachable.

### 34.6 Structured logging

All logs are **single-line JSON** to stdout (containers / k8s `kubectl logs` ready).

Required fields per log line:
```json
{
  "ts": "2026-05-28T09:12:00.123Z",
  "level": "info | warn | error | debug",
  "request_id": "01H…",
  "user_id": "u-001" | null,
  "method": "POST",
  "route": "/api/v1/tasks",
  "status": 201,
  "duration_ms": 47,
  "msg": "task.created",
  "task_id": "t-90042"
}
```

For 5xx errors include `stack` (only in dev; redacted in prod). Use `pino` (Node) or `bunyan`. Aggregator: Loki / CloudWatch / Datadog.

Log levels:
- `error` — 5xx, unhandled exceptions, downstream failures
- `warn` — 4xx (validation, conflict), rate-limit hits, slow queries (> 500 ms)
- `info` — every successful request (one line), background-job runs
- `debug` — query plans, cache hits/misses (off in prod)

### 34.7 Rate limiting backend

Use **Redis** (`INCR` + `EXPIRE`) for distributed rate limits (per `(user_id, bucket)` or `(ip, bucket)`).

```
KEY:  rl:{bucket}:{user_id_or_ip}
TTL:  60 seconds
```

If Redis is down, fail **open** (allow request) and emit a warn-level log — the limiter is a safety net, not the security perimeter.

### 34.8 OpenAPI generation

Recommend:
- **Zod schemas** for request/response validation
- **zod-to-openapi** to generate the OpenAPI 3.1 spec at build time
- Serve at `GET /api/v1/openapi.json` (no auth — public schema)
- Serve Swagger UI at `GET /api/v1/docs` — gated by admin auth in prod

Frontend can codegen types from the OpenAPI spec via `openapi-typescript`. Keep `client/src/types/` and `server/src/types/` in sync this way.

### 34.9 Caching (Redis recommended)

Use Redis for:
1. **Rate limit counters** (see 34.7)
2. **Refresh-token revocation list** (24-h TTL — same as access-token lifetime)
3. **Idempotency-Key response cache** (24-h TTL per §1)
4. **KPI snapshots** (5-min TTL for `/home/kpis` — these are expensive aggregations)
5. **Session lookup** (active session validation cache)

Cache keys are prefixed: `rl:`, `idem:`, `kpi:`, `sess:`. Use Redis 7+.

### 34.10 Maintenance mode

Single env flag `MAINTENANCE_MODE=on` causes every non-`/health/*` route to return:
```
503 Service Unavailable
Retry-After: 300
{ "error": { "code": "maintenance", "message": "Scheduled maintenance — back shortly." } }
```

---

## 32. Error code catalog <a id="35-error-codes"></a>

Stable string codes — the frontend can switch on these. Format: `<domain>.<reason>`
(a handful of infrastructure codes are bare).

> **F23 (ISS-010) — regenerated from the code, 2026-08-06.** The hand-written
> table below this note documented 37 codes while the server threw 140: a
> client written against it met over a hundred codes it had never heard of, and
> 7 documented codes were never thrown at all (several of those — `tag.in_use`,
> `task.cannot_complete_blocked`, `sprint.overlap`, `role.last_admin` on the
> legacy path — became REAL in F22). The complete list is now generated by
> `fixing/evidence/F23/regen-catalog.cjs` scanning every `AppError` call in
> `server/src`; re-run it after adding codes. The curated table of the most
> load-bearing codes (with meanings) follows the generated list.

### The complete set (generated)

**`(bare).*`** — 2 code(s)

| Code |
|---|
| `internal` |
| `not_found` |

**`assignment.*`** — 1 code(s)

| Code |
|---|
| `assignment.not_found` |

**`attachment.*`** — 3 code(s)

| Code |
|---|
| `attachment.empty` |
| `attachment.not_found` |
| `attachment.scope_unsupported` |

**`auth.*`** — 10 code(s)

| Code |
|---|
| `auth.expired_token` |
| `auth.forbidden` |
| `auth.incorrect_password` |
| `auth.invalid_credentials` |
| `auth.invalid_refresh` |
| `auth.invalid_token` |
| `auth.missing_token` |
| `auth.password_unchanged` |
| `auth.rate_limited` |
| `auth.reset_token_invalid` |

**`checklist.*`** — 1 code(s)

| Code |
|---|
| `checklist.not_found` |

**`checklist_item.*`** — 3 code(s)

| Code |
|---|
| `checklist_item.invalid_assignee` |
| `checklist_item.invalid_parent` |
| `checklist_item.not_found` |

**`comment.*`** — 6 code(s)

| Code |
|---|
| `comment.edit_window_expired` |
| `comment.forbidden_delete` |
| `comment.not_author` |
| `comment.not_found` |
| `comment.parent_not_found` |
| `comment.reply_to_reply` |

**`conversation.*`** — 1 code(s)

| Code |
|---|
| `conversation.not_found` |

**`custom_field.*`** — 3 code(s)

| Code |
|---|
| `custom_field.invalid_scope` |
| `custom_field.not_found` |
| `custom_field.unsupported_type` |

**`dep.*`** — 4 code(s)

| Code |
|---|
| `dep.cycle` |
| `dep.duplicate` |
| `dep.not_found` |
| `dep.self` |

**`eng.*`** — 1 code(s)

| Code |
|---|
| `eng.not_configured` |

**`form.*`** — 4 code(s)

| Code |
|---|
| `form.invalid_field_key` |
| `form.not_found` |
| `form.slug_taken` |
| `form.submission_closed` |

**`form_field.*`** — 3 code(s)

| Code |
|---|
| `form_field.duplicate` |
| `form_field.not_found` |
| `form_field.not_in_form` |

**`incident.*`** — 2 code(s)

| Code |
|---|
| `incident.not_incident` |
| `incident.not_resolved` |

**`invitation.*`** — 2 code(s)

| Code |
|---|
| `invitation.already_accepted` |
| `invitation.not_found` |

**`list.*`** — 6 code(s)

| Code |
|---|
| `list.archived` |
| `list.duplicate` |
| `list.invalid_task_type` |
| `list.not_archived` |
| `list.not_empty` |
| `list.not_found` |

**`notification.*`** — 2 code(s)

| Code |
|---|
| `notification.not_found` |
| `notification.not_owner` |

**`on_call.*`** — 2 code(s)

| Code |
|---|
| `on_call.invalid_engineer` |
| `on_call.not_found` |

**`pagination.*`** — 1 code(s)

| Code |
|---|
| `pagination.invalid_cursor` |

**`report.*`** — 3 code(s)

| Code |
|---|
| `report.forbidden` |
| `report.invalid_week` |
| `report.not_found` |

**`review.*`** — 3 code(s)

| Code |
|---|
| `review.forbidden` |
| `review.not_completed` |
| `review.not_head` |

**`role.*`** — 9 code(s)

| Code |
|---|
| `role.escalation_blocked` |
| `role.key_taken` |
| `role.last_admin` |
| `role.name_taken` |
| `role.not_found` |
| `role.owner_immutable` |
| `role.system_immutable` |
| `role.unknown_permission` |
| `role.unsupported_scope` |

**`route.*`** — 1 code(s)

| Code |
|---|
| `route.not_found` |

**`service.*`** — 1 code(s)

| Code |
|---|
| `service.unavailable` |

**`sla.*`** — 1 code(s)

| Code |
|---|
| `sla.invalid_due_at` |

**`space.*`** — 7 code(s)

| Code |
|---|
| `space.archived` |
| `space.duplicate` |
| `space.has_reports` |
| `space.head_invalid` |
| `space.not_archived` |
| `space.not_empty` |
| `space.not_found` |

**`sprint.*`** — 7 code(s)

| Code |
|---|
| `sprint.active_immutable` |
| `sprint.another_active` |
| `sprint.duplicate` |
| `sprint.invalid_status` |
| `sprint.not_found` |
| `sprint.overlap` |
| `sprint.task_not_in_sprint` |

**`status.*`** — 4 code(s)

| Code |
|---|
| `status.duplicate` |
| `status.in_use` |
| `status.last_in_group` |
| `status.not_found` |

**`tag.*`** — 3 code(s)

| Code |
|---|
| `tag.duplicate` |
| `tag.in_use` |
| `tag.not_found` |

**`task.*`** — 16 code(s)

| Code |
|---|
| `task.archived` |
| `task.cannot_complete_blocked` |
| `task.conflict` |
| `task.duplicate_custom_id` |
| `task.invalid_assignee` |
| `task.invalid_date_range` |
| `task.invalid_parent` |
| `task.invalid_reference` |
| `task.invalid_reviewer` |
| `task.invalid_status` |
| `task.invalid_tag` |
| `task.invalid_task_type` |
| `task.nesting_too_deep` |
| `task.not_dev_type` |
| `task.not_found` |
| `task.severity_requires_bug_type` |

**`task_type.*`** — 4 code(s)

| Code |
|---|
| `task_type.duplicate` |
| `task_type.in_use` |
| `task_type.not_found` |
| `task_type.system` |

**`template.*`** — 5 code(s)

| Code |
|---|
| `template.duplicate` |
| `template.empty_structure` |
| `template.invalid_tag` |
| `template.invalid_task_type` |
| `template.not_found` |

**`user.*`** — 11 code(s)

| Code |
|---|
| `user.cannot_change_own_role` |
| `user.cannot_change_owner_role` |
| `user.cannot_deactivate_owner` |
| `user.cannot_self_deactivate` |
| `user.cannot_self_reactivate` |
| `user.email_already_exists` |
| `user.email_change_forbidden` |
| `user.forbidden_edit` |
| `user.not_active` |
| `user.not_deactivated` |
| `user.not_found` |

**`validation.*`** — 1 code(s)

| Code |
|---|
| `validation.failed` |

**`workspace.*`** — 2 code(s)

| Code |
|---|
| `workspace.invalid_business_hours` |
| `workspace.not_found` |

### Curated meanings for the most load-bearing codes

| Code | HTTP | Meaning |
|---|---|---|
| `auth.invalid_credentials` | 401 | Email/password mismatch |
| `auth.invalid_refresh` | 401 | Refresh token revoked/expired |
| `auth.rate_limited` | 429 | Login attempts exceeded |
| `auth.missing_token` | 401 | No `Authorization` header |
| `auth.expired_token` | 401 | Access token past expiry |
| `auth.forbidden` | 403 | Permission denied for the action |
| `validation.failed` | 422 | Body/query failed validation. `details[]` lists field issues |
| `pagination.invalid_cursor` | 400 | A cursor this server did not issue (F23: strict round-trip) |
| `task.not_found` | 404 | Also any cross-workspace id (no existence oracle) |
| `task.conflict` | 409 | Optimistic-lock (`If-Match`) failure |
| `task.archived` | 409 | Writes frozen — comments and dependency edges included (F22) |
| `task.cannot_complete_blocked` | 409 | Open blockers exist (enforced since F22) |
| `tag.in_use` | 409 | The tag is still on tasks (enforced since F22) |
| `sprint.overlap` | 409 | Dates overlap another sprint (enforced since F22) |
| `role.last_admin` | 409 | The change would leave no active admin-capable account |
| `space.archived` | 409 | An archived space is frozen (F22) |
| `space.head_invalid` | 422 | Head must be an existing, active, non-guest member |
| `service.unavailable` | 503 | Pool exhaustion — retry after `Retry-After` seconds (F11) |
| `internal` | 500 | Unhandled error; `request_id` correlates the log line |

## 33. Department review & weekly HR reports <a id="36-dept-review"></a>

**ADDENDUM (Dept Review V1, 2026-07-22 — built per `DEPARTMENT_REVIEW_PLAN.md` v1.1).** Spaces double as departments: `spaces.head_user_id` names one head per space, the head reviews the department's DONE tasks (approve / flag + note), and a weekly report per department lands with HR (owner/admin) every Monday 09:00 Dhaka — plus on-demand. Done-ness authority is the LIVE `statuses.status_group ∈ {done, closed}`; department membership is DERIVED from task assignees (zero setup). Wire timestamps are UTC; week keys are Dhaka-calendar Mondays (`YYYY-MM-DD`).

### Head assignment
`PATCH /api/v1/spaces/:id` accepts `head_user_id: string | null` (👑 owner/admin). The head must be an ACTIVE non-guest member of the workspace, else **422 `space.head_invalid`**. Every space read (single + list) now carries `head_user_id` and a hydrated `head: User | null`. Deactivating a user clears their headships in the same transaction; `DELETE /spaces/:id` is refused with **409 `space.has_reports`** while department reports exist.

### POST `/api/v1/tasks/:id/review`
Head-or-👑 records a verdict on a DONE task in their department.

**Body** — `{ "status": "approved" | "flagged", "note": "≤500 chars, optional" }`
**200 OK** — the created `TaskReview` (append-only history; the task's `review_status / reviewed_at / reviewed_by` denorm updates in-tx). Assignees are notified (`task_reviewed`, self-review skipped); flag notes travel in the notification body.
Errors: `review.not_head` 403, `space.archived` 409, `review.task_not_done` 409, `task.not_found` 404. Leaving the done group (single PATCH, bulk, or a status-group regroup) RESETS the review trio; regrouping a status that is in use is refused **409 `status.in_use`**.

### GET `/api/v1/tasks/:id/reviews`
Review history, newest-first (≤100), reviewer-hydrated. Readable by 👑, the space head, and the task's assignees — else **403 `review.forbidden`**. Bare `{data}` envelope.

### GET `/api/v1/spaces/:id/review-summary`
Head-or-👑 dashboard rollup: `{ members: [{ user, assigned_open, done_unreviewed, approved, flagged, overdue_now, last_activity_at }], totals }` — per-assignee rows (Unassigned last), task-level deduped totals.

### GET `/api/v1/spaces/:id/review-queue?bucket=…`
Head-or-👑 work queue. `bucket` REQUIRED ∈ `needs_review | flagged | overdue | due_today`; cursor-paginated `{data, pagination}` of task rows (review trio + `parent_task` breadcrumb + assignees).

### GET `/api/v1/reports`
Report inbox, `{data, pagination}` — composite keyset (week DESC, id DESC), `?space_id=` filter. 👑 sees every department; a head sees reports where they are the CURRENT head or the stored SNAPSHOT head; everyone else gets an empty list (no error).
List rows carry a `totals` PREVIEW only (no full payload).

### GET `/api/v1/reports/:id`
Full report: `week_start/week_end`, snapshot `head_user_id` + hydrated `head`, `head_note`, `generated_by/at`, `acknowledged_by/at`, and the frozen §payload — `{ members: [{ user, assigned_open, completed, completed_late, overdue_now, approved, flagged, flags[] }], totals, head_accountability: { reviews_done, self_reviewed, done_unreviewed_at_generation }, prev_week }`. Unprivileged readers get **403 `report.forbidden`**; cross-workspace is always **404 `report.not_found`**.

### POST `/api/v1/reports/generate`
On-demand (re)generate — CURRENT head or 👑, rate-limited 10/min/user.

**Body** — `{ "space_id": "…", "week_start": "YYYY-MM-DD (optional, a PAST Dhaka Monday)" }` — default = last completed week.
**200 OK** — the full report. Upsert on `(space_id, week_start)`: regeneration refreshes ONLY `payload/generated_*` + the head snapshot — `head_note`, `acknowledged_*` and the notification claim survive, so nobody is re-notified. Errors: `report.invalid_week` 422, `space.archived` 409, `report.forbidden` 403.

### PATCH `/api/v1/reports/:id`
`{ "head_note": "≤1000 chars" | null }` — the stored SNAPSHOT head ONLY (even admins are refused **403 `report.forbidden`**; a successor head reads but cannot edit a predecessor's report).

### POST `/api/v1/reports/:id/ack`
👑 owner/admin "Mark seen". Idempotent 200 — the FIRST acknowledger's identity + instant stick forever. A regenerate AFTER an ack is surfaced to clients via `generated_at > acknowledged_at` ("Updated after ack").

### Weekly job — `department-report`
Registered in the jobs registry + `POST /api/v1/jobs/department-report` (token-gated) + `npm run job -- department-report [--dry-run]`. External cron fires Monday 09:00 Dhaka; generates last completed week for every LIVE space (headless spaces included), self-heals one missed week, skips windows with zero activity, and fans out `report_ready` to active admins + the head exactly ONCE per (space, week) via an atomic `notified_at` claim.

### Notifications & error codes added
Notification types `task_reviewed` and `report_ready` (both ENUMs: `notifications.type` + `user_notification_prefs.type`), entity type `report`. New codes: `space.head_invalid` 422, `space.has_reports` 409, `review.not_head` 403, `review.forbidden` 403, `review.task_not_done` 409, `report.not_found` 404, `report.forbidden` 403, `report.invalid_week` 422 (plus reuse of `space.archived` 409, `status.in_use` 409).

---

## 34. Teams & membership <a id="37-teams"></a>

**ADDENDUM (team-access P1, 2026-08-11 — built per `TEAM_ACCESS_AND_AUDIT_PLAN.md`; upgrade `016_team_membership.sql`).** A *team* IS a space; being on a team IS holding a role scoped to that space (`user_roles.scope_type='space'` — there is deliberately no separate members table). New column `users.primary_space_id` records each person's HOME team (FK → spaces, `ON DELETE SET NULL`; deliberately NOT on the wire `User` — read it from the directory below). Installing a `head_user_id` (POST/PATCH `/spaces`) now also grants the head a Member-role membership of their own space in the same transaction, and sets their home team if unset. Every membership write bumps `workspaces.permissions_version`.

### GET `/api/v1/teams`
🔐 `member.view`. The whole org chart in one read:
`{ data: [ { space: {id,name,icon,color,head_user_id}, head: User|null, members: [ { assignment_id, user: User, role_key, role_name, is_head, is_primary } ] } ], unassigned: User[] }`
— non-archived spaces only; one entry per person (strongest role wins the slot); `unassigned` = everyone (not deactivated) with no home team yet.

### POST `/api/v1/spaces/:id/members`
Add a person to a team. **Body** `{ "user_id": "…" }` → **204**. Guard (service-level, row-dependent): workspace 👑 owner/admin (live role) OR the space's OWN head OR a `space.members_manage` grant reaching this space — else 403. Always assigns the seeded **Member** role space-scoped (stronger roles stay on the `role.assign` surface with its escalation guard). Idempotent; the person's FIRST team automatically becomes their home team. Errors: `space.not_found` 404, `user.not_found` 404, `space.archived` 409, `team.member_invalid` 422 (deactivated target).

### DELETE `/api/v1/spaces/:id/members/:userId`
Remove from the team: EVERY role the person holds scoped to that space; a home team pointing here is cleared. Same guard. Idempotent **204**. The current head cannot be removed — **409 `team.head_locked`** (assign a new head first).

### PATCH `/api/v1/users/:id/team`
🔐 `member.role_change`. **Body** `{ "space_id": "…" | null }` (the key must be present; `null` clears). Setting a team also ensures membership — your home team is always one of your teams; clearing only clears the pointer. **204**. Errors: `user.not_found` 404, `team.space_invalid` 422 (unknown/archived space), `team.member_invalid` 422 (deactivated target).

### Invite change
`POST /api/v1/users/invite` accepts optional `space_id: string | null` — the invited row gets that home team + a Member space grant inside the invite transaction (422 `team.space_invalid` if unknown/archived). The client form treats the team as REQUIRED.

### Activity & error codes added
`workspace_activity` actions: `member_added` / `member_removed` (entity `space`, context `{user_id}`) and `team_changed` (entity `user`, context `{space_id}`); the `invited` context gains `space_id`. New codes: `team.head_locked` 409, `team.space_invalid` 422, `team.member_invalid` 422.

---

## Appendix A — Type reference (TypeScript shapes)

These are the canonical wire formats. Keep them in `client/src/types/` and `server/src/types/` in sync.

```ts
// Identity ────────────────────────────────────────────────────────
type Role = "owner" | "admin" | "member" | "guest";
type UserStatus = "active" | "invited" | "deactivated";

interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  avatar_url: string | null;
  status: UserStatus;
  timezone: string;
  created_at: string;
  last_login_at: string | null;
}

interface Workspace {
  id: string;
  name: string;
  logo_url: string | null;
  timezone: string;
  default_locale: string;
  week_starts_on: number;            // 0=Sun … 6=Sat
  working_days: string[];            // ['sun','mon',…]
  business_hours_start: string;      // "09:00:00"
  business_hours_end: string;
}

// Hierarchy ───────────────────────────────────────────────────────
interface Space {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  is_private: boolean;
  position: number;
  archived_at: string | null;
  created_by: string;
  created_at: string;
}

interface List {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  position: number;
  default_task_type_id: string | null;
  is_private: boolean;
  archived_at: string | null;
  created_by: string;
  created_at: string;
}

type StatusGroup = "not_started" | "active" | "done" | "closed";

interface Status {
  id: string;
  scope_type: "list" | "space";
  scope_id: string;
  name: string;
  color: string;
  status_group: StatusGroup;
  position: number;
}

interface TaskType {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  is_milestone_type: boolean;
  is_system: boolean;
  is_dev_type: boolean;
  position: number;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

// Tasks ───────────────────────────────────────────────────────────
type Priority = 0 | 1 | 2 | 3 | 4;
type BugSeverity = "S0" | "S1" | "S2" | "S3";
type PRStatus = "open" | "merged" | "closed" | "draft";
type ReporterTeam = "ops" | "cs" | "inventory" | "listing" | "marketing" | "internal";
type RecurrencePattern = "none" | "daily" | "weekly";

interface Task {
  id: string;
  custom_id: string | null;          // "ORD-1042"
  task_number: number;               // per-list counter
  workspace_id: string;
  primary_list_id: string;
  name: string;
  description: string | null;        // HTML or plain text
  status_id: string;
  priority: Priority;
  task_type_id: string;
  parent_task_id: string | null;
  nesting_depth: number;
  is_milestone: boolean;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  recurrence_pattern: RecurrencePattern;
  recurrence_days: string[] | null;  // ['mon','wed','fri']
  recurrence_ends_at: string | null;
  time_estimate_seconds: number | null;
  time_tracked_seconds: number;
  subtasks_count: number;
  subtasks_completed: number;
  comments_count: number;
  attachments_count: number;

  // Engineering fields (null for operational tasks)
  sprint_id: string | null;
  story_points: number | null;
  reviewer_id: string | null;
  branch_name: string | null;
  pr_url: string | null;
  pr_status: PRStatus | null;
  bug_severity: BugSeverity | null;
  bug_reproducibility: "always" | "sometimes" | "once" | "cannot" | null;
  bug_environment: "production" | "staging" | "local" | null;
  bug_browser: string | null;
  reporter_team: ReporterTeam | null;
  deployed_at: string | null;
  rollback_reason: string | null;

  // Embedded (always inline)
  assignees: string[];               // user IDs
  watchers: string[];
  tags: string[];                    // tag IDs
  custom_field_values: Record<string, unknown>;  // keyed by field id, JSON envelope

  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;                // also used as ETag
}

// Task content ────────────────────────────────────────────────────
interface Comment {
  id: string;
  task_id: string;
  parent_comment_id: string | null;
  author_id: string;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  replies?: Comment[];               // present on top-level comments only
}

interface Checklist {
  id: string;
  task_id: string;
  name: string;
  position: number;
  items: ChecklistItem[];
}

interface ChecklistItem {
  id: string;
  checklist_id: string;
  parent_item_id: string | null;
  text: string;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  assignee_id: string | null;
  position: number;
}

interface Attachment {
  id: string;
  task_id: string;
  name: string;
  url: string;                       // fresh signed URL (5-min validity)
  mime_type: string;
  size_bytes: number;
  thumbnail_url: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

interface TaskActivityEntry {
  id: string;
  task_id: string;
  actor: User | null;
  action: string;
  context: Record<string, unknown> | null;
  created_at: string;
}

interface TaskDependency {
  id: string;
  task: Task;                        // the other end of the edge, hydrated
  type: "blocks" | "blocked_by";
  created_at: string;
}

// Custom fields ───────────────────────────────────────────────────
type CustomFieldType = "text" | "phone" | "money" | "date" | "dropdown" | "files";

interface CustomField {
  id: string;
  scope_type: "workspace" | "space" | "list";
  scope_id: string | null;
  name: string;
  type: CustomFieldType;
  config: Record<string, unknown>;
  is_required: boolean;
  default_value: unknown | null;
  position: number;
  options?: CustomFieldOption[];
}

interface CustomFieldOption {
  id: string;
  label: string;
  color: string;
  position: number;
}

// Forms ───────────────────────────────────────────────────────────
interface Form {
  id: string;
  list_id: string;
  title: string;
  description: string | null;
  public_slug: string;
  is_public: boolean;
  branding: { primary_color: string; logo_url: string | null; theme: "light"|"dark"; layout: "single_column"|"two_column"; hide_app_branding: boolean };
  settings: { require_login: boolean; submission_open: boolean; success_message?: string; redirect_url?: string | null };
  submission_count: number;
  fields: FormField[];
  created_at: string;
}

interface FormField {
  id: string;
  field_kind: "task_attr" | "custom_field";
  field_key: string;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  is_required: boolean;
  is_hidden: boolean;
  default_value: unknown | null;
  position: number;
}

interface FormSubmission {
  id: string;
  form_id: string;
  task_id: string | null;
  submitter_email: string | null;
  data: Record<string, unknown>;
  submitted_at: string;
}

// Notifications ───────────────────────────────────────────────────
// The live ENUM (upgrades/009 cut the producerless types; upgrades/014
// re-added `overdue` WITH its producer, the overdue-alert job).
type NotificationType = "assigned" | "mentioned" | "comment" | "status_change"
                      | "form_submitted" | "task_reviewed" | "report_ready"
                      | "overdue";

interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  entity_type: "task" | "comment" | "form" | "incident";
  entity_id: string;
  actor: User | null;
  title: string;
  body: string | null;
  is_read: boolean;
  snoozed_until: string | null;
  created_at: string;
}

// Sprints & on-call ───────────────────────────────────────────────
interface Sprint {
  id: string;
  name: string;
  goal: string | null;
  start_date: string;
  end_date: string;
  status: "planned" | "active" | "closed";
  committed_points: number;
}

interface OnCallShift {
  id: string;
  week_start: string;
  week_end: string;
  engineer: User;
}

// KPIs ────────────────────────────────────────────────────────────
interface HomeKpi {
  label: string;
  value: number;
  value_display: string;             // "5", "৳117", etc.
  trend: number;                     // percent change
  trend_direction: "up" | "down" | "flat";
  is_positive: boolean;
  sparkline: number[];               // last 7 days
}

interface HomeKpiSet {
  today_orders: HomeKpi;
  cod_collected: HomeKpi;
  open_complaints: HomeKpi;
  stuck_orders: HomeKpi;
  low_stock: HomeKpi;
  my_tasks: HomeKpi;
}

// Activity ────────────────────────────────────────────────────────
interface WorkspaceActivityEntry {
  id: string;
  workspace_id: string;
  actor: User | null;
  entity_type: string;
  entity_id: string;
  action: string;
  context: Record<string, unknown> | null;
  created_at: string;
}

interface SLABreach {
  task_id: string;
  custom_id: string | null;
  name: string;
  task_type_id: string;
  sla_due_at: string;
  minutes_breached: number;
  assignees: User[];
}

// Templates ────────────────────────────────────────────────────────
type TemplateType = "task" | "list" | "space";

interface TemplateChecklistItem {
  text: string;
  /** Offset in days from `anchor_date` supplied at apply time. */
  due_offset_days?: number;
}

interface TemplateStructure {
  /** Default task type when the template is applied. */
  task_type_id?: string;
  /** Default priority (0-4). */
  priority?: number;
  /** Default tag ids to apply. */
  tags?: string[];
  /** Checklist label shown on the materialised task. */
  checklist_name?: string;
  checklist_items?: TemplateChecklistItem[];
  /** Pre-filled description (plain text for ops, Tiptap JSON for dev). */
  description?: string;
}

interface Template {
  id: string;
  workspace_id: string;
  type: TemplateType;            // "task" in V1
  name: string;
  description: string | null;
  icon: string | null;           // lucide-react icon name
  color: string | null;          // #RRGGBB
  structure: TemplateStructure;
  usage_count: number;           // monotonically increases on each /apply
  created_by: string;
  created_at: string;
  updated_at: string;
}
```

---

## Appendix B — Permission matrix

| Action | Owner | Admin | Member | Guest |
|---|---|---|---|---|
| Read own tasks | ✅ | ✅ | ✅ | ✅ |
| Read any task in workspace | ✅ | ✅ | ✅ | only invited |
| Edit task (assignee or admin) | ✅ | ✅ | own | own |
| Delete (soft) task | ✅ | ✅ | own | — |
| Hard delete task | ✅ | ✅ | — | — |
| Create space / list | ✅ | ✅ | — | — |
| Archive space / list | ✅ | ✅ | — | — |
| Invite user | ✅ | ✅ | — | — |
| Change roles | ✅ | only down to admin | — | — |
| Demote / promote owner | only self-transfer | — | — | — |
| Edit workspace settings | ✅ | ✅ | — | — |
| Manage on-call rotation | ✅ | eng-lead role | — | — |
| Manage custom fields | ✅ | ✅ | — | — |
| Public form submit | n/a — public | n/a | n/a | n/a |
| Read workspace activity | ✅ | ✅ | own | — |

---

## Appendix C — Implementation checklist

When wiring a backend, knock these off in order:

1. **Bootstrap** — Node 20 + Express/Fastify, MySQL pool (`mysql2`), Zod validators.
2. **Auth** — argon2id hashing, HS256 JWT (15-min access + 30-day refresh via `bb_refresh` httpOnly cookie), `Authorization` middleware.
3. **Mirror mockApi signatures** — implement §3–§22 endpoints with the exact response shape in this doc.
4. **File upload** — Cloudflare R2 SDK + signed-URL flow (§16).
5. **Email** — SMTP (postmark / sendgrid / amazon ses) for invitations + password-reset + daily digest.
6. **SSE inbox (§27)** — last; not blocking for V1.
7. **Background jobs (§28)** — set up node-cron or system cron.

Operational milestones:
- **Week 1-3** — auth + CRUD for spaces, lists, statuses, tasks, comments, attachments.
- **Week 4-5** — custom fields, forms, notifications, search.
- **Week 6** — sprint, on-call, engineering specials. Frontend swap `mockApi` → `realApi`.
- **Week 7** — SLA management, background jobs, polish.
- **Week 8** — pilot with operations team.

---

*This document is the contract. Any endpoint added later goes here first, then in the implementation. If a frontend feature needs an endpoint that isn't in this doc, that's a spec gap — escalate before coding.*
