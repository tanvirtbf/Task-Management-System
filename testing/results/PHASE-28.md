# PHASE 28 — Sprints

**Status:** PARTIAL (UI deferred — §8)
**Methods:** API · DB · CODE
**Issues filed:** **none** — no new defect survived verification
**Existing issue updated:** ISS-024 (`sprint.assign_tasks` confirmed unenforced, with the
member-vs-guest asymmetry spelled out)
**Data left behind:** none — tasks 51, lists 14, statuses 70, sprints 1, and the seeded
"Sprint 12 — Checkout & Payments" **restored to `active`** after being closed for the lifecycle test.

---

## 1. CRUD — PASS

| probe | result |
|---|---|
| create | 201, status **`planned`** |
| duplicate name | **409 `sprint.duplicate`** |
| `end_date` before `start_date` | 422 |
| missing dates / empty name | 422 |
| `GET` list / one / unknown | 200 / 200 / 404 `sprint.not_found` |
| `PATCH` goal / unknown | 200 / 404 |

## 2. Lifecycle — PASS, every guard correct

```
start while another sprint is active -> 422 sprint.another_active
close the other one                  -> 200
start ours                           -> 200, status active
start it again (already active)      -> 200   idempotent
start a second sprint                -> 422 sprint.another_active
start a CLOSED sprint                -> 409 sprint.invalid_status
add a task to a CLOSED sprint        -> 409 sprint.invalid_status
close a closed sprint                -> 200   idempotent
```

`GET /sprints/active` and the `v_active_sprint` view agree exactly — same id, same name, and the view
holds exactly one row while the table holds exactly one `active` sprint. The "only one active sprint"
invariant is enforced on the write path rather than assumed by the view.

## 3. Task membership — PASS

| probe | result |
|---|---|
| add two tasks | 204 |
| add the same two again | 204 — idempotent |
| unknown task id | 404 `task.not_found` |
| empty array | 422 |
| remove a member | 204 |
| remove it again | 404 `sprint.task_not_in_sprint` |
| remove a task never in the sprint | 404 `sprint.task_not_in_sprint` |

Activity rows are written on both sides — `sprint_added` and `sprint_removed`.

## 4. `committed_points` — **not** a defect

The first read looked like ISS-046 all over again: six member tasks summing to 21 story points, and
`committed_points: 0`. It is not a rollup. `SprintsController:95-105` takes `committed_points` from
the **request body** (`committed_points ?? 0`) and `PATCH` accepts it — it is the team's manual
commitment figure, which is what the term means in Scrum. The seed sets it to 26 by hand. Recorded
as characterised behaviour; nothing is broken.

## 5. Close and carry-over — PASS, and well built

```
6 tasks in the sprint, 1 marked Done
POST /sprints/:id/close -> 200 {"rolled_over": 5}
  the Done task stays with the closed sprint
  the 5 unfinished tasks move to the next PLANNED sprint
  5 sprint_rolled_over activity rows, each with context {from_sprint_id, to_sprint_id}
```

`SprintsService:401` resolves the target with `findNextPlanned` — so carry-over lands in the next
planned sprint, and if there is none, nothing moves. The whole close is one transaction.

## 6. Cross-space behaviour — PASS, and better than P18's equivalent

A task from another space **can** be added to a sprint (204) — sprints are workspace-scoped by
design. The question that matters is whether that leaks the task, and it does not:

```
a Politics task placed in a sprint, read by marketing.only@
  GET /sprints/:id/tasks -> 200, 0 tasks       the Politics task is filtered out
  GET /tasks/<that task> -> 404                unchanged
  GET /sprints           -> 200, 0 sprints
```

This is the same visibility question that **ISS-053** answers badly for dependency hydration. Sprints
get it right, which is useful for the fix: the filtering pattern already exists in this repo.

## 7. Permissions — the asymmetry worth naming

```
guest  creates a sprint -> 403 auth.forbidden
member creates a sprint -> 403 auth.forbidden
member closes a sprint  -> 403 auth.forbidden
guest  ADDS TASKS       -> 204
member ADDS TASKS       -> 204
```

`sprint.manage` is properly enforced and is admin-level — an ordinary engineer cannot create or close
a sprint. `sprint.assign_tasks` is not enforced at all, so **anyone, including a guest, can change
what is in the current sprint**. Folded into ISS-024 (already listed there) with this detail added.

## 8. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| sprint board, drag between columns, WIP limits, swimlanes | API-only phase | **P35** |

## 9. Coverage vs the plan

All 7 checklist lines executed. Sprints are a genuinely solid module: a real single-active-sprint
invariant, idempotent transitions, precise status guards, transactional carry-over with activity
context, and correct space filtering on reads. The one hole is that its most-used operation — putting
work into the sprint — has no permission gate.

**Evidence directory:** `testing/evidence/PHASE-28/` — 2 files.
