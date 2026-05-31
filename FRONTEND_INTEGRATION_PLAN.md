# Frontend ↔ Backend Integration Plan

**Project:** BeautyBooth Task Management (free ClickUp alternative)
**Goal:** Wire the now-complete `/api/v1` backend into the 100%-mock React frontend, phase by phase, ending in a fully working product.
**Authored:** 2026-05-31 · from a 12-agent deep scan (frontend + backend + contract mapping + critical path).

---

## 0. How to use this plan

- **One phase at a time.** Each phase below is written to be handed to Claude as a single, self-contained task (Goal → Depends-on → Endpoints → Files → Steps → Acceptance). Do them in order; later phases assume the earlier ones landed.
- **Migrate-in-place, delete mocks LAST.** `client/src/lib/mock-api.ts` (2496 lines) + `client/src/mocks/*` (27 files) stay until every call site is migrated. Each phase re-points its slice of the ~121 `useQuery`/`useMutation` calls from `mockApi.*` to the real `api.*`. The app must run at every phase boundary.
- **The hard gate is P0.** Nothing real can be fetched until the foundation (env + adapter + auth) lands. Build it once; every later phase inherits it.
- **Verify, don't trust.** Numbers/paths here come from a scan of an actively-evolving working tree. Re-confirm an endpoint exists before wiring it (`git ls-files server/src/routes`, read `server/src/app.ts`).

### Current state (the starting line)
- **Frontend:** 100% mock. Every one of ~51 data files imports `mockApi` from `client/src/lib/mock-api.ts`. `client/src/http/{client,api}.ts` are wired-but-**unused** stubs ("NOT USED IN PHASE 1"). `client/.env` **does not exist** (only `.env.example`). Auth store (`stores/auth.ts`) persists **only `user`** (localStorage key `th-auth`), **no token**; `RequireAuth` gates on `user !== null` with no server check.
- **Backend:** ~115 endpoints live under `/api/v1` (working tree, mostly uncommitted). Wire format = **snake_case** + `{data,pagination:{next_cursor,has_more,total_estimate}}` envelope on lists, bare objects on single reads. Auth = `access_token` (login body) + `bb_refresh` HttpOnly cookie + `GET /auth/me`. **Server PORT = 5501.**
- **Backend gaps (only two with tables-but-no-routes):** §14 Comments, §15 Checklists. Plus several FE-only features with **no backend at all** (see §5).

---

## 1. Systemic integration rules (BUILD IN P0, REUSE EVERYWHERE)

These solve ~90% of the wiring once, at the transport boundary. Get them right in P0 and every later phase is a near-mechanical `mockApi.x → api.x` swap.

### R1 — snake_case ↔ camelCase
Backend emits **snake_case** on every resource; FE types are **camelCase** throughout. Add **one recursive key transformer**:
- Response interceptor: `snake_case → camelCase`.
- Request transformer: `camelCase → snake_case` on outgoing bodies.
- **Exceptions (skip conversion):** `GET /home/kpis` (already camelCase on the wire); do **not** recurse into `Template.structure` (verbatim camelCase blob).

### R2 — `{data,pagination}` envelope unwrap
List endpoints return `{data:T[], pagination:{next_cursor,has_more,total_estimate}}`; the mock returns bare arrays. Add an `unwrapData<T>(res)` helper and use it on collection queryFns — **except** these that return a **bare array / bare object (do NOT unwrap `.data`):**
`GET /lists/:listId/statuses`, `GET /tasks/:id/subtasks`, `GET /tasks/:id/attachments`, `GET /sprints`, `GET /custom-fields`, `GET /lists/:listId/custom-fields`, `GET /sla/breached`, `GET /home/agenda`, `GET /tasks/my-work` (bare bucket object), `GET /search` (bare multi-bucket object), `GET /activity/recent` (`{data}` but **no** `pagination` key). All single-resource GETs (`/workspace`, `/auth/me`, `/tasks/:id`, `/spaces/:id`, `/lists/:id`) are bare objects.

### R3 — Dates
- **`YYYY-MM-DD` (no TZ), parse as LOCAL:** `start_date`, `due_date`, `recurrence_ends_at`, sprint `start_date`/`end_date`, on-call `week_start`/`week_end`. `new Date('2026-06-01')` parses as UTC-midnight → **off-by-one day** in local render; parse date-only fields as local.
- **ISO-8601 UTC (`…Z`):** `created_at`, `updated_at`, `completed_at`, `sla_due_at`, `archived_at`, `deployed_at`.

### R4 — ETag / If-Match (tasks optimistic concurrency)
`POST /tasks`, `PATCH /tasks/:id`, `PATCH /tasks/:id/sla`, `PUT /tasks/:id/custom-fields/:fieldId` set an `ETag` header = `task.updated_at`. `PATCH /tasks/:id` accepts `If-Match` → **409 `task.conflict`** on mismatch. Store the ETag in the task query cache on every read/write; send it as `If-Match` on the next edit; on 409 refetch + surface a merge prompt.

### R5 — Auth / token model
- Login → `{access_token, expires_in:900, user:WireUser}` + sets `bb_refresh` HttpOnly cookie (path `/api/v1/auth`, 30d, SameSite=strict).
- Store `access_token` **in memory** (new non-persisted store field — never localStorage). Request interceptor attaches `Authorization: Bearer <access_token>`.
- `GET /auth/me` (bare `WireUser`) is the identity bootstrap — call on app load to revalidate the rehydrated session and repopulate the in-memory token.
- Refresh interceptor must (a) hit the **full** `/api/v1/auth/refresh` path so the path-scoped cookie is sent, (b) **store the new** `access_token` from the response, (c) carry an `_retry` guard so a 401 from refresh itself doesn't loop.

### R6 — Error envelope
All errors are `{error:{code,message,request_id}}`. Add one mapper → friendly AntD message/notification. Keep React Query `retry:false` so 401s don't spam the refresh path.

### R7 — JWT-derived identity
Mock calls pass `userId` positionally (`notifications.list(userId)`, `tasks.myWork(userId)`); real endpoints derive the user from the JWT. **Drop the `userId` argument from queryFns**; the queryKey `['notifications', userId]` may stay for cache partitioning.

### R8 — Sync-mock-import refactor (the top correctness risk after P0)
~25–30 components import static lookup Maps/arrays **synchronously** at render, bypassing React Query entirely: `usersById`, `statusesById`/`statusesByList()`, `taskTypesById`/`isDevTaskType`, `listsById`, `spacesById`, `sprints`/`activeSprint()`/`sprintsById`, `currentOnCallEngineerId()`, `allTasks`, `workspace.settings`. **Re-pointing `mockApi` does NOT fix these** — they keep rendering stale mock data, and real DB ids won't match the static mock-map keys (silent mismatch + `TaskRedirect` break). Convert each to a cache-backed selector hook (`useUsers`, `useStatuses(listId)`, `useTaskTypes`, `useLists`, `useSpaces`, `useSprints`, `useOnCallCurrent`, `useWorkspace`) **in the same phase the map is first read live.**

### Structural mappers (the only 5 the generic transformer can't handle)
Build these as thin per-resource functions on top of R1:
1. **Workspace** — wire is FLAT; FE nests under `settings`. Reconstruct `settings.{timezone,defaultLocale,weekStartsOn,businessHours:{start,end},fiscalYearStartMonth}`; `working_days` is **day-name string[]** on wire ↔ **number[] indices (0–6)** in FE.
2. **Task recurrence** — fold flat `recurrence_pattern`/`recurrence_days`(weekday-names)/`recurrence_ends_at` into nested `recurrence:{pattern,daysOfWeek,endsAt,…}` (null when pattern empty/`none`); `interval`/`dayOfMonth`/`cron`/`spawnOnComplete` are FE-only. Also rename `custom_field_values → customFields` and **drop `workspace_id`** (not in FE `Task`).
3. **TaskDependency** — `GET /tasks/:id/dependencies` returns `{blocks:[],blocked_by:[]}` where each edge carries the OTHER end as a **fully hydrated Task**; FE wants flat `{id,taskId,relatedTaskId,type,createdAt}[]`. Flatten + tag `type`.
4. **OnCallShift** — wire `{week_start,week_end,engineer:WireUser inline}` → FE `{id,weekStart,engineerId}` (extract `engineer.id`; FE has no `week_end`).
5. **Notification + Prefs** — `WireNotification` omits `user_id` (inject from auth) and `body` is `string|null` (→ `undefined`). Prefs: flat `Record<type,{in_app_enabled,email_enabled}>` on wire ↔ FE nested `{channels:{inApp,email,push},events,quietHours}`; **`push` channel + `quietHours` have NO backend**; `PUT` (full replace), not PATCH.

---

## 2. Phase plan (dependency-ordered)

> Legend per phase: **Goal · Depends-on · Backend endpoints · Files to touch · Steps · Acceptance · Risks/notes.**

### ✅ P0 — Foundation (HARD GATE — blocks everything) — DONE
**Status:** ✅ DONE (2026-05-31).
**Goal:** Stand up the real transport + auth so a single authenticated call works end-to-end. No feature wiring yet.
**Depends-on:** nothing.
**Endpoints (proving harness):** `POST /auth/login`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/logout`.
**Files:** `client/.env` (create), `client/.env.example` (update), `client/src/http/client.ts`, `client/src/http/api.ts`, `client/src/stores/auth.ts`, `client/src/types/index.ts` (add `accessToken` to `AuthState`), `client/src/layouts/{Root,RequireAuth,RequireGuest}.tsx`, `client/src/main.tsx` (QueryClient review), optionally `client/vite.config.ts` (dev proxy).
**Steps:**
1. Create `client/.env` → `VITE_BACKEND_API_URL=http://localhost:5501/api/v1` (server PORT=5501; README's 4000 is stale). Update `.env.example` to show the `/api/v1` suffix. *(Optionally add `vite.config.ts` `server.proxy['/api/v1'] → http://localhost:5501` to dodge CORS in dev; otherwise ensure the server CORS allowlist includes `http://localhost:5173`.)*
2. Build **R1** (recursive camelize response / decamelize request) + **R2** `unwrapData` helper + **R6** error mapper, all in `http/client.ts`. Whitelist `/home/kpis` and `Template.structure` to skip case-conversion.
3. **R5** auth: add in-memory `accessToken` + `setAccessToken()` to the store (non-persisted); request interceptor attaches `Authorization: Bearer`. Capture `access_token` on login and on every refresh response.
4. Fix the refresh interceptor: hit full `/api/v1/auth/refresh`, store the **new** token, add the `_retry` guard (no infinite loop). Fix `api.ts` `/auth/self → /auth/me` (rename `self()→me()`).
5. `Root.tsx`: on app load, `GET /auth/me` to revalidate + repopulate the token; show a loading state. Rework `RequireAuth`/`RequireGuest` to gate on that result (401 → clear store → `/login`).
6. Remove the `setCurrentUser()` mock coupling from `auth.ts` (`setUser`/`logout`/`onRehydrateStorage`).
7. Keep React Query `retry:false`.
**Acceptance:** a throwaway authenticated `GET /auth/me` returns a camelCase user readable as `user.firstName`; a 401 triggers **exactly one** refresh that retries with the **new** token; browser reload preserves the session via `/auth/me`; `baseURL` resolves under `/api/v1`; CORS works.
**Risks:** confirm the running port before writing `.env`; the attachment presigned-PUT (P3) and SSE (P5) paths **bypass** this interceptor stack — handle separately.

### ✅ P1 — Auth + Hierarchy + Tasks (the smallest working product) — DONE
**Status:** ✅ DONE (2026-05-31) — all listed files + the R8 sync-import sub-components (BoardCard/ListViewRow/ListViewToolbar/InlineStatusEdit/InlineAssigneeEdit/BulkActionToolbar/Breadcrumb/SidebarFavorites/Create{List,Space,Task}Modal) wired; `setCurrentUser` removed from auth store. Build: 68 tsc errors (69 baseline −1, zero new in touched files), `vite build` ✓ exit 0. **DEFERRED:** R4 ETag/If-Match (step 4) — `PATCH /tasks/:id` is last-write-wins for now (no 409 `task.conflict` handling yet).
**Goal:** Prove the whole pipe with the core vertical: log in → see real workspace/spaces/lists → open a list → real tasks in List/Board/Calendar → create/update a task that persists across reload.
**Depends-on:** P0.
**Endpoints:** `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `GET /workspace`, `GET /spaces`, `GET /spaces/:spaceId/lists`, `GET /lists`, `GET /lists/:id`, `GET /lists/:listId/statuses`, `GET /lists/:listId/tasks`, `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id` (ETag/If-Match), `POST /tasks/:id/archive`, `DELETE /tasks/:id` (soft by default; `?hard=true` admin), `POST /tasks/bulk`, `GET /tasks/my-work`.
**Files:** `pages/auth/Login.tsx`, `layouts/{Root,RequireAuth,RequireGuest}.tsx`, `components/shared/{Sidebar,SidebarSpaceTree}.tsx`, `pages/space/SpacePage.tsx`, `pages/list/ListPage.tsx`, `components/views/{ListView,BoardView,CalendarView,*}.tsx`, `components/shared/CreateTaskModal.tsx`, `hooks/useTaskMutations.ts`, `pages/task/TaskRedirect.tsx`.
**Steps:**
1. `Login` → `POST /auth/login`, store `access_token` + user; **delete the `/login/2fa` branch** (backend never returns `requires2fa`); drop demo-account hints.
2. Wire workspace + spaces + lists queries (apply **Workspace** structural mapper; inject `Space.workspaceId`/`List.folderId=null`).
3. Wire `GET /lists/:listId/statuses` (**bare array**) and convert `statusesByList()`/`statusesById`/`listsById` **sync imports** (R8) to `useStatuses(listId)` / cache selectors — **in this phase** or columns render stale.
4. Wire task list (`GET /lists/:listId/tasks`, unwrap `.data`, **Task** mapper, cursor pagination) + `useTaskMutations` (create/update/archive/delete/bulk) with **ETag/If-Match** (R4). Board drag-drop → `PATCH /tasks/:id` `{status_id}`.
5. `TaskRedirect` must resolve via real `listsById` from cache, not the mock map.
**Acceptance:** log in with a real account; sidebar shows real workspace+spaces+lists; open a list → tasks render in all three views with correct statuses; create a task persists and appears after refetch; drag a card persists `status_id` and survives reload; logout calls `POST /auth/logout`.
**Risks:** **reference-data-before-tasks** — a task's `status_id`/`assignee_ids` are real ids absent from static mock maps; fetch statuses/task-types/users live here or accept mismatches.

### ✅ P2 — Settings + Members + Reference CRUD — DONE
**Status:** ✅ DONE (2026-05-31) — all 8 settings pages wired; `http/api.ts` gained users/task-types/tags/custom-fields/statuses CRUD + a new templates namespace; `client.ts` got a `skipDecamelize` flag for the verbatim-camelCase `Template.structure`; TagsSettings' space-UX was stripped (tags are workspace-wide). `TaskType` gained `isDevType?`/`position?`. Build: 61 tsc errors (P1 baseline −7, zero new in touched files), `vite build` ✓ exit 0. ProfileSettings password-change stays disabled (`POST /users/me/change-password` has no backend).
**Goal:** Admin/settings screens on real data.
**Depends-on:** P0, P1.
**Endpoints:** `GET/POST /users`, `POST /users/invite`, `PATCH /users/:id`, `PATCH /users/:id/role`, `POST /users/:id/deactivate|reactivate`; `GET/POST/PATCH/DELETE /task-types`; `GET/POST/PATCH/DELETE /tags`; `GET/POST/PATCH/DELETE /custom-fields`; `GET/PATCH /workspace`; `GET /templates`, `POST /templates/:id/apply`, `POST/PATCH/DELETE /templates`.
**Files:** `pages/settings/{MembersSettings,TaskTypesSettings,TagsSettings,CustomFieldsSettings,WorkspaceSettings,ProfileSettings,TemplatesSettings,StatusesSettings}.tsx`, `components/settings/*`.
**Steps:** wire each CRUD; inject dropped fields (`workspaceId` on Tag/TaskType/Space from auth context); map `is_dev_type→isDevType` (add to FE `TaskType`); replace `spacesById` sync imports with `GET /spaces`; wire `TemplatesSettings` editor `onOk` to `POST/PATCH /templates` (currently saves nothing).
**Acceptance:** invite a member (201); change role; deactivate/reactivate; CRUD a task-type/tag/custom-field reflected in the task drawer; workspace settings persist; apply a template spawns a task.
**Gaps:** `POST /users/me/change-password` **missing** → keep ProfileSettings password change mocked/disabled; `AcceptInvitation` can be pre-wired but not tested (no backend route — see §5).

### ✅ P3 — Task Detail Sub-resources — DONE
**Status:** ✅ DONE (2026-05-31). **P3a:** activity, subtasks, dependencies (flatten {blocks,blocked_by} + `listByList` candidates), membership deltas (assignee/tag via `useTaskMembership` — PATCH can't carry them), drawer + properties-panel sync-map→hook conversions. **P3b:** AttachmentsSection 3-step presigned R2 upload (sign → raw-`fetch` PUT to R2 → finalize) + CustomFieldsList real defs & value set/clear (`PUT/DELETE /tasks/:id/custom-fields/:fieldId`); `client.ts` got an `OPAQUE_VALUE_KEYS` skip so `config`/`custom_field_values` blobs stay verbatim-snake for the field renderers. Build: 60 tsc errors, `vite build` ✓. NEW api: `taskActivityApi`, `dependenciesApi`, `attachmentsApi`, tasksApi membership + custom-field values. ⚠️ Attachments need R2 configured (dev stub → PUT fails); the `files` custom-field type is `{attachments}` (FE) vs `{file_ids}` (BE) — follow-up. Comments §14 + Checklists §15 stay mock (no backend → P8).
**Goal:** The task drawer on real data (except comments/checklists).
**Depends-on:** P0, P1, P2 (task-types/users/custom-field defs).
**Endpoints:** `GET /tasks/:id/activity`; `POST/DELETE /tasks/:id/assignees(/:userId)|/watchers/self|/tags(/:tagId)`; `GET /tasks/:id/dependencies`, `POST/DELETE /task-dependencies`; `GET /tasks/:id/attachments`, `POST /uploads/sign` → client PUT to R2 → `POST /attachments/:id/finalize`, `DELETE /attachments/:id`; `PUT/DELETE /tasks/:id/custom-fields/:fieldId`.
**Files:** `components/task/{TaskDetailDrawer,AttachmentsSection,DependenciesSection,TaskActivitySection,ChecklistsSection,CommentsSection,BugFieldsSection,GitIntegrationPanel,InlineAssigneeEdit}.tsx`, `components/custom-field/CustomFieldsList.tsx`, `TaskPropertiesPanel`.
**Steps:** wire activity (unwrap `.data`, map `actor`), membership mutations (204; invalidate `['task',id]`), dependencies (**flatten** `{blocks,blocked_by}` mapper; candidate picker uses `GET /search`, not `allTasks`), **rewrite AttachmentsSection** to the 3-step presigned flow (field renames `type↔mime_type`, `size↔size_bytes`; the PUT-to-R2 is **not JSON** and bypasses interceptors), custom-field set/clear (`PUT` returns full Task → bumps ETag). **CommentsSection + ChecklistsSection stay on `mockApi` behind a feature flag** (no backend — see P8). Convert drawer `usersById`/`statusesById`/`taskTypesById` sync imports to cache selectors.
**Acceptance:** open a task → real activity; add/remove assignee/tag/watcher persists + writes activity; add/remove dependency (cycle → 422); upload via sign→PUT→finalize + download 302; set/clear custom-field bumps ETag; comments/checklists still work via mock with no console errors.

### ◐ P4 — Forms (admin side DONE; public-intake render blocked by backend gap)
**Status:** ◐ ADMIN DONE (2026-05-31) — `formsApi` (list/byList/get/create/update/delete/addField/updateField/deleteField/reorderFields/submissions); FormsListPage, FormView, FormBuilderPage wired. FormBuilder Save now does a real field-diff (metadata PATCH + per-field POST/PATCH/DELETE + reorder — the form PATCH ignores `fields`). Build: 57 tsc errors (P3b −3, fixed pre-existing FormBuilder errors), `vite build` ✓. ⚠️ **PublicFormPage STAYS MOCK** — backend has NO `GET /public/forms/:slug` render route (only the submit). Backend must add it (serializer `toPublicForm` exists) before the anonymous form can render/submit against the real API.
**Goal:** Form builder + public intake on real data.
**Depends-on:** P0, P1, P2 (lists, custom-fields).
**Endpoints:** `GET /forms`, `GET /lists/:listId/forms`, `POST /forms`, `GET/PATCH/DELETE /forms/:id`, `POST /forms/:id/fields`, `PATCH /forms/:id/fields/reorder`, `PATCH/DELETE /form-fields/:id`, `GET /forms/:id/submissions`, `GET /public/forms/:slug` *(render — see gap)*, `POST /public/forms/:slug/submit`.
**Files:** `pages/forms/{FormsListPage,FormBuilderPage}.tsx`, `components/views/FormView.tsx`, `pages/public-form/PublicFormPage.tsx`, `layouts/PublicFormLayout.tsx`.
**Steps:** wire form CRUD + per-field add/reorder (note path is `/forms/:id/fields/reorder`); submissions list (unwrap `.data`); public page `GET /public/forms/:slug` then `POST .../submit` (unauthenticated — **no Bearer**; handle 429). FormBuilder currently persists only top-level metadata — fix field diffs here.
**Acceptance:** create a form; add/reorder/delete fields via real endpoints; view submissions; public visitor loads + submits → creates a task; 429 shows a friendly message.
**Gap:** `GET /public/forms/:slug` render route may be **missing** (only submit exists; controller/serializer reportedly present — thin binding task). Coordinate with backend (§5).

### ◐ P5 — Notifications + Realtime (inbox/bell DONE; live SSE push blocked by auth model)
**Status:** ◐ CORE DONE (2026-05-31) — `notificationsApi` (list/unreadCount/markRead/markUnread/markAllRead/snooze/delete + prefs); InboxPage, NotificationBell, Sidebar wired (R7 — no userId arg, JWT-scoped); `mapNotification` (inject userId, body null→undefined). Build: 57 tsc errors, `vite build` ✓. ⚠️ **SSE NOT wired** — `EventSource` can't authenticate: the backend wants Bearer-or-`accessToken`-cookie, but our access token is in-memory (Bearer) and no `accessToken` cookie is set → `/stream/inbox` 401s. Shipped a `refetchInterval:60s` polling substitute on the unread-count. True push needs a backend `?access_token=` query-param option on the stream (or an accessToken cookie). Prefs has no FE UI (api ready).
**Goal:** Inbox + bell on real data, with live push.
**Depends-on:** P0, P1.
**Endpoints:** `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/mark-all-read`, `GET/PUT /notifications/preferences`, `POST /notifications/:id/read|unread|snooze`, `DELETE /notifications/:id`, `GET /stream/inbox` (SSE).
**Files:** `pages/inbox/InboxPage.tsx`, `components/shared/{NotificationBell,Sidebar}.tsx`, notification-preferences UI.
**Steps:** wire feed (unwrap `.data`, **Notification** mapper: inject `userId`, `null→undefined` body; drop `userId` arg per R7), unread-count (`{unread_count}`), read/unread/mark-all (**204** — mock returns entity), snooze, delete; co-invalidate `['notifications',userId]` + `['notifications','unread-count',userId]`. Prefs: flat↔nested mapper, `PUT` full-replace, `push`/`quietHours` are FE-only. **SSE:** `EventSource` to `/stream/inbox` (cookie auth — **cannot** use axios interceptors); on push, map `WireNotification` + invalidate unread-count; reconnect via `Last-Event-Id`.
**Acceptance:** inbox lists real notifications (cursor-paginated, unread-first); state mutations persist; bell shows real unread-count (JWT-derived, no `userId` param); another user's action pushes a live notification without manual refetch.
**Note:** snooze re-surfacing depends on the §28 snooze-wake job — known limitation.

### ✅ P6 — Home / KPIs / Search / Activity — DONE
**Status:** ✅ DONE (2026-05-31) — `homeApi.kpis` (bare camelCase, R1-skipped), `activityApi.recent` (actor-hydrated `{data}`), `searchApi.search` (bare multi-bucket, `notes:[]` normalised since backend omits it). WIRED: KpiRow, MyWork/Agenda/Lineup cards (all `tasks.myWork()`), RecentActivityCard (`entry.actor`), SearchPage (listsById→useListMap; fixed 2 pre-existing errors). Build: 55 tsc (P5 −2), `vite build` ✓. ⚠️ LineupCard dropped per-task status pill (cross-list myWork tasks; no all-statuses endpoint); search `notes` always empty (no backend).
**Goal:** Dashboard + global search on real data.
**Depends-on:** P0, P1.
**Endpoints:** `GET /home/kpis` *(camelCase — skip R1)*, `GET /home/agenda` (bare array), `GET /tasks/my-work`, `GET /search`, `GET /activity/recent`, `GET /activity`.
**Files:** `pages/home/{HomePage,KpiRow,MyWorkCard,AgendaCard,RecentActivityCard,LineupCard}.tsx`, `pages/search/SearchPage.tsx`.
**Steps:** wire KPI tiles (whitelist `/home/kpis` from case-conversion), agenda + my-work (Task mapper; JWT-derived), search (**bare multi-bucket object**; drop the `notes` bucket — no backend), recent/full activity. `LineupCard` + `RecentActivityCard` currently bypass `mockApi` — convert to queries here.
**Acceptance:** home shows real KPIs + agenda + my-work + recent activity (no `userId` param); global search returns real tasks/lists/spaces/users (notes/comments buckets may be empty).

### ✅ P7 — Engineering tier — DONE
**Status:** ✅ DONE (2026-05-31). **P7a:** `sprintsApi`/`onCallApi`/`engineeringApi` + `mapOnCallShift` (on-call wire hydrates `engineer`); ReportBugButton (backend composes the Bug task), OnCallBadge (onCallApi.current), SprintBoardPage selector. **P7b:** EngineeringHomePage → one `GET /eng/home` rollup; OnCallRotationPage → full React-Query rewrite (`onCallApi.schedule` + `set` mutation — survives reload). Build: 54 tsc, `vite build` ✓. ⚠️ SprintBoard board reads a fixed `l-sprint` list (no cross-list tasks-by-sprint endpoint); OnCallRotation shows only assigned weeks. **🎉 P0–P7 = every FE screen wired to the real API.**
**Goal:** Sprints, on-call, eng-home on real data.
**Depends-on:** P0, P1, P2.
**Endpoints:** `GET /sprints`, `GET /sprints/active`, `GET /sprints/:id`, `POST /sprints`, `PATCH /sprints/:id`, `POST /sprints/:id/start|close`, `POST/DELETE /sprints/:id/tasks(/:taskId)`; `GET /on-call/current`, `GET /on-call/schedule`, `PUT/DELETE /on-call/:weekStart`; `GET /eng/home`, `POST /eng/report-bug`, `POST /eng/incidents/:id/postmortem`.
**Files:** `pages/engineering/{SprintBoardPage,OnCallRotationPage,EngineeringHomePage}.tsx`, `components/shared/{OnCallBadge,ReportBugButton}.tsx`.
**Steps:** create `useSprints`/`useSprints('active')` hooks (no FE namespace exists — `sprints` is a direct mock import; **bare array**); **fully rewrite `OnCallRotationPage`** (no React Query today — all local state, lost on reload) using the **OnCallShift** mapper; convert `activeSprint()`/`currentOnCallEngineerId()`/`sprintsById` sync imports; `EngineeringHome` → `GET /eng/home` + `GET /on-call/current`.
**Acceptance:** sprint selector loads from `GET /sprints`+`/active`; start/close + attach/detach tasks persist; on-call edits `PUT /on-call/:weekStart` survive reload; report-bug creates a task; eng-home shows real rollups.

### ✅ P8 — DONE — Comments §14 + Checklists §15 (built + wired)
**Built backend-from-scratch + FE-wired (2026-05-31).** §14 (4 ep: `GET`/`POST /tasks/:id/comments`, `PATCH`/`DELETE /comments/:id` — 1-level threading, 15-min edit window, @mention→notification, #TASK-ID→cross-task activity, soft-delete) and §15 (9 ep: checklists + checklist-items CRUD + `/items/bulk` `{texts}` + `/toggle`). Both routers mount at the v1 ROOT before `/tasks`; server `tsc` clean. `CommentsSection`/`ChecklistsSection` swapped off mock → new `commentsApi`/`checklistsApi`.

### ✅ Local-run completion pass — DONE — app runs on the real backend
Made the whole project locally testable: **(1)** fixed the critical `server/.env` mismatch (`PORT` 3000→**5501**, `FRONTEND_URL`→**http://localhost:5173** for CORS — client calls :5501, Vite serves :5173); **(2)** built the two FE-facing backend gaps — `POST /auth/change-password` + `GET /public/forms/:slug`; **(3)** took the last auth/public pages off mock (Forgot/Reset→`authApi`, Profile→change-password modal, PublicFormPage→`publicFormsApi`). Run steps + seeded login in **`LOCAL_RUN_GUIDE.md`**. Remaining V1 gaps (prod-build tsc on the dead mock layer, invite-accept page, SSE push, cross-list sprint board, files custom-field shape) are documented there — none block `npm run dev` local testing.

---

## 3. Per-resource contract matrix (reference)

| Resource | FE type (camel) | BE wire (snake) | Key endpoints | Adapter | Backend? | Phase |
|---|---|---|---|---|---|---|
| **Transport** | camel entities | snake + envelope | axios `/api/v1`, withCredentials | R1–R6 once | stub | **P0** |
| Auth login/me/refresh/logout | User/Credentials | `{access_token,expires_in,user}`; bare WireUser | `/auth/login,/me,/refresh,/logout` | in-mem token; `/auth/self→/me`; map user | yes | P0 |
| Forgot/reset password | void | 202 `{}` / 204 | `/auth/forgot-password,/reset-password` | reset body `new_password` | yes | P0 |
| Workspace | nested `settings` | FLAT | `GET/PATCH /workspace` | **Workspace mapper** (nest, day-names↔idx) | yes | P1 |
| Users/members | User[] | `{data,..}`/bare | `/users*`, `/users/invite`, role, (de)activate | unwrap; change-password = no backend | yes* | P1/P2 |
| Spaces | has workspaceId | no workspace_id | `/spaces*` (+ `/unarchive`) | unwrap; inject workspaceId | yes | P1 |
| Lists | has folderId | no folder_id | `/lists*`, `/spaces/:id/lists` | unwrap; folderId=null | yes | P1 |
| Statuses | Status[] | **bare** WireStatus[] | `/lists/:id/statuses*`, `/statuses/:id` | **no unwrap**; refactor sync imports (R8) | yes | P1 |
| Task types | has workspaceId | `{data,..}`; +is_dev_type | `/task-types*` | unwrap; `is_dev_type→isDevType` | yes | P2 |
| Tags | has workspaceId | `{id,name,color}` | `/tags*` (`?space_id=`) | unwrap; inject workspaceId | yes | P2 |
| **Tasks** | Task | `{data,..}`/bare + ETag | `/lists/:id/tasks`, `/tasks*`, bulk, my-work | unwrap + **Task mapper** + **ETag** | yes | P1/P2 |
| Membership | mutations | 204 | `/tasks/:id/assignees|watchers/self|tags` | camel→snake; invalidate `['task',id]` | yes | P3 |
| Dependencies | flat edges | `{blocks,blocked_by}` hydrated | `/tasks/:id/dependencies`, `/task-dependencies` | **flatten mapper** | yes | P3 |
| Attachments | type/size | bare; `mime_type`/`size_bytes`; 3-step | `/uploads/sign`,`/attachments/:id/finalize`,… | **no unwrap**; rewrite upload | yes | P3 |
| Custom fields (defs) | hiddenFromGuests,createdBy | **bare**; omits those | `/custom-fields*`, `/lists/:id/custom-fields` | **no unwrap**; guard undefined | yes | P3 |
| Custom field values | Task.customFields | bare WireTask + ETag | `PUT/DELETE /tasks/:id/custom-fields/:fieldId` | Task mapper; bumps ETag | yes | P3 |
| Task activity | ActivityLogEntry[] | `{data,..}`; actor hydrated | `GET /tasks/:id/activity` | unwrap; map actor | yes | P3 |
| **Comments §14** | Comment[] | **NONE** (tables only) | (no route) | stay mock | **no** | P8 |
| **Checklists §15** | Checklist[] | **NONE** (tables only) | (no route) | stay mock | **no** | P8 |
| Notifications | has userId | no user_id; body `string|null` | `/notifications*` | unwrap; **Notification mapper**; R7 | yes | P5 |
| Notification prefs | nested channels/events | flat map | `GET/PUT /notifications/preferences` | flat↔nested; push/quietHours FE-only | partial | P5 |
| Search | +notes bucket | bare multi-bucket; no notes | `GET /search` | **no unwrap**; drop notes | partial | P6 |
| Home KPIs | HomeKpiSet | **camelCase** (exception) | `GET /home/kpis` | **SKIP R1** | yes | P6 |
| Home agenda | Task[] | bare WireTask[] | `GET /home/agenda` | no unwrap; Task mapper | yes | P6 |
| Workspace activity | ActivityLogEntry[] | recent `{data}`/full `{data,pg}` | `/activity/recent`,`/activity` | unwrap; R8 usersById | yes | P6 |
| Forms | createdBy/updatedAt | no those; opaque blobs | `/forms*`, `/public/forms/:slug*` | unwrap submissions; `/fields/reorder` | yes* | P4 |
| Templates | structure typed | `{data,..}`; structure verbatim | `/templates*`, `/:id/apply` | unwrap; **don't case-convert structure** | yes* | P2/P7 |
| Sprints | direct mock import | **bare** WireSprint[] | `/sprints*` | new hooks; no unwrap; R8 | yes | P7 |
| On-call | `{weekStart,engineerId}` | `{week_start,week_end,engineer}` | `/on-call/current|schedule|:weekStart` | **OnCall mapper**; rewrite page | yes | P7 |
| Engineering | composite | report-bug/eng-home/postmortem | `/eng/*` | map nested task arrays | yes | P7 |
| SLA | KPI inline | bare SlaBreach[] | `/sla/breached`, `PATCH /tasks/:id/sla` | new namespace; no unwrap | yes | P7 |
| SSE | push | text/event-stream | `GET /stream/inbox` | EventSource (no axios) | yes | P5 |

\* partial — see §5 gaps.

---

## 4. No backend / keep-mocked-or-cut (V1)

**Tables exist, build-then-wire (P8):** §14 Comments, §15 Checklists.

**No backend at all — keep on mock OR remove from V1 nav:** 2FA (setup/enable/verify — also delete the dead `/login/2fa` branch in P1), invitation accept-flow, `change-password`, folders (flatten to Workspace→Space→List; drop the folder node in `SidebarSpaceTree`; `List.folderId=null`), time-tracking, personal notes, automations, dashboards+widgets, integrations/webhooks/api-keys, active-sessions UI, import/export, comment reactions/assignment.

**⚠️ Compile blockers — stub these FE type files** (imported by `mock-api.ts`; missing today, will break `tsc` the moment the mock layer is touched): `client/src/types/{automation,note,time-tracking,dashboard}.ts`.

**Backend gaps to coordinate with the backend track** (block specific built FE screens): `GET /public/forms/:slug` (P4 — thin route binding), `GET /auth/invitations/:token` + `POST /auth/accept-invitation` (AcceptInvitation), `POST /users/me/change-password` (ProfileSettings).

---

## 5. Definition of done (final cleanup, after P7)

1. Every `useQuery`/`useMutation` (≈121 across ~50 files) points at `api.*`, not `mockApi.*` — except the explicitly-mocked features in §4.
2. All R8 sync-import components read from React Query cache.
3. Delete `client/src/lib/mock-api.ts` + the `client/src/mocks/index.ts` barrel + unused fixtures (keep only any still feeding §4-mocked screens, isolated behind a flag).
4. `/login/2fa` branch removed; `setCurrentUser` coupling removed; `http/api.ts` matches real paths.
5. `tsc -b` + `vite build` clean; `eslint` clean.
6. Add at least smoke-level Vitest/RTL coverage for the auth bootstrap + one wired list/board flow, and an E2E check against a running backend.
7. A real BeautyBooth user can: log in → load workspace → browse spaces/lists → view/create/update tasks → use the task drawer → get notifications → (engineering) manage sprints/on-call — all persisted across reload.

---

*Generated from a 12-agent scan (frontend + backend + 50-row contract matrix + 9-phase critical path). Re-verify endpoint existence against the working tree before each phase — the backend was still being completed (uncommitted) when this was authored.*
