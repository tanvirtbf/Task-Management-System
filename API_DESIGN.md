# BeautyBooth — API Design (v1)

Production-grade REST API specification. Every endpoint here maps **one-to-one** to a real call the React frontend already makes (`mockApi.X.Y()` in `client/src/lib/mock-api.ts`), plus the production-only endpoints the mock can't model (file upload signing, refresh-token rotation, webhooks, SSE).

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
20. [Customers](#20-customers)
21. [Sprints](#21-sprints)
22. [On-call rotation](#22-on-call)
23. [Engineering specials](#23-engineering-specials)
24. [Festival campaigns](#24-festival-campaigns)
25. [Search](#25-search)
26. [Home / KPIs](#26-home-kpis)
27. [Workspace activity](#27-workspace-activity)
28. [Webhooks (incoming integrations)](#28-webhooks-incoming)
29. [Server-Sent Events (real-time inbox)](#29-sse-realtime)
30. [Background jobs](#30-background-jobs)
31. [Inventory operations (P0)](#31-inventory)
32. [SLA management (P0)](#32-sla)
33. [Health & diagnostics](#33-health)
34. [Cross-cutting production essentials](#34-production)
35. [Error code catalog](#35-error-codes)

---

## 1. Conventions

### Request

| Header | Required | Notes |
|---|---|---|
| `Authorization` | yes (except `/auth/*`, `/public/*`, `/webhooks/*`) | `Bearer <access_token>` |
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
| 202 | Accepted — webhook receipt; processing async |
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
| `/webhooks/*` | unlimited (verified signature) |
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

**Body** — partial `Workspace` (name, logo_url, timezone, week_starts_on, working_days, business_hours_start/end, fiscal_year_start_month).

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
**Body** partial.
**200 OK** — `List`.

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

**201 Created** — full `Task`. `Idempotency-Key` strongly recommended.

---

### PATCH `/api/v1/tasks/:id`
**Body** partial. Server emits `task_activity` rows on status / assignee / sprint / pr_status changes.

If `If-Match: <etag>` is sent and doesn't match current `updated_at`, **409** `task.conflict`.

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
**Body** `{ "texts": ["item 1", "item 2", "item 3"] }`
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

## 20. Customers

### GET `/api/v1/customers`
Query: `?q=…&vip=true&order_count_min=5&cursor=…`
**200 OK** — paginated `Customer[]`.

### GET `/api/v1/customers/search`
Fast typeahead, returns max 20.
Query: `?q=…`
**200 OK** — `Customer[]`.

### GET `/api/v1/customers/by-phone/:phone`
Server normalises `+88` prefix, leading 0, etc. before lookup.
**200 OK** — `Customer`. **404** if no match.

### GET `/api/v1/customers/:id`
**200 OK** — `Customer` with optional `?include=orders,complaints` to embed recent task IDs.

### POST `/api/v1/customers`
**Body** `{ "phone", "name", "default_address?", "notes?" }`
**201 Created.** **409** on duplicate phone.

### PATCH `/api/v1/customers/:id`
**200 OK.**

### DELETE `/api/v1/customers/:id`
Soft delete + anonymise (GDPR-style). **204.**

---

## 21. Sprints

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

### POST `/api/v1/sprints/:id/tasks`
Add task(s) to sprint.
**Body** `{ "task_ids": [...] }`
**204.**

### DELETE `/api/v1/sprints/:id/tasks/:taskId`
Remove a task from the sprint.
**204.**

---

## 22. On-call

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

## 23. Engineering specials <a id="23-engineering-specials"></a>

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

## 24. Festival campaigns

### GET `/api/v1/festivals/upcoming`
BD national + business festivals in the next 90 days.
**200 OK** — `[ { "name": "Eid ul-Fitr", "date": "2026-06-17" }, … ]`

### POST `/api/v1/festivals/campaigns`
"Start festival campaign" button. Creates parent task + 12-step checklist.
**Body** `{ "festival": "Eid ul-Fitr", "list_id": "l-campaigns", "start_date?": "2026-05-15" }`
**201 Created** — parent `Task` with checklist embedded.

---

## 25. Search

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
  "customers":[Customer, ...],
  "total": 42
}
```

---

## 26. Home / KPIs <a id="26-home-kpis"></a>

### GET `/api/v1/home/kpis`
The 6 KPI tiles on the owner home.

**200 OK**
```json
{
  "today_orders":    { "label", "value", "value_display", "trend", "trend_direction": "up|down|flat", "is_positive", "sparkline": [n,n,n,n,n,n,n] },
  "cod_collected":   { … },
  "open_complaints": { … },
  "stuck_orders":    { … },
  "low_stock":       { … },
  "my_tasks":        { … }
}
```

### GET `/api/v1/home/agenda`
Calendar agenda for the day.
Query: `?date=2026-05-28`
**200 OK** — `Task[]`.

---

## 27. Workspace activity <a id="27-workspace-activity"></a>

### GET `/api/v1/activity/recent`
RecentActivityCard on Home expects to see both per-task events ("Rashida moved ORD-1024 to Delivered") and admin events ("Tanvir invited Karim"). Backend therefore returns a **UNION** of `task_activity` and `workspace_activity`, merged by `created_at DESC`. Each entry carries a `source` discriminator.

Query: `?limit=20`

**200 OK** — `RecentActivityEntry[]` where:
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

## 28. Webhooks (incoming integrations) <a id="28-webhooks-incoming"></a>

All incoming webhooks:
- Verify HMAC signature (header `X-Signature: sha256=…`). Reject with 401 on mismatch.
- Persist raw payload to a `webhook_events` table for replay.
- Return `202 Accepted` quickly; processing happens in a background worker.
- Are idempotent: identical `event_id` is a no-op.

### POST `/webhooks/website`
**Trigger:** ecom website on new order placed.

**Body**
```json
{
  "event_id": "ord_evt_abc",
  "order_id": "WO-12345",
  "customer": { "phone": "01712345678", "name": "Iqbal Begum", "address": "Mirpur 10, Dhaka" },
  "items": [{ "sku": "VITC", "qty": 1, "price": 95000 }],
  "total_amount": 95000,
  "payment_method": "cod",
  "source": "website",
  "created_at": "2026-05-28T09:00:00Z"
}
```
**202 Accepted.** Server creates a Task in **Website Orders** list, auto-creates/updates `Customer` by phone.

### POST `/webhooks/pathao`
Pathao status update. Same idempotency rules.
**202.**

### POST `/webhooks/steadfast`
Steadfast status update.
**202.**

### POST `/webhooks/facebook`
FB Page DM / comment → auto-task in **Complaints**.
**202.**

### POST `/webhooks/sslcommerz`
Payment confirmation. Marks the related order task `COD Collected` / `Paid`.
**202.**

### POST `/webhooks/sms-delivery`
Bulk SMS BD delivery callback — updates SMS-send status on a task.
**202.**

### Outbound webhooks
The system can fire workspace-configured outbound webhooks. Configured via env (no UI — per spec deletion list). Out of scope for V1 outbound.

---

## 29. Server-Sent Events (real-time inbox) <a id="29-sse-realtime"></a>

### GET `/api/v1/stream/inbox`
**Authenticated** (token via `?access_token=` query param since EventSource can't set headers).
Server emits one event per new notification + per task update relevant to the user.

```
event: notification.new
data: { "id": "ntfy-001", "type": "mentioned", "task_id": "t-90042", "title": "…" }

event: task.updated
data: { "id": "t-90042", "patch": { "status_id": "s-packed" } }

event: heartbeat
data: { "now": "2026-05-28T09:12:00Z" }
```

Heartbeat every 30 s prevents proxy disconnect. Client reconnects with `Last-Event-Id` for resume.

---

## 30. Background jobs <a id="30-background-jobs"></a>

Internal — invoked by cron, not by clients. Documented for ops visibility.

| Endpoint | Schedule | What it does |
|---|---|---|
| `POST /jobs/pathao-poll` | every 15 min | Pulls status updates for all Pathao tracking IDs |
| `POST /jobs/steadfast-poll` | every 15 min | Same for Steadfast |
| `POST /jobs/recurrence-spawn` | hourly | Creates the next instance of recurring tasks past their due date |
| `POST /jobs/email-digest` | daily 09:00 BD | Sends daily email digest of overdue + assigned-to-me tasks |
| `POST /jobs/attachment-janitor` | hourly | Hard-deletes attachments whose upload never finalised after 1 h |
| `POST /jobs/r2-purge` | daily | Hard-deletes R2 objects whose `attachments.deleted_at` > 7 days ago |
| `POST /jobs/customer-aggregates` | nightly 02:00 | Recomputes `customers.total_orders`, `total_complaints`, `lifetime_value` |
| `POST /jobs/session-cleanup` | hourly | Hard-deletes `sessions` rows past `expires_at + 30 days` |
| `POST /jobs/snooze-wake` | every 5 min | Marks snoozed notifications back as unread when `snoozed_until <= NOW()` |
| `POST /jobs/stuck-orders-alert` | every 15 min | Re-checks tasks Confirmed > 2h, fires `stuck_order` notification to on-call |

All jobs accept a `?dry_run=true` query to log what they would do without writing. Guarded by an `X-Internal-Token` header so they can be triggered from k8s CronJobs but not from the public internet.

Additional P0-related jobs:

| Endpoint | Schedule | What it does |
|---|---|---|
| `POST /jobs/sla-breach-scan` | every 5 min | Reads `v_breached_sla`, fires `incident_alert` / `due_soon` notifications, escalates S0 bugs to on-call |
| `POST /jobs/expiring-batches` | daily 08:00 BD | Reads `v_expiring_batches`, creates "Reorder due to expiry" tasks for items expiring < 30 days |
| `POST /jobs/auto-reorder` | hourly | Reads `v_stock_levels`, creates Purchase Order tasks for SKUs where current_stock < reorder_level |
| `POST /jobs/stock-level-sync` | every 15 min | Recomputes `cf_current_stock` custom-field values on Stock Master tasks from `v_stock_levels` |

---

## 31. Inventory operations (P0 — stock batches + movements) <a id="31-inventory"></a>

These endpoints expose the schema's `stock_batches` and `stock_movements` tables. Every mutation here also produces a `task_activity` row when a related task is involved, so the per-task feed shows "Decremented 3 units from LOT-A".

### GET `/api/v1/inventory/batches`
Paginated batch list.
Query: `?sku=t-001&expiring_within_days=30&include_empty=false&cursor=…&limit=50`
**200 OK** — paginated `StockBatch[]`.

### GET `/api/v1/inventory/batches/:id`
**200 OK** — `StockBatch`.

### GET `/api/v1/inventory/batches/by-sku/:skuTaskId`
Batches for one SKU, sorted by expiry ASC (FIFO order — the order the packing team should pick from).
**200 OK** — `StockBatch[]`.

### POST `/api/v1/inventory/batches`
Receive a new batch. Server creates the batch row **and** a `stock_movements` row of type `receive` in one transaction.

**Body**
```json
{
  "sku_task_id": "t-stock-vitc-30",
  "batch_number": "LOT-2026-A",
  "mfg_date": "2026-01-15",
  "expiry_date": "2026-06-15",
  "quantity_received": 100,
  "cost_per_unit_paisa": 55000,
  "supplier_name": "Beauty Imports Ltd",
  "received_via_task_id": "t-po-001",
  "notes": "Boxes 1-2 had minor dents — accepted"
}
```
**201 Created** — `StockBatch`. **409** `batch.duplicate` if `(sku_task_id, batch_number)` already exists.

### PATCH `/api/v1/inventory/batches/:id`
Correct expiry / mfg / notes / supplier_name. **Cannot** change quantity_received (immutable); use a movement instead.
**Body** partial — `{ expiry_date?, mfg_date?, supplier_name?, notes?, cost_per_unit_paisa? }`
**200 OK.**

### GET `/api/v1/inventory/batches/expiring`
Expiring in next N days (default 30). Drives the inventory team's daily alert.
Query: `?days=30&include_zero_qty=false`
**200 OK** — `[{ batch_id, sku_task_id, sku_name, batch_number, expiry_date, days_to_expiry, quantity_remaining }, …]`

---

### GET `/api/v1/inventory/movements`
Append-only ledger. Newest first.
Query: `?sku=t-001&type=sale,receive&from=2026-05-01&to=2026-05-28&cursor=…&limit=50`
**200 OK** — paginated `StockMovement[]`.

### POST `/api/v1/inventory/movements`
Append a manual movement (sale / receive / damage / adjustment / return / reversal). For `receive`, prefer using `POST /inventory/batches` which atomically creates batch + movement.

**Body**
```json
{
  "sku_task_id": "t-stock-vitc-30",
  "movement_type": "damage",
  "quantity_change": -2,
  "batch_id": "b-001",
  "reason": "Dropped during sorting",
  "related_task_id": "t-damage-042"
}
```
Server validates: if `batch_id` provided, `batch.quantity_remaining + quantity_change >= 0`. Atomic transaction updates `stock_batches.quantity_remaining` + inserts the movement row.

**201 Created** — `StockMovement`. **422** `stock.insufficient` if it would drive batch negative.

### GET `/api/v1/inventory/movements/by-task/:taskId`
Movements caused by a specific task (e.g., everything decremented when ORD-1042 was packed).
**200 OK** — `StockMovement[]`.

### GET `/api/v1/inventory/levels`
Current stock per SKU from `v_stock_levels`. Use this as the source of truth for "is it in stock".

Query: `?low_stock_only=true&threshold=20&cursor=…&limit=100`

**200 OK**
```json
{
  "data": [
    { "sku_task_id": "t-001", "sku_name": "Vit C 30ml", "current_stock": 97, "last_movement_at": "2026-05-28T09:00:00Z" },
    …
  ],
  "pagination": { "next_cursor": "…", "has_more": false }
}
```

### GET `/api/v1/inventory/levels/:skuTaskId`
Single SKU current stock + batch breakdown.
**200 OK**
```json
{
  "sku_task_id": "t-001",
  "current_stock": 97,
  "batches": [
    { "batch_id": "b-001", "batch_number": "LOT-A", "expiry_date": "2026-06-15", "quantity_remaining": 97 }
  ],
  "last_movement_at": "2026-05-28T09:00:00Z"
}
```

---

## 32. SLA management (P0) <a id="32-sla"></a>

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

## 33. Health & diagnostics <a id="33-health"></a>

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
background_job_runs_total{job="pathao-poll",status="success"} 192
```

Recommended metrics:
- `http_requests_total{method,route,status}` — counter
- `http_request_duration_seconds_bucket` — histogram
- `mysql_pool_connections_in_use` — gauge
- `redis_pool_connections_in_use` — gauge
- `sse_connections_open` — gauge
- `background_job_runs_total{job,status}` — counter
- `background_job_duration_seconds_bucket{job}` — histogram
- `webhook_events_total{provider,status}` — counter

---

## 34. Cross-cutting production essentials <a id="34-production"></a>

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

`/public/*` and `/webhooks/*` use **looser CORS** (allow any origin) since they're called from non-app contexts (FB intake links, courier servers).

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
| `/webhooks/*` | 256 KB | 413 (configure per provider) |
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

## 35. Error code catalog <a id="35-error-codes"></a>

Stable string codes — frontend can switch on these. Format: `<domain>.<reason>`.

| Code | HTTP | Meaning |
|---|---|---|
| `auth.invalid_credentials` | 401 | Email/password mismatch |
| `auth.invalid_refresh` | 401 | Refresh token revoked/expired |
| `auth.rate_limited` | 429 | Login attempts exceeded |
| `auth.missing_token` | 401 | No `Authorization` header |
| `auth.expired_token` | 401 | Access token past expiry |
| `auth.forbidden` | 403 | Permission denied for action |
| `validation` | 422 | Body failed validation. `details[]` lists field issues |
| `task.not_found` | 404 | |
| `task.conflict` | 409 | Optimistic-lock failure |
| `task.archived` | 409 | Action not allowed on archived task |
| `task.cannot_complete_blocked` | 409 | Open blockers exist (soft warning — UI can override) |
| `task.nesting_too_deep` | 422 | Subtask nesting > 2 levels |
| `list.not_found` | 404 | |
| `list.has_open_tasks` | 409 | Cannot delete; tasks still exist |
| `status.in_use` | 409 | Cannot delete; tasks reference it |
| `tag.in_use` | 409 | (For hard delete) |
| `custom_field.unsupported_type` | 422 | Trying to use a non-allowed type |
| `customer.duplicate_phone` | 409 | Phone already taken |
| `customer.invalid_phone` | 422 | Phone fails `01[3-9]\d{8}` regex |
| `form.slug_taken` | 409 | Public slug already used |
| `form.submission_closed` | 403 | Form's `submission_open` is false |
| `attachment.too_large` | 413 | File size > limit |
| `attachment.mime_not_allowed` | 415 | MIME type rejected |
| `attachment.upload_expired` | 410 | Signed URL no longer valid |
| `sprint.overlap` | 409 | Two active sprints not allowed |
| `dep.cycle` | 422 | Would create a dependency cycle |
| `dep.self` | 422 | Task cannot depend on itself |
| `notification.not_owner` | 403 | Cannot act on another user's notification |
| `batch.not_found` | 404 | |
| `batch.duplicate` | 409 | Same `(sku, batch_number)` already exists |
| `batch.expired` | 422 | Trying to receive a batch whose expiry is in the past |
| `batch.quantity_immutable` | 422 | Cannot change `quantity_received` after creation (use movement) |
| `stock.insufficient` | 422 | Movement would drive batch quantity below zero |
| `stock.invalid_movement_type` | 422 | Unknown `movement_type` value |
| `sla.invalid_due_at` | 422 | SLA due date is in the past |
| `inventory.sku_not_in_stock_list` | 422 | Provided SKU task is not in the Stock Master list |
| `health.dependency_down` | 503 | Readiness check failed — see `checks` field |
| `payload.too_large` | 413 | Body exceeded per-route limit (see §34.4) |
| `webhook.bad_signature` | 401 | HMAC mismatch |
| `webhook.duplicate_event` | 200 | Idempotent retry — treated as success but logged |
| `rate.exceeded` | 429 | Per-bucket rate limit |
| `internal` | 500 | Unhandled — see `request_id` in logs |
| `maintenance` | 503 | Planned downtime |

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
  fiscal_year_start_month: number;   // 1..12
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
type NotificationType = "assigned" | "mentioned" | "comment" | "status_change"
                      | "due_soon" | "overdue" | "form_submitted"
                      | "reminder_due" | "pr_review" | "incident_alert";

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

// Customers ───────────────────────────────────────────────────────
interface Customer {
  id: string;
  phone: string;                     // 11 digits, e.g. "01712345678"
  name: string;
  default_address: string | null;
  total_orders: number;
  total_complaints: number;
  lifetime_value: number;            // BDT in paisa
  vip_flag: boolean;                 // generated column
  last_order_at: string | null;
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

// Inventory (P0) ──────────────────────────────────────────────────
interface StockBatch {
  id: string;
  workspace_id: string;
  sku_task_id: string;
  batch_number: string;
  mfg_date: string | null;
  expiry_date: string | null;
  quantity_received: number;       // immutable after creation
  quantity_remaining: number;       // maintained from stock_movements
  cost_per_unit_paisa: number | null;
  supplier_name: string | null;
  received_via_task_id: string | null;
  received_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type StockMovementType =
  | "receive" | "sale" | "return" | "damage"
  | "adjustment" | "transfer" | "reversal";

interface StockMovement {
  id: string;
  workspace_id: string;
  sku_task_id: string;
  batch_id: string | null;
  movement_type: StockMovementType;
  quantity_change: number;          // signed
  reason: string | null;
  related_task_id: string | null;
  actor: User | null;
  created_at: string;
}

interface StockLevel {
  sku_task_id: string;
  sku_name: string;
  current_stock: number;
  last_movement_at: string | null;
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
6. **Webhooks (§28)** — start with website + Pathao + Steadfast.
7. **SSE inbox (§29)** — last; not blocking for V1.
8. **Background jobs (§30)** — set up node-cron or system cron.

Operational milestones:
- **Week 1-3** — auth + CRUD for spaces, lists, statuses, tasks, comments, attachments.
- **Week 4-5** — custom fields, forms, notifications, search.
- **Week 6** — sprint, on-call, engineering specials. Frontend swap `mockApi` → `realApi`.
- **Week 7-9** — integrations (webhooks).
- **Week 10** — pilot with operations team.

---

*This document is the contract. Any endpoint added later goes here first, then in the implementation. If a frontend feature needs an endpoint that isn't in this doc, that's a spec gap — escalate before coding.*
