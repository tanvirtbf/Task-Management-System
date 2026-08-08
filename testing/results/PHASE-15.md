# PHASE 15 — Task update

**Status:** PARTIAL (UI deferred — §9)
**Methods:** API · DB
**Issues filed:** ISS-047 (HIGH) · ISS-048, ISS-049 (LOW)
**Deferred item resolved:** `own` / `own_space` scope narrowing (from P5) → ISS-047
**Data left behind:** none. One real demo task ("Eid Sale banner design") had its `priority` written
to 3 by the ISS-047 probe; restored to its seeded value **1** and the stray audit row removed.
Final: tasks 51, lists 14, statuses 70, spaces 9, 0 TEST rows.

---

## 1. Field-by-field PATCH — PASS (20 fields)

Name, description (including `null` to clear), priority, `is_milestone`, estimate, both dates,
task type, story points, all three bug enums, reviewer, `custom_id`, PR fields, `deployed_at` and
`rollback_reason` all update correctly.

**`reviewer_id: "u-nope"` → 422 `task.invalid_reviewer`** — which confirms ISS-044 exactly: the
update path validates the reviewer properly, the create path does not and returns 500.

## 2. Protected fields — PASS, no mass assignment

Every one of these is refused: `id`, `workspace_id`, `created_by`, `subtasks_count`, `archived_at`,
`parent_task_id`, `primary_list_id`, an empty body, and an unknown-only body — all 422.

`status_id` **is** accepted via PATCH (200), so the catalog's `patch.status_id` code never fires
here. `assignees` and `tags` are refused, but with a misleading message → **ISS-048**.

## 3. Optimistic concurrency — PASS, and better than expected

```
GET /tasks/:id                       -> ETag: 2026-07-30T13:56:27.000Z
PATCH with If-Match: <current>       -> 200
PATCH with If-Match: <stale>         -> 409 task.conflict
PATCH with If-Match: garbage         -> 409 task.conflict
```

`GET` really does emit an `ETag` header, and `If-Match` is honoured. Two simultaneous PATCHes with
no `If-Match` both return 200 and last-write-wins — correct, since the guard is opt-in.

## 4. Status transitions and `completed_at` — PASS

| transition | `completed_at` |
|---|---|
| initial (To Do) | null |
| To Do → In Progress | null |
| In Progress → **Done** | **set** |
| Done → To Do (re-open) | **cleared** |
| To Do → **Closed** | **set** |

A status belonging to another list → 422 `task.invalid_status`.

## 5. Date rules — PASS, validated against stored state

Moving `due_date` before the **existing** `start_date` → 422 `task.invalid_date_range`, and the row
is unchanged. Moving `start_date` past the existing `due_date` → likewise. Clearing either with
`null` works, and once `due_date` is null a later `start_date` is accepted. The check considers the
resulting state, not just the fields in the payload — the same quality as the workspace
business-hours guard (P6 §4).

## 6. `PATCH /tasks/:id/sla` — and a clean corroboration of ISS-001

| body | result |
|---|---|
| 24 h in the future | 200 |
| in the **past** | 422 `sla.invalid_due_at` |
| `null` | 200, cleared |
| malformed | 422 |

The corroboration: a deadline set **24 hours** in the future was stored such that MySQL computes it
as **18 hours** away — exactly the 6-hour offset ISS-001 describes, now visible through the SLA
endpoint on a normal write. Same for `completed_at`, stored as `07:56:27` when the wall clock (and
the API's own `updated_at`) said `13:56:27`.

Not re-filed — this is ISS-001 behaving as documented, measured through a second independent path.

## 7. Activity rows

One `task_updated` row per PATCH regardless of how many fields changed, and **a no-op update still
writes a row**. Context records only `{"fields":[...]}` — no before/after values, except
`status_changed`, which does record `from`/`to`. → **ISS-049**.

## 8. `own` scope — the phase's main finding

`marketing.only@` holds `task.edit` at scope **`own`** and successfully edited a task created by
someone else (200, value written). Full write-up in **ISS-047**; it closes the item P5 deferred and
extends ISS-024 from "the permission is not checked" to "**the scope is not checked either**".

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| every inline editor on the task drawer (name, status, assignee, date, priority, tag, story points, reviewer) | API-only phase | **P35** |
| midnight-boundary date behaviour under the ISS-001 offset | needs a timezone-controlled fixture | **P37** |

## 10. Coverage vs the plan

9 of the 10 checklist lines executed plus the P5 deferral. The update surface is the best-guarded
one tested so far — real `If-Match` concurrency, state-aware date validation, complete
mass-assignment protection, correct `completed_at` lifecycle. The authorization layer behind it is
the weak part.

**Evidence directory:** `testing/evidence/PHASE-15/` — 1 file.
