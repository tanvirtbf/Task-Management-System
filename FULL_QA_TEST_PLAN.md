# 🧪 Full-System QA Test Plan — BeautyBooth Task Management

> Goal: browser-test EVERY feature deeply, find any issue, fix it. The earlier
> "calendar could not create task" bug proved that a page can RENDER fine yet its
> ACTIONS (create/edit) silently fail with a "Could not …" toast. So this plan
> tests real user ACTIONS, not just rendering.

## 0. Environment (verified running)
- API `http://localhost:5501`, Web `http://localhost:5173`, MySQL `:3306` — all up.
- Login: `owner@company.local` / `Owner@12345`.
- Playwright 1.60 + browsers installed. Specs in `client/e2e/*.pw.ts`, run with
  `cd client && npx playwright test` against the live dev servers.

## 1. Test layers
1. **Automated API/logic suites** (already exist): server Jest (per-feature configs, ~2,800 cases) + client Vitest (`mappers`, `assistant`). These cover the backend contract + client transform logic.
2. **Comprehensive browser E2E** (Playwright) — the focus of this plan. Drives a real Chromium through every feature with real clicks/typing.

## 2. Issue-detection strategy (how a test "catches" a bug)
For every screen/flow capture ALL of:
- **Console errors / page errors** (filtered for known-benign noise).
- **Error toasts** — after any mutating action, assert NO `.ant-message-error`
  and no text matching `/could not|failed|error/i` appeared. (This is what would
  have caught the calendar bug.)
- **Functional assertion** — the created/edited thing actually appears / changes.
- **No auth-loss / blank page** — not redirected to `/login`, body not empty.

## 3. Feature test matrix (each must PASS in the browser)

### A. Auth & shell
- [ ] Login succeeds; wrong password shows error; session survives reload.
- [ ] Sidebar, Topbar, AI-assistant bubble render; no console errors.
- [ ] Logout returns to /login.

### B. Hierarchy
- [ ] Create Space (sidebar +). Appears in tree.
- [ ] Create List in the Space → auto-creates 5 statuses (To Do…Closed).
- [ ] Navigate Space → List.

### C. Tasks — List view
- [ ] Quick-add a task (Enter). Appears, no error toast.
- [ ] Inline edit name, **due date** (the fixed bug — must succeed), priority, status, assignee. Each: no error toast + value persists.
- [ ] Multi-select → bulk status / **bulk due date** / archive. No error toast.

### D. Board view
- [ ] Renders columns per status.
- [ ] Drag a card to another column → status changes, no error toast.

### E. Calendar view  ← the reported bug
- [ ] Click a date → modal → create task → **succeeds** (no "Could not create task").
- [ ] Drag an event to another date → reschedules, no error toast.

### F. Task detail drawer
- [ ] Open a task. Edit status/priority/assignee/due/tags. No error toasts.
- [ ] Description edit saves.
- [ ] Comments: add a comment (+ @mention). Appears.
- [ ] Checklists: add checklist + item, toggle. Progress updates.
- [ ] Subtasks: add a subtask.
- [ ] Dependencies: add a "blocks" link.
- [ ] Activity tab populated.
- [ ] Archive / delete the task.

### G. Inbox / notifications
- [ ] Renders; assigning a task to self produces a notification (poll ≤60s); mark read / snooze / archive — no error toast.

### H. Search
- [ ] Type a query → results across tasks/lists/spaces; click navigates.

### I. Forms
- [ ] Forms list renders; open builder (add/remove field, Save — no error toast).
- [ ] Public form (incognito-style / no auth) renders + submits → creates a task.

### J. Settings
- [ ] Profile → Change password (no error toast).
- [ ] Workspace settings save.
- [ ] Members: invite (no error toast); list renders.
- [ ] Task Types / Tags / Statuses / Custom Fields / Templates: create + edit + delete each — no error toast.

### K. Engineering
- [ ] Eng home renders (KPIs).
- [ ] Sprint board renders.
- [ ] On-Call: assign an engineer to a week — no error toast.
- [ ] Report a Bug → creates a Bug task.

### L. AI Help Assistant (newly built)
- [ ] Bubble opens; ask a HELP question → streamed reply (no error).
- [ ] Ask a DATA question ("how many tasks…") → tool-backed reply.

## 4. Execution order
1. Run existing automated suites (client Vitest; spot server Jest) — baseline.
2. Build a comprehensive `e2e/full.pw.ts` covering §3 A–L with action + no-error-toast assertions.
3. `npx playwright test` → collect failures (each = an issue).
4. Diagnose + FIX each issue (root-cause, like the calendar fix), re-run until green.
5. Re-confirm: full E2E green, zero unexpected console errors.

## 5. Issue log (filled during implementation — 2026-06-01)

**Results:** Playwright E2E **4/4 pass** (login+reload, 16-page route sweep w/ no console errors, create-task flow, full action sweep). Client Vitest **8/8 pass**. Issues found + fixed:

| # | Area | Symptom | Root cause | Fix | Status |
|---|------|---------|-----------|-----|--------|
| 1 | Calendar create (reported) | "Could not create task" when creating from a date click | FE sent `due_date` as a full ISO datetime; backend wants strict `YYYY-MM-DD` → 422 | Central date-only normalisation in `http/mappers.ts → taskToWire` (covers calendar / inline edit / bulk / recurrence) | ✅ Fixed — browser-verified |
| 2 | List view (empty list) | Empty list says "type in the inputs below each status" but those quick-add inputs aren't shown → no way to add the first task from List view | `ListView` only rendered the status groups (which contain quick-add) when ≥1 task existed | Render the status groups + quick-add even on an empty list | ✅ Fixed |
| 3 | Assistant client unit tests | 3 tests broke | Phase-6 added `res.headers.get("X-Conversation-Id")`; the Phase-4 test's mock `fetch` had no `headers` (real fetch always does) | Added `headers` to the mock response | ✅ Fixed |

**Reusable harness added:** `client/e2e/full.pw.ts` — action-level sweep with an error-toast watcher (`assertNoErrorToast`) + console/page-error capture. Extend it with more per-feature actions (settings CRUD, board drag, on-call, forms submit) as needed. Run: `cd client && npx playwright test`.

## 6. Exit criteria
- Comprehensive `full.pw.ts` E2E passes 100%.
- No mutating action produces a "Could not / Failed" toast.
- No unexpected console/page errors on any screen.
- Existing automated suites still green.
