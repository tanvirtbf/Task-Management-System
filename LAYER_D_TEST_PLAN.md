# 🧪 LAYER D — Deep Test Plan (Productivity & Intake)

> **Goal:** Layer D — **M11 Forms · M12 Notifications/SSE · M13 Search · M14 Home · M15 Templates** — pura test kore **zero-issue** kora. Ami (Claude) execute korbo, phase dhore.
>
> **Methodology** (A/B/C-proven): protita module-e → (1) baseline suite run → (2) service **adversarial review** (real bug: isolation/concurrency/FK/value-validation/date-boundary) → (3) **coverage-gap** analysis → (4) bug fix + gap fill + re-verify green → (5) cross-cutting → (6) frontend E2E (browser)।
>
> Started: 2026-06-28 · ভিত্তি: [[LAYER_A_TEST_PLAN]] · [[LAYER_B_TEST_PLAN]] · [[LAYER_C_TEST_PLAN]] (shob done, zero-issue), MODULE_TEST_BREAKDOWN.md.

---

## 📊 Scope — Layer D endpoints + suites

| Module | Endpoints | Suite (jest config) | Test status |
|---|---|---|---|
| **M11 Forms** | list · list-by-list · get · create · update · delete · field add/update/delete/reorder · submissions · **public GET + public submit** (13) | `jest.forms.config.cjs` | ✅ tested (~74) |
| **M12 Notifications** | feed · unread-count · mark-all-read · get/set prefs · read · unread · snooze · delete (9) | `jest.notifications.config.cjs` | ✅ tested |
| **M12 SSE** | `GET /stream/inbox` (long-lived) (1) | `jest.sse.config.cjs` | ✅ tested (~12) |
| **M13 Search** | `GET /search` (1) | `jest.search.config.cjs` | ✅ tested (~32) |
| **M14 Home** | `GET /home/kpis` · `GET /home/agenda` (2) | `jest.home.config.cjs` | ✅ tested (~23) |
| **M15 Templates** | list · get · create · update · delete · **apply** (6) | `jest.templates.config.cjs` | ✅ tested (~121) |

Run a suite: `cd server && node ./node_modules/jest/bin/jest.js --config <cfg> --runInBand`

---

## 🎯 Bug-hunt focus (per module)

**M11 Forms:**
- **Public submit** (🔓 anonymous): form resolve by slug → task spawn (`TaskWriteService`) + custom-field values + submission row + notification — the documented **2-txn non-atomicity** (task survives if 2nd txn fails); custom-field value envelopes on public path; `submission_closed` 403; required-field 422.
- `forms` has **NO workspace_id** → isolation via `forms→lists→spaces.workspace_id` join (every query); `public_slug` global-unique + auto-gen dup-retry.
- field-kind validation (task_attr whitelist / custom_field exists), reorder atomicity (whole-batch).

**M12 Notifications + SSE:**
- per-user isolation (never another user's inbox), snooze + `snooze-wake` job, mark-all-read, prefs lazy-default (all-on if row missing).
- SSE: cookie auth, `Last-Event-Id` resume, **write-after-end guard** (the build's CRITICAL fix), heartbeat, poll-based delivery.

**M13 Search:**
- 5 types (task/list/space/user/comment), task `custom_id` **exact** match, soft-deleted comment + archived-task exclusion, `escapeLike` (%/_ literal), empty-query → 200 empty, per-type limit clamp, workspace isolation.

**M14 Home:**
- KPI defs: open = `status_group NOT IN (done,closed)` (statuses join), my = `task_assignees` join; **due_today / overdue date-boundary** (local-`ymd` string-compare on the DATE column — verify no off-by-one/tz skew on-machine); `awaiting_review` = reviewer_id + pr_status=open; sparkline 7-day bucket; agenda by `?date=`.

**M15 Templates:**
- **apply** (👑? — actually apply = 🔐): spawns task + checklist + items in ONE tx (task_number race-retry, default status/type, `usage_count++`, `created_from_template` activity); **per-item due-date DEFERRED** (no `checklist_items.due_date`); ⚠️ does TemplateApply insert checklist items DIRECTLY (bypassing ChecklistsService)? — if so, check it doesn't reintroduce the Issue-#4-class gap (unvalidated assignee).
- duplicate 409, type immutable on PATCH, `empty_structure`/`invalid_task_type`/`invalid_tag` 422.

---

## Phases
- **Phase 0** — Baseline ✅ **DONE**: forms 74 (1 cold-start flake → **74/74 on re-run** w/ higher timeout), notifications 84, sse 12, search 32, home 23, templates 121 = **346 green**. No real issue at baseline.
- **Phase 1** — M11 Forms ✅ **DONE**: FormsService review = clean EXCEPT **Issue #1 (real bug)** — public-submit task_attr injection (priority/date/name → 500 + silent corruption on an anonymous endpoint) + app-wide start>due 500. **Found via adversarial probe, FIXED** (forms validation + create start≤due). cf-value path safe (schemaless JSON, no typed-column 500). **forms 81/81** + tasks 358/358 + tasks10 358/358 green.
- **Phase 2** — M12 Notifications + SSE ✅ **DONE**: `NotificationsService` (user-scoped everywhere, `loadOwned` 404/403-not_owner/soft-del-404, idempotent read/unread→clears-snooze/snooze/mark-all, prefs lazy-default all-on, compound `(is_read,internal_id)` cursor) + `SseController`/`sseHub` (write-after-end guard, poll re-entrancy guard, cleanup+timer-unref+shutdown registry, **userId-scoped poll = no cross-user leak**, Last-Event-Id resume + BIGINT-ceiling degrade-to-live) = **no bug**. notifications 84 + sse 12 green.
- **Phase 3** — M13 Search + M14 Home ✅ **DONE**: `SearchService`/`SearchRepo` (escapeLike `\%_`→literal, archived+soft-deleted-comment exclusion, custom_id-exact, blank-q→empty, workspace-scoped) + `HomeService`/`HomeRepo` = **no bug**. **Date-boundary verified correct, no tz skew**: dueToday/overdue/agenda compare a DATE column to node-local `today`, slaBreaches uses a **JS-Date param** (`lt(slaDueAt, now)`) so stored+compared values serialize identically via mysql2 — the §29 SQL-VIEW `NOW()` skew does NOT apply (Home queries tasks directly, not the views). search 32 + home 23 green.
- **Phase 4** — M15 Templates ✅ **DONE**: `TemplatesService` (workspace-scoped CRUD, update= empty-patch-422→row-locked-resolve-404→structure-revalidate→dup-409, **type+usage_count immutable**, delete affectedRows-guard, validateStructure empty/task_type/tag 422) + `TemplateApplyService` (validation precedence, task_number race-retry, one-tx atomic, usage++) = **no bug**. **Issue-#4-class gap absent** — template checklist items have no assignee/parent field, so apply inserts only `{text, position}`. templates 121 green.
- **Phase 5** — Frontend E2E ✅ **DONE** (Node Playwright, browser **5/5**): M14 Home dashboard (6 KPI tiles render w/ real data + My Work/Agenda/LineUp/Recent Activity), M12 Inbox renders, M13 Search renders for a query, **M11 public form `/forms/:slug` renders + submit succeeds end-to-end** ("Submission received" — the hardened endpoint). Note: confirmed `list.archived`→409 is correct (an archived target list rejects public submits).
- **Phase 6** — Sign-off ✅ **DONE**: 353 backend + 716 tasks-regression + 5 browser all green; **1 real bug (Issue #1, public-form injection) found + fixed**.

---

## 🐛 Issue Log
| # | Module | Issue | Severity | Status |
|---|---|---|---|---|
| **1** | M11 Forms (public submit) | **REAL BUG** — anonymous `POST /public/forms/:slug/submit` maps `task_attr` values straight into `TaskWriteService.create`, **bypassing the HTTP task validator**. Probe confirmed (5+1 cases): `priority:99`/`-3` → **500** (`ck_tasks_priority`), `due_date:"garbage"`/`"2026-13-45"` → **201 silent data-corruption**, `start>due` → **500** (`ck_tasks_dates`), `name`>500 → **500** (data-too-long). All on the most-exposed endpoint. **FIXED:** `FormsService.submit` now validates+coerces task_attr (priority int 0–4, due/start_date real YYYY-MM-DD, name ≤500) → per-field 422; `TaskWriteService.create` validates **start≤due** → 422 `task.invalid_date_range` (also closes the SAME 500 on normal `POST /tasks`). +7 probe tests. | 🟠 **Real bug** (anon endpoint 500/corruption) | ✅ **Fixed** (forms 81/81 · tasks 358+358, no regression) |

---

## Sign-off
| Module | Verification | Pass | Open | অবস্থা |
|---|---|---|---|---|
| M11 Forms | forms suite + **Issue #1 fix** + 7 probe tests | 81 | 0 | ✅ (real bug fixed) |
| M12 Notifications + SSE | review clean (user-scoped, write-after-end/re-entrancy guards) | 84+12 | 0 | ✅ |
| M13 Search | review clean (escapeLike, archived/deleted exclusion, custom_id-exact) | 32 | 0 | ✅ |
| M14 Home | review clean (date-boundary correct, no tz skew) | 23 | 0 | ✅ |
| M15 Templates | review clean (CRUD + Apply, no Issue-#4-class gap) | 121 | 0 | ✅ |
| Frontend E2E | Home/Inbox/Search render + public-form submit end-to-end | 5 | 0 | ✅ |
| **Layer D total** | **353 backend + 716 tasks-regression + 5 browser** | **all green** | **0** | ✅ **1 real bug fixed** |
