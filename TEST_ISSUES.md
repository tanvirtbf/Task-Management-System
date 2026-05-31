# Test Issues Log — BeautyBooth Task Management

> Running log for **Step 1 (testing)**. One entry per issue, added **as it's found**, phase by phase.
> Companion to **`SYSTEM_TEST_PLAN.md`**. We fix these in **Step 2** (priority order).

**Severity:** P0 blocker · P1 major · P2 minor · P3 cosmetic
**Status:** CANDIDATE (found in pre-scan, confirm during testing) · OPEN (confirmed) · NOT-AN-ISSUE (checked, fine) · FIXED

**Entry format:**
```
### <ID> — [severity] <title>
- Phase / Status / Area
- Symptom:
- Evidence: <file:line | curl | screenshot>
- Suspected cause:
- Fix idea (Step 2):
```

---

## A. Pre-scan candidates (found by static audit — CONFIRM during the noted phase)

> These were surfaced by a code audit before live testing. Each is **confirmed present in code** but its real-world impact must be verified in the browser/API during the noted phase. Don't fix yet (Step 2).

### PRESCAN-1 — [P1] "Bug" task special UI gated on hardcoded `"tt-bug"`
- **Phase:** 3 / 12 · **Status:** ✅ FIXED (Step 2 — name-based detection via `useTaskTypeMap` `?.name.toLowerCase()==="bug"`; tsc 0) · **Area:** Task detail (properties)
- **Symptom (predicted):** A task whose type is *Bug* won't show the severity badge / bug-specific fields, because the code compares the task's type id against the literal `"tt-bug"`, which never matches a real (randomly-generated) task-type id.
- **Evidence:** `client/src/components/task/TaskPropertiesPanel.tsx:34` → `const isBug = task.taskTypeId === "tt-bug";`
- **Suspected cause:** hardcoded mock id (real ids look like `tt-YvyAjChmcc5D...`).
- **Fix idea (Step 2):** resolve the type via `useTaskTypeMap` and compare by **name** (`"Bug"`) or add a stable category/flag on task types.

### PRESCAN-2 — [P1] Bug/Incident drawer sections gated on `"tt-bug"` / `"tt-incident"`
- **Phase:** 3 / 12 · **Status:** ✅ FIXED (Step 2 — name-based detection via taskType `?.name.toLowerCase()` for bug + incident; tsc 0) · **Area:** Task detail drawer
- **Symptom (predicted):** `BugFieldsSection`, `PostmortemChecklist`, `GitIntegrationPanel`, SLA badge etc. never render for real bug/incident tasks.
- **Evidence:** `client/src/components/task/TaskDetailDrawer.tsx:67-68` → `isBug = task?.taskTypeId === "tt-bug"`, `isIncident = task?.taskTypeId === "tt-incident"`.
- **Suspected cause:** same hardcoded-mock-id pattern as PRESCAN-1.
- **Fix idea (Step 2):** same as PRESCAN-1 (name/flag-based detection), applied to both gates.

### PRESCAN-3 — [P2?] Custom-field create sends hardcoded `workspaceId:"ws-main"` + `createdBy:"u-001"`
- **Phase:** 1E · **Status:** ✅ NOT-AN-ISSUE (verified Phase 1E — create returned 201; backend ignores the hardcoded ids)
- **Symptom (predicted):** possibly none — verify the create **succeeds** against the real backend.
- **Evidence:** `client/src/pages/settings/CustomFieldsSettings.tsx:413,423`.
- **Suspected cause:** leftover mock ids in the create payload.
- **Fix idea (Step 2):** drop the two fields from the payload (cosmetic cleanup) — only if confirmed harmless; escalate if it actually 4xx's.

### PRESCAN-4 — [P3] Sidebar default-expanded references mock space id `"sp-ops"`
- **Phase:** 12 · **Status:** ✅ FIXED (Step 2 — `expandedIds: []` default; clear site-data to drop a stale persisted value) · **Area:** Sidebar (persisted UI store)
- **Symptom (predicted):** cosmetic — a non-existent space id in the persisted expanded list; no error. May also be stale in your browser localStorage.
- **Evidence:** `client/src/stores/ui.ts:28` → `expandedIds: ["sp-ops"]`.
- **Fix idea (Step 2):** default to `[]`.

### PRESCAN-5 — [P1/P2] Sprint board only reads a hardcoded `l-sprint` list
- **Phase:** 10 · **Status:** ✅ FIXED (Step 2 — new backend `GET /sprints/:id/tasks` (cross-list, hydrated; `TasksRepo.findBySprintInWorkspace` + `TasksService.listBySprint`); FE board reworked to fetch `sprintsApi.tasks(sprintId)` + render a cross-list card grid, dropping the hardcoded `l-sprint`. Verified: endpoint returns the attached task; Playwright route-sweep now FULLY GREEN incl. /eng/sprint) · **Area:** Engineering / Sprint board
- **Symptom (predicted):** the sprint board's columns/cards stay empty even with an active sprint, because tasks are fetched from a fixed `l-sprint` list id that won't exist in real data (a sprint's tasks actually span lists). The sprint *selector* itself is real.
- **Evidence:** `client/src/pages/engineering/SprintBoardPage.tsx` (hardcoded sprint list id; documented modeling gap).
- **Suspected cause:** no cross-list "tasks by sprint" endpoint; board wired to a placeholder list.
- **Fix idea (Step 2):** add/define a tasks-by-sprint read, or filter `tasksApi` by `sprintId` across the workspace.

### PRESCAN-6 — [P3] Board WIP-limit demo defaults reference mock list `l-fb-orders`
- **Phase:** 12 · **Status:** ✅ FIXED (Step 2 — `wipLimits: {}` default) · **Area:** Board (persisted store)
- **Symptom (predicted):** cosmetic — demo WIP limits keyed to a mock list never apply to real lists.
- **Evidence:** `client/src/stores/board.ts:40-42`.
- **Fix idea (Step 2):** start `wipLimits: {}`.

---

## B. Known V1 limitations (BY DESIGN — track, do not re-log as bugs)

- Public form renders custom fields as plain text inputs (rich types unsupported anonymously) — `{text}` envelope on submit.
- Invitation accept-link page (`/invitation/:token`) is an informational stub (no backend accept flow yet).
- Live notifications use 60s polling (no SSE push).
- Attachments require valid Cloudflare R2 credentials in `server/.env`.
- `/settings/import-export` likely has no backend.
- `npm run dev` is the supported run mode (prod build is green too; mock layer excluded).

---

## C. Issues confirmed during testing (filled in per phase)

### ISSUE-001 — [P1] Public form submission fails (422) when the form's list has no default task type
- **Phase:** 7 · **Status:** ✅ FIXED (Step 2 — `TaskWriteService.create` now falls back to the workspace's first task type when neither a body value nor a list default exists; verified live: form submit & direct create on a no-default list → 201 with a resolved `task_type_id`) · **Area:** Forms / public intake
- **Symptom:** `POST /public/forms/:slug/submit` → **422 `task.invalid_task_type`** when the form's target list has no `default_task_type_id`. Reproduced live: submit → 422; after `PATCH /lists/:id {default_task_type_id}` the same submit → **201** (task created). So public intake silently breaks for the common case.
- **Evidence:** Phase 7 curl — submit (list w/o default) → `422 task.invalid_task_type`; (list w/ default) → `201 task_id=t-w0TNsp…`.
- **Suspected cause:** the form-submit task-creation path (`FormsService.submit` → `TaskWriteService.create`) resolves type as `task_type_id ?? list.defaultTaskTypeId`; the submit passes none, and the FE `CreateListModal` never sets a list default (same root family as the original create-task bug). Most lists → no default → forms can't create tasks.
- **Fix idea (Step 2):** server-side, fall back to any workspace task type when the list has no default on the public-submit path (mirrors the FE `useCreateTask` fallback); OR set a list default at list-create; OR give forms their own task_type_id.
- **Minor to-verify:** `GET /forms/:id/submissions` read count=2 after one successful + one failed (422) submit — possibly the failed attempt left an orphan submission row; verify whether a failed submit records a submission.

### ISSUE-002 — [P2] "Report a bug" → 409 `eng.not_configured` (no "Bug Triage" list) + FE shows generic error
- **Phase:** 10 · **Status:** ✅ FIXED (Step 2 — created a "Bug Triage" list → report-bug verified **201**; FE now surfaces the server's actionable message via `err.message`. Optional follow-up: seed a Bug Triage list for fresh installs) · **Area:** Engineering / report-bug
- **Symptom:** `POST /eng/report-bug` (valid body) → **409 `eng.not_configured`** — *"This workspace has no \"Bug Triage\" list; create one before reporting bugs"*. The seed/UI never creates a list named "Bug Triage", so the sidebar **"Report a bug"** button fails on a default workspace. The FE swallows the helpful message and shows a generic *"Could not create bug"*.
- **Evidence:** Phase 10 curl → 409 `eng.not_configured`. Backend resolves the list by name: `EngineeringRepo.ts:93` `lower(lists.name)='bug triage'`; `EngineeringService.ts:188-189`. FE `ReportBugButton.tsx:54` → `onError: () => message.error("Could not create bug")` (ignores `err.message`). (A "Bug" task type IS seeded ✓; only the "Bug Triage" list is missing.)
- **Backend is correct/graceful** (clear 409) — this is a setup gap + a generic FE toast.
- **Fix idea (Step 2):** (a) seed/auto-provision a "Bug Triage" list (or relax the match to any bug list), and/or (b) surface `err.message` in the FE error toast so the user knows to create the list.

### ISSUE-003 — [P1] Home page CRASHES (RecentActivityCard) when an activity entry has null `context`
- **Phase:** Browser (Playwright) · **Status:** ✅ FIXED (Step 2 — optional-chained `entry.context?.`; verified: login/session test passes, home renders, sweep clean except PRESCAN-5) · **Area:** Home dashboard (landing page)
- **Symptom:** After login you land on `/` (home), which **crashes into the React Router ErrorBoundary**: `TypeError: Cannot read properties of null (reading 'taskName')`. `RecentActivityCard` maps recent-activity entries and reads `entry.context.taskName` / `entry.context.listName` without guarding `context`, which is **`null`** for activity rows with no context payload → the whole landing page white-screens/error-boundaries whenever recent activity contains a null-context row (common after normal use).
- **Evidence:** Playwright route-sweep — **only `/` throws** (the other 15 routes render fine); stack → `client/src/pages/home/RecentActivityCard.tsx` (`entry.context.taskName` ~line 146, `entry.context.listName` ~line 156). The sibling `actor` field IS guarded (`actor?.firstName`); `context` is not.
- **Fix idea (Step 2):** optional-chain `context` → `entry.context?.taskName` / `entry.context?.listName`.
- **Note (benign, NOT a bug):** the sweep also logs transient `401 Unauthorized` on every **hard reload** — the in-memory access token is lost on reload, so bootstrap's first call 401s then the interceptor refreshes+retries (recovers). Console noise on F5 only; in-app navigation never triggers it.

> _(newest entries above this line)_

<!-- ### ISSUE-001 — [Px] <title>
- Phase / Status: OPEN / Area
- Symptom:
- Evidence:
- Suspected cause:
- Fix idea (Step 2): -->
