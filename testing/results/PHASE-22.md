# PHASE 22 — Checklists

**Status:** PARTIAL (UI verified by source read only — browser checks deferred, §8)
**Methods:** API · DB · CODE
**Issues filed:** ISS-067, ISS-068 (MEDIUM) · ISS-069 (LOW) · ISS-070 (**GAP** — the log's first)
**Data left behind:** none — tasks 51, lists 14, checklists 5, items 23, 0 orphans.

---

## 1. Checklist CRUD — PASS

| probe | result |
|---|---|
| create | 201, `{id, task_id, name, position, items}` |
| `position` | auto-assigned 0, 1, 2 in creation order |
| **duplicate name on the same task** | **201 — allowed** |
| rename | 200 |
| rename to `""` | 422 |
| 500-char name | 422 |
| reposition | 200 |
| create on an unknown task | 404 `task.not_found` |
| PATCH / DELETE unknown | 404 `checklist.not_found` |
| `GET /tasks/:id/checklists` | 200, bare array, **items embedded** |

The duplicate-name result extends the cross-phase pattern to an eighth resource — the tally is now
**3 enforce / 5 do not** (STATUS.md).

## 2. Items — PASS on validation, with one contract hole

Correct: empty text 422 · 1000-char text 422 · unknown checklist 404 · unknown assignee **422
`checklist_item.invalid_assignee`** · an **`invited`** (not yet active) user as assignee also 422 ·
parent in another checklist 422 `checklist_item.invalid_parent` · unknown parent 422.

The hole is `PATCH` — it answers **200 to fields it discards**, including `is_completed`, which is the
obvious way for any new caller to tick a box:

```
{"is_completed": true}  -> 200,  row still is_completed = 0
{"due_date": …}         -> 200,  ignored
{"completed_by": …}     -> 200,  ignored
{"position": 99}        -> 200,  applied
```

→ **ISS-067**. The shipped client is unaffected (it is typed to `{text, assigneeId, position}` and
uses the toggle endpoint for the checkbox).

## 3. Toggle — PASS, and done properly

```
POST /checklist-items/:id/toggle   -> is_completed 1, completed_at set, completed_by = the actor
POST it again                      -> is_completed 0, completed_at NULL, completed_by NULL
```

All three columns move together in both directions. Toggling a parent item does **not** cascade to
its sub-items — they stay independent, which is the defensible choice.

## 4. Bulk add — validation PASS, size unbounded

Correct on contents: empty array 422 · non-array 422 · missing key 422 · one empty string among
valid ones 422 **and atomic** (nothing written). Unbounded on size: 500 items → 201, then 5 000 more
→ 201, leaving **5 011 items on one checklist**, all embedded in every read of that task. The task
equivalent caps at 200. → **ISS-068**.

## 5. Nesting — no limit, and no client support

Sub-items accepted to 8 levels with no cap found; `GET` returns a **flat** array carrying
`parent_item_id` and builds no tree; the client never reads `parent_item_id` and offers no way to
create a sub-item. Tasks, by contrast, cap at 2 with a DB check constraint. → **ISS-069**.

## 6. Progress rollup — no server field, and that is consistent

`GET /tasks/:id` carries no checklist counters at all. `ChecklistsSection` computes `done/total`
from the embedded items itself, exactly as `SubtasksSection` does. This is the *right* pattern — it
is the one place ISS-046's stale-counter problem cannot occur. Recorded as a pass, not a gap.

## 7. Cascades — PASS, complete

| action | result |
|---|---|
| delete an item that has a sub-item | both go |
| delete the checklist | all its items go |
| hard-delete the task | checklists **and** items go |

## 8. Access

A **guest** created a checklist (201) and toggled an item (200) — `checklist.manage` is one of the 18
permissions ISS-024 proved unenforced. Referenced, not re-filed. No token → 401.

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| checklists section render, inline add, drag-reorder | API-only phase | **P35** |
| does the UI expose `position` reordering at all? (`position` is writable and the section reads it) | needs the browser | **P35** |

## 10. Coverage vs the plan

All 6 checklist lines executed. One of them is answered by the product rather than by a test: items
have no due date, so `checklist_item` + due date could not be exercised — filed as the log's first
**GAP** (ISS-070) because assigning an item to a person with no date is a real coordination hole, but
building the column is not a testing-phase action.

The checklist module has the cleanest validation of anything in Block D — every invalid reference is
a specific, correctly-coded 422, the toggle path maintains all three completion columns atomically,
and every cascade is complete. Its weaknesses are all at the edges of the contract: a PATCH that
says yes and does nothing, a bulk endpoint with no ceiling, and a nesting capability only the API
knows about.

**Evidence directory:** `testing/evidence/PHASE-22/` — 2 files.
