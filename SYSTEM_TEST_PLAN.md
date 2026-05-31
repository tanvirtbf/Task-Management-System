# System Test Plan — BeautyBooth Task Management

> **Process (agreed):**
> - **Step 1 — TEST.** Go phase by phase. When you say *"phase N koro"*, I run that phase's checks. **Every issue found is written immediately to `TEST_ISSUES.md`** (a separate file) — one entry per issue, as it's found.
> - **Step 2 — FIX.** After Step 1 is done, we solve the logged issues one by one.
>
> This file is the **plan only**. The running issue log lives in **`TEST_ISSUES.md`**.

---

## How testing is done (methods & honesty about tooling)

| Method | Who runs | Catches | Tool |
|---|---|---|---|
| **[API]** integration tests | **I run** | functional / contract bugs (the main class — e.g. the create-task 422 we found) | `curl` against the live server on `:5501` — this sends the *exact* requests the browser sends |
| **[CODE]** static audit | **I run** | wiring bugs, hardcoded mock-ids, wrong payload shapes | `Read` / `Grep` |
| **[BUILD]** typecheck/build | **I run** | type/compile regressions | `npm run build`, `tsc` |
| **[BROWSER]** visual / interaction | **You run** (I give exact click-by-click steps + what to look for) | rendering, drag-drop, console errors, UX feel | Chrome devtools (Console + Network tabs open) |

> ⚠️ **On "browser testing":** I do **not** have a browser-automation tool, so I cannot click through the UI myself. My `[API]` tests reproduce *exactly what each screen's button/form sends to the backend*, which catches the overwhelming majority of "X doesn't work" bugs (it's how we caught the task-create bug). For purely-visual things (layout, drag-drop animation, console errors) I'll give you a tight checklist to eyeball. **Optional:** if you want fully-automated browser E2E, I can set up Playwright in a later phase (extra install + ~Chromium download) — tell me and I'll add it.

---

## Test environment

- **API:** `http://localhost:5501/api/v1` (server running, `/health` = 200 ✅)
- **Web:** `http://localhost:5173`
- **Login:** `owner@company.local` / `Owner@12345`
- **Current data in your running DB:** 1 space (*Engineering*), 1 list (*Bugs*), 7 task types, 1 task (*My first task*). 
- **For a clean run:** `cd server && npm run db:setup:fresh && npm run db:seed` (the seed now creates 6 task types).
- **⚠️ Browser localStorage caveat:** the `ui` and `board` zustand stores are *persisted* and ship with mock defaults (`expandedIds:["sp-ops"]`, WIP limits for `l-fb-orders`). If you see odd sidebar/WIP state, clear site data for `localhost:5173` once.

---

## Severity legend (used in TEST_ISSUES.md)

- **P0 — Blocker:** core flow impossible (e.g. can't create a task, can't log in).
- **P1 — Major:** a feature is broken / wrong data, but workaround exists.
- **P2 — Minor:** edge case, cosmetic-functional, or degraded UX.
- **P3 — Cosmetic:** visual only.

---

## Phase index

| Phase | Area | Primary method |
|---|---|---|
| 0 | Foundation: health, auth, CORS, routing | [API] [BROWSER] |
| 1 | Reference data & settings CRUD (workspace, users, task-types, tags, custom-fields, statuses) | [API] [BROWSER] |
| 2 | Hierarchy: spaces & lists (+ status auto-seed) | [API] [BROWSER] |
| 3 | Tasks core: create / read / update / lifecycle / bulk | [API] [BROWSER] |
| 4 | Task sub-resources: membership, dependencies, activity, custom-field values | [API] [BROWSER] |
| 5 | Comments (§14) & Checklists (§15) | [API] [BROWSER] |
| 6 | Attachments (Cloudflare R2) | [API] [BROWSER] |
| 7 | Forms (admin builder + public intake) | [API] [BROWSER] |
| 8 | Notifications (inbox, bell, prefs) | [API] [BROWSER] |
| 9 | Home / Search / Activity | [API] [BROWSER] |
| 10 | Engineering: sprints, on-call, eng-home, SLA, report-bug | [API] [BROWSER] |
| 11 | Templates (CRUD + apply) | [API] [BROWSER] |
| 12 | Cross-cutting: 401-refresh, empty states, known mock-id suspects, console sweep | [CODE] [BROWSER] |

> Phases are dependency-ordered: 0→2 build the base data the later phases need. Run them in order the first time.

---

## PHASE 0 — Foundation (health, auth, CORS, routing)

**Goal:** prove the two servers talk, auth works end-to-end, and every route resolves.

| # | Test | Method | Expected |
|---|---|---|---|
| 0.1 | `GET /health` | [API] | 200 |
| 0.2 | Login with correct creds | [API] | 200 `{access_token, expires_in, user}` |
| 0.3 | Login with wrong password | [API] | 401 `auth.invalid_credentials` |
| 0.4 | `GET /auth/me` with token | [API] | 200, owner user (no `password_hash`) |
| 0.5 | `GET /auth/me` without token | [API] | 401 |
| 0.6 | CORS preflight from `Origin: http://localhost:5173` | [API] | `access-control-allow-origin: http://localhost:5173` + `allow-credentials: true` |
| 0.7 | `POST /auth/refresh` (cookie flow) | [API] | 200 new token (or 401 if no cookie — note: curl can't hold the httpOnly cookie like the browser; mainly a [BROWSER] check) |
| 0.8 | `POST /auth/logout` / `logout-all` | [API] | 204 |
| 0.9 | Every route in `router.tsx` loads without crash | [BROWSER] | each of `/`, `/inbox`, `/search`, `/eng`, `/eng/sprint`, `/eng/on-call`, `/settings/*` (9 tabs), `/s/:id`, `/s/:id/l/:id`, `/forms`, `/forms/:id/edit`, `/login`, `/forgot-password`, `/forms/:slug` renders; **0 red console errors** |
| 0.10 | Login → redirect to `/`; refresh page stays logged in (token bootstrap) | [BROWSER] | session survives reload |

**Pass criteria:** 0.1–0.8 green via curl; 0.9–0.10 confirmed in browser with no console errors.

---

## PHASE 1 — Reference data & settings CRUD

**Goal:** every workspace-level CRUD works (these feed everything else).

### 1A. Workspace [API]+[BROWSER]
- `GET /workspace` → 200. `PATCH /workspace` (name/timezone/locale) → 200, persists. Browser: `/settings/workspace` save.

### 1B. Users / Members [API]+[BROWSER]
| # | Test | Expected |
|---|---|---|
| 1.1 | `GET /users` | 200 `{data}` incl. owner |
| 1.2 | `POST /users/invite {firstName,lastName,email,role}` | 201 invited user |
| 1.3 | `PATCH /users/:id/role {role}` | 200 |
| 1.4 | `POST /users/:id/deactivate` / `reactivate` | 204 |
| 1.5 | `PATCH /users/:id` (profile) | 200 |
| 1.6 | `POST /users/:id/reset-password` | 202 |
| 1.7 | guards: can't deactivate owner / change own role | 403 |
- Browser: `/settings/members` — invite modal, role dropdown, deactivate.

### 1C. Task Types [API]+[BROWSER]
- `GET/POST/PATCH/DELETE /task-types`. Browser: `/settings/task-types` create (name/color/icon/isDevType), edit, delete.

### 1D. Tags [API]+[BROWSER]
- `GET/POST/PATCH/DELETE /tags`. Browser: `/settings/tags`.

### 1E. Custom Fields [API]+[BROWSER]
- `GET /custom-fields`, `POST` (text/dropdown/date/money/phone/files), `PATCH`, `DELETE`.
- **CONFIRM pre-scan candidate (TEST_ISSUES PRESCAN-3):** the create modal sends hardcoded `workspaceId:"ws-main"` + `createdBy:"u-001"`. Verify the create still **succeeds** (backend should ignore them, JWT-derived). If it 4xx's → real bug.
- Browser: `/settings/custom-fields` create each type.

### 1F. Statuses [API]+[BROWSER]
- `GET /lists/:listId/statuses`, `POST`, `PATCH /statuses/:id`, `DELETE`, `PATCH /lists/:listId/statuses/reorder`. (Needs a list — see Phase 2.) Browser: `/settings/statuses` overview.

**Pass criteria:** every CRUD returns the right status + the change is readable back.

---

## PHASE 2 — Hierarchy (Spaces & Lists)

**Goal:** build the structural backbone + confirm list-create auto-seeds statuses.

| # | Test | Method | Expected |
|---|---|---|---|
| 2.1 | `GET /spaces`, `POST /spaces`, `PATCH`, `POST /:id/archive` + `/unarchive`, `DELETE` | [API] | full lifecycle |
| 2.2 | `GET /lists`, `GET /spaces/:id/lists`, `GET /lists/:id`, `POST /lists`, `PATCH`, archive/unarchive, `DELETE` | [API] | full lifecycle |
| 2.3 | **Create a list → immediately `GET /lists/:id/statuses`** | [API] | returns the **5 default statuses** (To Do / In Progress / In Review / Done / Closed) |
| 2.4 | Delete guards: delete non-empty/non-archived space or list | [API] | 409 (`space.not_empty` / `list.not_empty` etc.) |
| 2.5 | Sidebar tree, "+ Space", "+ List" modals; space page shows list cards | [BROWSER] | renders + persists; navigates into list |

**Pass criteria:** can create space→list and the list comes with 5 statuses (so Board view works).

---

## PHASE 3 — Tasks core

**Goal:** the heart of the app. (Create was just fixed — re-verify thoroughly.)

| # | Test | Method | Expected |
|---|---|---|---|
| 3.1 | `POST /tasks {primary_list_id,name,task_type_id}` | [API] | **201** (regression of the fixed bug) |
| 3.2 | `POST /tasks` **without** task_type_id, list has no default | [API] | 422 `task.invalid_task_type` (documents the requirement) |
| 3.3 | FE quick-add path: confirm `useCreateTask` injects `taskTypes[0].id` | [CODE] | code sends a task_type_id |
| 3.4 | `GET /lists/:id/tasks`, `GET /tasks/:id`, `GET /tasks/:id/subtasks`, `GET /tasks/my-work` | [API] | correct shapes (`{data,pagination}` vs bare) |
| 3.5 | `PATCH /tasks/:id` (name, priority, status_id, due_date) | [API] | 200; invalid status_id → 422 `task.invalid_status` |
| 3.6 | ETag / `If-Match`: stale update | [API] | 409 `task.conflict` (if If-Match sent) |
| 3.7 | archive / unarchive / soft-delete / hard-delete (`?hard=true`) | [API] | correct codes; hard-delete owner-only |
| 3.8 | `POST /tasks/bulk` (status/priority/assignee deltas) | [API] | 200 updated set |
| 3.9 | List / Board / Calendar render tasks; inline edits (status, priority, assignee, due-date); **board drag between columns** → status persists; **calendar drag** → due-date persists | [BROWSER] | each persists after reload |
| 3.10 | **CONFIRM pre-scan candidate (PRESCAN-1):** open a task whose type is "Bug" → does the drawer show bug-specific UI (severity/SLA/git/bug-fields)? | [BROWSER]+[CODE] | Expected **NO** today (gated on hardcoded `taskTypeId === "tt-bug"`). Log as confirmed if so. |

**Pass criteria:** create/read/update/lifecycle all green via API; views render + DnD persists in browser.

---

## PHASE 4 — Task sub-resources

**Goal:** everything inside the task drawer except comments/checklists/attachments.

| # | Test | Method | Expected |
|---|---|---|---|
| 4.1 | assignees: `POST /tasks/:id/assignees`, `DELETE …/:userId` | [API] | 204; task reflects assignee |
| 4.2 | watchers: `POST`/`DELETE /tasks/:id/watchers/self` | [API] | 204 |
| 4.3 | tags: `POST /tasks/:id/tags`, `DELETE …/:tagId` | [API] | 204 |
| 4.4 | dependencies: `POST /task-dependencies` (blocks) | [API] | 201 |
| 4.5 | dependency cycle (A blocks B, B blocks A) | [API] | 422 `dep.cycle` |
| 4.6 | dependency duplicate / delete | [API] | 409 dup; 204 delete |
| 4.7 | `GET /tasks/:id/activity` | [API] | `{data}` actor-hydrated feed |
| 4.8 | custom-field VALUE: `PUT /tasks/:id/custom-fields/:fieldId` per type (text `{text}`, dropdown `{option_id}`, date `{date}`, money `{amount,currency}`), `DELETE` clear | [API] | 200 full task / 204 |
| 4.9 | Browser: drawer — assignee chips, tag picker, dependency add+navigate, custom-field editors, activity log | [BROWSER] | each persists |

---

## PHASE 5 — Comments (§14) & Checklists (§15)

| # | Test | Method | Expected |
|---|---|---|---|
| 5.1 | `POST /tasks/:id/comments {body}` | [API] | 201 |
| 5.2 | reply: `POST … {body, parent_comment_id}` | [API] | 201 nested under top-level |
| 5.3 | reply to a reply | [API] | 422 `comment.reply_to_reply` |
| 5.4 | edit own comment within 15 min: `PATCH /comments/:id` | [API] | 200 `edited_at` set |
| 5.5 | edit after window (simulate) / by non-author | [API] | 403 `comment.edit_window_expired` / `comment.not_author` |
| 5.6 | delete (author or admin) → tombstone | [API] | 204; GET shows body `[deleted]` |
| 5.7 | `@mention` a user in a comment | [API] | a `mentioned` notification appears for that user (cross-check Phase 8) |
| 5.8 | `#TASK-ID` reference | [API] | `comment_referenced` activity on the referenced task |
| 5.9 | checklists: `GET/POST /tasks/:id/checklists`, `PATCH`/`DELETE /checklists/:id` | [API] | full lifecycle |
| 5.10 | items: `POST /checklists/:id/items`, `/items/bulk {texts}`, `PATCH`/`POST …/toggle`/`DELETE /checklist-items/:id` | [API] | 201/200/204; toggle stamps completed_by/at |
| 5.11 | toggle + item-edit write `task_activity` | [API] | activity rows appear |
| 5.12 | Browser: comments compose/reply/delete; @mention render; checklists create/add/toggle/progress bar | [BROWSER] | works visually |

---

## PHASE 6 — Attachments (Cloudflare R2)

| # | Test | Method | Expected |
|---|---|---|---|
| 6.1 | `POST /uploads/sign {scope_type,scope_id,filename,mime_type,size_bytes}` | [API] | 200 `{attachment_id, upload_url, fields}` |
| 6.2 | PUT bytes to `upload_url` | [API] | 200 (depends on **valid R2 creds**) |
| 6.3 | `POST /attachments/:id/finalize` | [API] | 200 attachment row |
| 6.4 | `GET /tasks/:id/attachments` | [API] | bare list, fresh signed url |
| 6.5 | download (302) / `DELETE /attachments/:id` | [API] | 302 / 204 |
| 6.6 | Browser: drag-drop upload in drawer → thumbnail → download → delete | [BROWSER] | works (or fails at PUT if R2 not configured — log as env-dependent) |

> If 6.2 fails, it's almost certainly the Cloudflare R2 credentials in `.env`, not the code — log as **environment** issue, not a code bug.

---

## PHASE 7 — Forms (admin builder + public intake)

| # | Test | Method | Expected |
|---|---|---|---|
| 7.1 | `POST /forms {list_id,title}`, `GET /forms`, `GET /forms/:id`, `GET /lists/:id/forms`, `PATCH`, `DELETE` | [API] | full lifecycle |
| 7.2 | fields: `POST /forms/:id/fields`, `PATCH /form-fields/:id`, `DELETE`, `PATCH /forms/:id/fields/reorder` | [API] | 201/200/204 |
| 7.3 | **public GET** `GET /public/forms/:slug` (no auth) | [API] | 200 public projection (title/branding/fields) |
| 7.4 | **public submit** `POST /public/forms/:slug/submit {data}` | [API] | 201 `{submission_id, task_id}` → a task is created |
| 7.5 | `GET /forms/:id/submissions` | [API] | `{data,pagination}` |
| 7.6 | Browser: `/forms` create; `/forms/:id/edit` add/reorder (drag) fields, publish; open `/forms/:slug` in **incognito**, submit | [BROWSER] | task created from submission |

> Known V1 limit: public form renders custom fields as plain text inputs (rich types unsupported anonymously). Confirm task_attr fields submit fine; note custom-field behavior.

---

## PHASE 8 — Notifications

| # | Test | Method | Expected |
|---|---|---|---|
| 8.1 | `GET /notifications`, `GET /notifications/unread-count` | [API] | feed + count |
| 8.2 | trigger one (assign a task to a 2nd user, or @mention) then list as that user | [API] | notification present |
| 8.3 | `POST /:id/read`, `/unread`, `/mark-all-read`, `/:id/snooze`, `DELETE /:id` | [API] | 204/200 |
| 8.4 | `GET`/`PUT /notifications/preferences` | [API] | map round-trips |
| 8.5 | Browser: inbox list, mark read/snooze/delete; bell badge updates (60s polling — may lag up to 1 min) | [BROWSER] | works |

---

## PHASE 9 — Home / Search / Activity

| # | Test | Method | Expected |
|---|---|---|---|
| 9.1 | `GET /home/kpis` | [API] | KPI set (camelCase) |
| 9.2 | `GET /tasks/my-work` | [API] | 5 buckets |
| 9.3 | `GET /activity/recent?limit=10` | [API] | actor-hydrated `{data}` |
| 9.4 | `GET /search?q=...&types=...` | [API] | tasks/lists/spaces/users/comments buckets |
| 9.5 | Browser: home cards populate; search returns + navigates | [BROWSER] | works (notes bucket always empty — expected) |

---

## PHASE 10 — Engineering (sprints, on-call, eng-home, SLA, report-bug)

| # | Test | Method | Expected |
|---|---|---|---|
| 10.1 | sprints: `GET /sprints`, `/sprints/active` (404→null), `POST`, `PATCH`, `POST /:id/start`, `/close`, `POST /:id/tasks`, `DELETE /:id/tasks/:taskId` | [API] | lifecycle |
| 10.2 | on-call: `GET /on-call/current`, `/schedule`, `PUT /on-call/:weekStart`, `DELETE` | [API] | upsert + read |
| 10.3 | `GET /eng/home` | [API] | rollup (openBugs/mySprintTasks/…/currentOnCall/activeSprint) |
| 10.4 | `POST /eng/report-bug` | [API] | composes a Bug task (201) |
| 10.5 | `GET /sla/breached` | [API] | bare list |
| 10.6 | **CONFIRM pre-scan candidate (PRESCAN-5):** Sprint board only reads a hardcoded `l-sprint` list | [CODE]+[BROWSER] | board likely empty even with an active sprint → log |
| 10.7 | Browser: `/eng` tiles + cards; `/eng/sprint` selector; `/eng/on-call` set/persist-on-reload | [BROWSER] | renders; on-call survives reload |

---

## PHASE 11 — Templates

| # | Test | Method | Expected |
|---|---|---|---|
| 11.1 | `GET /templates`, `?type=`, `GET /:id`, `POST`, `PATCH`, `DELETE` | [API] | lifecycle |
| 11.2 | `POST /templates/:id/apply {task_name,list_id,anchor_date}` | [API] | 201 → spawns task + materialised checklist |
| 11.3 | Browser: `/settings/templates` create + apply | [BROWSER] | task appears in target list |

---

## PHASE 12 — Cross-cutting & known mock-id suspects

| # | Test | Method | Expected |
|---|---|---|---|
| 12.1 | Access-token expiry → `POST /auth/refresh` auto-retry (interceptor) | [BROWSER] | request retries transparently; no logout loop |
| 12.2 | Error surfaces: trigger a 422/404/403 | [BROWSER] | a readable toast, not a blank screen |
| 12.3 | Empty states across screens (fresh workspace) | [BROWSER] | friendly empty messages, no crash |
| 12.4 | **PRESCAN-1/2:** `taskTypeId === "tt-bug"` / `"tt-incident"` gates (TaskPropertiesPanel:34, TaskDetailDrawer:67-68) | [CODE] | confirm bug/incident special UI never shows on real data → log |
| 12.5 | **PRESCAN-4:** `ui.ts` `expandedIds:["sp-ops"]` persisted default | [CODE] | confirm cosmetic; note "clear localStorage" |
| 12.6 | **PRESCAN-6:** `board.ts` WIP defaults for `l-fb-orders` | [CODE] | confirm cosmetic |
| 12.7 | Console-error sweep: open every screen with devtools Console | [BROWSER] | catalog any red errors/warnings |
| 12.8 | `import-export` route (`/settings/import-export`) | [API]+[BROWSER] | likely **no backend** — confirm + log as known-gap |

---

## Appendix — base-data setup (used by phases 3+)

When a phase needs data, I'll run a curl chain like:
```
login → POST /spaces → POST /lists (auto-seeds statuses) → ensure ≥1 task type → POST /tasks → ...
```
(Your running DB already has Engineering/Bugs/7 task types/1 task, so most phases can reuse that.)

---

## After Step 1

Once all phases are run and `TEST_ISSUES.md` is complete, we move to **Step 2** and fix issues in priority order (P0 → P3), one at a time, re-testing each.
