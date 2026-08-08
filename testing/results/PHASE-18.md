# PHASE 18 — Subtasks & dependencies

**Status:** DONE
**Methods:** API · DB · CODE
**Issues filed:** ISS-053 (HIGH) · ISS-054 (MEDIUM) · ISS-055 (LOW)
**Issues updated with new proof:** ISS-046, ISS-051, ISS-024
**Environment change made and reverted:** the three stale `trg_subtasks_after_*` triggers
(`SCAN-H4`) were dropped for the duration of this phase so the subtask paths could be tested at
production parity, then **restored** — dev is back to 10 triggers, prod parity is 7. See §7.
**Data left behind:** none — tasks 51, lists 14, statuses 70, dependencies 0, 0 orphans.

---

## 1. Nesting — PASS

```
parent (depth 0) -> child      201  nesting_depth = 1
child            -> grandchild 201  nesting_depth = 2
grandchild       -> great-gc   422  task.nesting_too_deep
```

`nesting_depth` is computed from the parent, stored, and the limit matches the DB check constraint
`ck_tasks_nesting (nesting_depth <= 2)`. The error message is usable copy: *"Subtasks may nest at
most 2 levels deep"*.

| probe | result |
|---|---|
| unknown `parent_task_id` | 422 `task.invalid_parent` |
| child created in a **different list** from its parent | 201 — allowed |
| `PATCH parent_task_id` (re-parent an existing task) | 422 — protected field |

The last row is worth recording as behaviour, not a defect: **parentage is fixed at create time.**
A task created at the top level can never become a subtask, and a subtask can never be promoted.
The plan's "un-parent" counter case is therefore untestable — the operation does not exist.

## 2. Subtask reads — PASS, complete

`GET /tasks/:id/subtasks` returns a **bare array** (the §10 shape), direct children only:

```
3 direct children returned, incl. the cross-list one
grandchild NOT included            ✓ (direct children only)
50 hydrated keys per child         ✓
archive a child -> default 2, ?include_archived=true 3
leaf task            -> 200 []
unknown id           -> 404 task.not_found
include_archived=yes -> 422 validation.failed
```

## 3. Counters — the known defect, now with its client consequence (ISS-046)

Three subtasks, one moved to Done, with **the triggers removed** (so this is exactly what production
does): `subtasks_count: 0, subtasks_completed: 0`.

The new part is which client code that actually breaks:

- `SubtasksSection` (drawer) computes `done/total` from the fetched children — **correct**.
- `BoardCard` renders the badge only `if (task.subtasksCount > 0)` — never true, so **no board card
  has ever shown a subtask indicator**.

Both recorded in ISS-046.

## 4. Dependencies — PASS on every guard

| probe | result |
|---|---|
| `X blocks Y` | 201 |
| the same pair again | 409 `dep.duplicate` |
| self | 422 `dep.self` |
| unknown `related_task_id` | 404 `task.not_found` |
| type `relates_to` / `bogus` | 422 `validation.failed` — **`blocks` is the only stored `dep_type`** |
| no `type` at all | defaults to `blocks` |
| 2-node cycle (A→B, B→A) | 422 `dep.cycle` |
| 3-node cycle (A→B, B→C, C→A) | 422 `dep.cycle` |
| `GET /tasks/:id/dependencies` | 200 `{blocks: [], blocked_by: []}`, both directions, other end hydrated |
| `DELETE` an edge / the same edge again / an unknown id | 204 / 404 / 404 `dep.not_found` |

The cycle check is a BFS inside the create transaction, and it holds for N-node chains.

**DB backstop triggers fire.** The first attempt at this used the wrong column name (`type`; the
column is `dep_type`), so the check was invalid and was redone:

```
raw INSERT  task_id = related_task_id  -> ERROR "task_dependencies: task cannot depend on itself"
raw UPDATE  into a self-edge           -> ERROR "task_dependencies: task cannot depend on itself"
```

Both `trg_task_dependencies_no_self_insert` and `_update` are live and correct.

## 5. Cross-list and cross-space — where the phase's real finding is

Cross-list: allowed, 201. Cross-space (Politics ↔ Marketing): **allowed, 201** — dependencies are
scoped to the *workspace*, not the space.

That is a defensible design choice on the write side, and the write side is properly guarded: a
space-scoped user cannot create such an edge, because `related_task_id` resolves through the
visibility-filtered repo and comes back 404. The **read** side does not apply the same filter:

```
marketing.only@   GET /tasks/<politics task>          -> 404
                  GET /search?q=CONFIDENTIAL          -> []
                  GET /tasks/<their own>/dependencies -> 200 + the full 50-key Politics task,
                                                         name + description + assignees
                  DELETE /task-dependencies/<edge>    -> 204
```

→ **ISS-053 (HIGH).** One cross-department link exposes that task's content to the other department,
which is precisely what the space-scoped "department only" role exists to prevent.

## 6. Other behaviours recorded

| probe | result | verdict |
|---|---|---|
| link a live task to an **archived** task | 201 | → appended to ISS-051 (same uneven archived guard) |
| a parent blocking its own child | 201 | allowed; deadlock-shaped but not a graph cycle — not filed |
| deleting a task others depend on | edge removed, other task survives | verified in P16 §5, re-confirmed |
| completing a task that is **blocked by** an open one | 200 | confirms **ISS-011** — no completion gate |
| a **guest** creating and deleting a dependency | 201 / 204 | `dependency.manage` ungated → ISS-024 |

## 7. `SCAN-H4` — handled as environment, and reverted

P14 and P16 both had to route around this: with the three stale triggers present, a subtask status
change and a subtask hard-delete return raw 500s. Testing §1-§3 through that would have measured the
dev database rather than the product, so for this phase the triggers were dropped (dev 10 → 7,
matching what `schema.sql` provisions in production) and the DDL saved.

With them gone:

```
PATCH a subtask to Done  -> 200  ✓
DELETE a subtask ?hard   -> 204  ✓
```

Both paths are correct in production; the 500s are a dev-database artefact only, exactly as
`SCAN-H4` says. **The three triggers have been restored** — `SHOW TRIGGERS` reports 10 again, so the
environment still reproduces H4 for whoever fixes it.

## 8. Client sections — ISS-054, ISS-055

`SubtasksSection` is in good shape: multi-line add (one subtask per line), progress bar, status dot,
assignee avatar, click-through, `⌘+Enter` / `Escape` handling.

`DependenciesSection` has two gaps. It renders a **Blocked by** group but the only picker entry point
hard-codes `"blocks"` and the mutation never reads the direction, so `showPicker === "blocked_by"` is
unreachable — **ISS-054**. And its candidate list is the current list only, while the API allows any
task in the workspace — **ISS-055**.

One thing checked and found *not* to be a problem: neither section defines `onError`, but
`lib/queryClient.ts` installs a `MutationCache.onError` net that toasts the API's message for any
mutation without its own handler. So `dep.cycle` ("This dependency would create a cycle"),
`dep.duplicate` and `task.nesting_too_deep` all surface to the user with readable copy. No issue
filed.

## 9. Coverage vs the plan

All 8 checklist lines executed. One is answered by the product rather than by a test — "un-parent"
does not exist, since `parent_task_id` is immutable after create.

The dependency **engine** is the strongest server-side component tested in Block C so far: real
transactional cycle detection, a race-safe unique-constraint arbiter for duplicates, DB triggers as a
backstop, and a clean two-direction read shape. Every finding in this phase is at its edges — who is
allowed to read the result (ISS-053), and how little of it the client exposes (ISS-054, ISS-055).

**Evidence directory:** `testing/evidence/PHASE-18/` — 3 files.
