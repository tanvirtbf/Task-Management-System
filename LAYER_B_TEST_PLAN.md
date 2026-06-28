# 🧪 LAYER B — Deep Test Plan (Structure & Catalog)

> **লক্ষ্য:** Layer B — **M4 Spaces & Lists · M5 Statuses/Task-Types/Tags · M6 Custom Fields** (~36 endpoint) — Layer A-এর মতো **zero-issue** করা। আমি (Claude) execute করব, phase ধরে।
>
> Methodology (Layer A-proven): প্রতি module-এ → (১) baseline suite run → (২) service **adversarial review** (real bug: escalation/isolation/permission/concurrency/FK-handling) → (৩) **coverage-gap** analysis → (৪) bug fix + gap fill + re-verify green → (৫) cross-cutting confirm → (৬) frontend E2E (browser)।
>
> Started: 2026-06-27 · ভিত্তি: [[LAYER_A_TEST_PLAN]] (done, zero-issue), MODULE_TEST_BREAKDOWN.md।

---

## 📊 Scope — Layer B endpoints + suites

| Module | Endpoints | Suite (jest config) | Auto-test (baseline expectation) |
|---|---|---|---|
| **M4 Spaces** | 7 (list·get·create·update·archive·unarchive·delete) | `jest.spaces.config.cjs` | ~242 |
| **M4 Lists** | 9 (list-by-space·list-all·get·create·update·archive·unarchive·delete·tasks) | `jest.lists.config.cjs` | ~171+ |
| **M5 Statuses** | 5 (list·create·reorder·update·delete) | `jest.statuses.config.cjs` | ~209 |
| **M5 Task Types** | 4 (list·create·update·delete) | `jest.taskTypes.config.cjs` | ~184 |
| **M5 Tags** | 4 (list·create·update·delete) | `jest.tags.config.js` | ~149 |
| **M6 Custom Fields** | 7 (list·list-for-list·create·update·delete·set-value·clear-value) | `jest.customfields.config.cjs` | ~90 |

Run a suite: `cd server && node ./node_modules/jest/bin/jest.js --config <cfg> --runInBand`

---

## 🎯 Bug-hunt focus (per module — যেখানে real bug লুকিয়ে থাকতে পারে)

**M4 Spaces & Lists:**
- Archive **cascade** (space archive → lists; list archive → ?) correctness
- Delete preconditions: 🛡️ owner-only, must be archived + empty (409 `not_archived`/`not_empty`)
- FK handling: `lists→tasks` RESTRICT, list-scoped `statuses` (FK-less, manual cleanup), forms cascade
- `default_task_type_id` FK validation (race-safe?)
- Position computation under concurrency
- Workspace isolation (cross-ws 404)

**M5 Catalog (Statuses/Types/Tags):**
- Status delete: `in_use` 409 (FK RESTRICT + pre-check) vs `last_in_group` 422 (Board needs ≥1/group); reorder bulk-position atomicity
- Task-type delete: system-type protection (403/409), `in_use` (tasks RESTRICT + lists SET-NULL → manual count)
- Tag delete: cascade to `task_tags`; duplicate-name 409 (case-insensitive)
- Validator order gotchas (isString before trim)

**M6 Custom Fields:**
- type + scope **immutable** on PATCH
- value envelopes per type (text/phone `{text}`, money `{amount,currency}`, date `{date}`, dropdown `{option_id}`+exists, files `{file_ids}`+live-attachment)
- scope_id validation (workspace/space/list), `hidden_from_guests` redaction
- delete cascade (options + task values)

---

## Phases
- **Phase 0** — Baseline (6 suites) ⏳ running
- **Phase 1** — M4 Spaces & Lists (review + gap + fix)
- **Phase 2** — M5 Catalog (Statuses · Task Types · Tags)
- **Phase 3** — M6 Custom Fields
- **Phase 4** — Cross-cutting (RBAC matrix · isolation · error-envelope) + live
- **Phase 5** — Frontend E2E (Spaces/Lists/Settings UI, browser)
- **Phase 6** — Sign-off

---

## 🐛 Issue Log
| # | Module | সমস্যা | Severity | Status |
|---|---|---|---|---|
| — | M4·M5·M6 | **কোনো code bug পাওয়া যায়নি।** ৬টা service adversarial-review CLEAN (cascade/delete-precondition/FK-handling/group-lock/system-protection/SET-NULL-count/value-envelope সব race-safe ও সঠিক); baseline **1,045/1,045 green**; প্রতিটা endpoint-এ dedicated test (change-password-এর মতো gap নেই)। Backend zero-issue। | — | ✅ No issue (backend) |

> **Progress (2026-06-27):** Phase 0 (baseline) + Phase 1-3 (M4/M5/M6 review+coverage) **DONE — backend zero-issue, কোনো fix লাগেনি।** Layer A-র M2/M3-এর মতো consistent disciplined code। বাকি: Phase 4 cross-cutting (per-module-এ covered) + Phase 5 frontend E2E (browser) + Phase 6 sign-off।

---

## Sign-off
| Module | Verification | Pass | Open | অবস্থা |
|---|---|---|---|---|
| M4 Spaces & Lists | spaces 242 + lists 171 + review clean | 413 | 0 | ✅ backend |
| M5 Catalog | statuses 209 + task-types 184 + tags 149 + review clean | 542 | 0 | ✅ backend |
| M6 Custom Fields | 90 + review clean | 90 | 0 | ✅ backend |
| Cross-cutting + live | per-module RBAC/isolation covered; live rate-limit (M4-এ লাগবে না — apiLimiter only) | — | 0 | ✅ |
| Frontend E2E | M5 task-type+tag create · M6 custom-field create · M4 ListPage render (browser, 5/5) | 5 | 0 | ✅ |
| **Layer B total** | **1,045 backend + 5 browser** | all green | 0 | ✅ **ZERO-ISSUE** |
