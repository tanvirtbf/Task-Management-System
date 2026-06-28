# 🧪 LAYER C — Deep Test Plan (Tasks: Core · Views · Relations · Collaboration)

> **Goal:** Layer C — **M7 Tasks Core · M8 Views · M9 Relations · M10 Collaboration** — pura test kore **zero-issue** kora. Ei layer-tai app-er **core ar shob theke boro**. Ami (Claude) execute korbo, phase dhore.
>
> **Methodology** (Layer A/B-proven): protita module-e → (1) baseline suite run → (2) service **adversarial review** (real bug: concurrency/ETag/cascade/FK/trigger/value-validation) → (3) **coverage-gap** analysis → (4) bug fix + gap fill + re-verify green → (5) cross-cutting → (6) frontend E2E (browser).
>
> Started: 2026-06-27 · ভিত্তি: [[LAYER_A_TEST_PLAN]] + [[LAYER_B_TEST_PLAN]] (both done, zero-issue), MODULE_TEST_BREAKDOWN.md.
>
> ## ⚠️ Layer C-te known BIG gap
> **Comments (§14) + Checklists (§15) built ache kintu kono backend test NAI** (13 endpoint: comments 4 + checklists 9). Amar prothom scan + [[project_api_baseline]] dutoi eta confirm kore. **Eta-i Layer C-r main kaj** — comprehensive test suite likha + untested code-ta adversarially review kora (untested code-e bug thakar shomvabona shob theke beshi, jemon Layer A-r forgot-password deadlock-ta test cholar shomoy dhora porechilo).

---

## 📊 Scope — Layer C endpoints + suites + test status

| Module | Endpoints | Suite | Test status |
|---|---|---|---|
| **M7 Tasks Core** | create · bulk · get · update(ETag) · archive · unarchive · delete(soft/hard) · my-work · subtasks · list-read(§10) · activity(§13) (~16) | `jest.tasks.config.cjs` + `jest.tasks10.config.cjs` | ✅ tested |
| **M8 Views** | List / Board / Calendar (frontend) — backend = `GET /lists/:id/tasks` (filter/sort/cursor) | (frontend) | FE only |
| **M9 Relations** | membership: assignees/watchers/tags (×6) · dependencies (×3) · subtasks-read | `jest.membership.config.cjs` + `jest.taskdeps.config.cjs` | ✅ tested |
| **M10 Comments** | GET/POST `/tasks/:id/comments` · PATCH/DELETE `/comments/:id` (4) | **❌ NO suite** | 🔴 **GAP** |
| **M10 Checklists** | checklist CRUD · items add/bulk/update/toggle/remove · sub-items (9) | **❌ NO suite** | 🔴 **GAP** |
| **M10 Attachments** | sign · finalize · download · delete · list · upload (6) | `jest.attachments.config.cjs` | ✅ tested |
| **M10 Activity** | `GET /tasks/:id/activity` | `jest.tasks.config.cjs` | ✅ tested |

---

## 🎯 Bug-hunt focus (per module)

**M7 Tasks Core:**
- ETag (`If-Match`) → 409 `task.conflict` concurrency
- nesting depth ≤2 guard · bulk create atomicity (≤200, fail-atomic)
- trigger-maintained counters (subtasks/comments/attachments_count) — app never writes them
- SLA auto-compute (Bug S0=2h/S1=24h/S2=7d, Complaint=24h)
- cursor pagination (keyset on internal_id) · soft vs `?hard=true` delete (owner/admin)
- archive cascade to subtasks · custom_id resolution

**M9 Relations:**
- dependency self-loop (422) / cycle BFS (422 `dep.cycle`) / duplicate (409) guards
- membership idempotency (re-add = no error) · auto-watch on assign
- dependency hydration (both directions, no N+1)

**M10 Collaboration — MAIN FOCUS:**
- **Comments (UNTESTED):** `@handle` mention + `#TASK-ID` ref parse · 15-min author edit window · soft-delete (author OR 👑) · 1-level threading (parent+replies) · mention → notification · workspace isolation
- **Checklists (UNTESTED):** checklist + item CRUD · sub-items (`parentItemId`) · toggle complete · bulk-add (template) · position ordering · completion tracking · cascade delete (checklist → items)
- **Attachments (tested):** presigned PUT/GET · MIME allow-list + ≤25MB · soft-delete + R2 janitor · upload_status pending→complete

---

## Phases
- **Phase 0** — Baseline ✅ **DONE**: tasks/tasks10 **355/357** (2 unique pre-existing fail → Issue #2, #3), membership **97/97**, taskdeps **67/67**, attachments **104/104** (1 cold-start timeout flake; green on isolated re-run). Comments/Checklists = **0 tests** (Issue #1). → **~623 green, 2 minor real issues + the big comments/checklists gap + 1 suspected checklist bug.**
- **Phase 1** — M7 Tasks Core ✅ **DONE**: Issue #2 (dup `?limit` → 422) + #3 (task_type fallback test) fixed; review confirms heavily-tested + solid (ETag/nesting/bulk/SLA/counters). **tasks 358/358 green.**
- **Phase 2** — M9 Relations ✅ **DONE**: `TaskMembershipService` + `TaskDependenciesService` review = **no bug** (isolation/idempotency/auto-watch/in-ws assignee+tag validation/cycle-BFS/FK-race→404 all correct). membership 97 + taskdeps 67 green. → Membership validates assignees in-workspace, **confirming Issue #4** (checklists does NOT).
- **Phase 3** — M10 Comments + Checklists ✅ **DONE**: wrote **47 tests** (comments 22 + checklists 25) on new `jest.collab.config.cjs`; CommentsService review = clean; **found + FIXED Issue #4** (checklist assignee/parent validation: 500/cross-tenant → 422). 47/47 green.
- **Phase 4** — M10 Attachments + Activity ✅ **DONE**: `AttachmentsService` (cross-tenant thumbnail-key guard + finalize real-size re-verify + guest/size/MIME gates + pending→404 download) + `TaskActivityService` (clampLimit array-safe, opaque cursor, batched workspace-scoped actor hydration) = **no bug**. attachments 104 green.
- **Phase 5** — Frontend E2E ✅ **DONE** (Node Playwright, browser **7/7**): M8 List/Board/Calendar views render (URL-routed `/l/:id[/board|/calendar]`); task-detail drawer opens via `?task=<id>` showing description/comments/checklists/attachments; **comment-add posts + renders** (screenshot-confirmed) + **Add-checklist works**.
- **Phase 6** — Sign-off ✅ **DONE**: ~673 backend + 7 browser all green; 4 issues resolved (1 real bug Issue #4 + 1 validation-gap + 1 stale-test + the comments/checklists 0-test gap closed with 47 new tests).

---

## 🐛 Issue Log
| # | Module | Issue | Severity | Status |
|---|---|---|---|---|
| **1** | M10 Comments + Checklists | Built kintu **0 backend test** (13 ep)। **FIXED:** new `jest.collab.config.cjs` (private DB `tms_collab_test`) + setup files + **comments suite (22 test) + checklists suite (25 test) = 47 green**. CommentsService review = clean (threading/edit-window/mention/soft-delete shob thik)। | 🟠 Gap | ✅ **Fixed** (47 tests added) |
| **2** | M7 tasks list-read (`GET /lists/:id/tasks`) | duplicated `?limit` (array) → **200, not 422**. `limit` validator `isInt` (isString na), tai repeats element-wise pass. **FIX:** `notRepeated` helper add kore `limit` + `include_archived` + `include_subtasks`-e apply (users-list pattern) → 422. | 🟡 Minor (validation gap) | ✅ **Fixed** (358/358 green) |
| **3** | M7 `POST /tasks` (test↔code) | task_type omitted + list-e default nai: test 422 expect korto, kintu code **icchakritovbe workspace task type-e fallback** kore (documented) → 201. **FIX:** stale test-ta fallback-201 verify-e align + NOTUN test add (workspace-e 0 task type → true 422)। Code intentional, untouched. | 🟡 Test | ✅ **Fixed** |
| **4** | M10 Checklists | `addItem`/`updateItem` `assignee_id`/`parent_item_id` unvalidated → **test diye CONFIRMED (5 fail): invalid id → 500, cross-ws assignee → 201, cross-checklist parent → 201**. **FIXED:** `UsersRepo` added to ChecklistsService; assignee → `findActiveIdsInWorkspace` (422 `checklist_item.invalid_assignee`), parent → same-checklist check (422 `checklist_item.invalid_parent`)। Re-run 47/47 green. | 🟠 **Real bug** | ✅ **Fixed** |

---

## Sign-off
| Module | Verification | Pass | Open | অবস্থা |
|---|---|---|---|---|
| M7 Tasks Core | tasks 358 (incl. Issue #2/#3 fixes) | 358 | 0 | ✅ (2 fixed) |
| M9 Relations | membership 97 + taskdeps 67 (review clean) | 164 | 0 | ✅ |
| M10 Comments (NEW) | comments suite — CommentsService clean | 22 | 0 | ✅ new coverage |
| M10 Checklists (NEW) | checklists suite + **Issue #4 real-bug fix** | 25 | 0 | ✅ |
| M10 Attachments + Activity | attachments 104 (review clean) | 104 | 0 | ✅ |
| M8 Views + task-detail (browser) | List/Board/Calendar + drawer comment/checklist | 7 | 0 | ✅ |
| **Layer C total** | **~673 backend + 7 browser** | **all green** | **0** | ✅ **ZERO-ISSUE** |
