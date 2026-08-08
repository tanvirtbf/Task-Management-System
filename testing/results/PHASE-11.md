# PHASE 11 — Task types & Tags

**Status:** PARTIAL (UI deferred — §6)
**Methods:** API · DB
**Issues filed:** ISS-039 (MEDIUM) · ISS-040 (LOW)
**Data left behind:** none. Teardown was done **through the API** this time (the P10 lesson), so
zero orphan rows: task_types 7, tags 8, tasks 51, lists 14, statuses 70 — every baseline exact.

---

## 1. Task types — CRUD and guards

| case | result |
|---|---|
| valid create | 201 |
| name only | 201 |
| **duplicate name** | **409 `task_type.duplicate`** |
| **duplicate differing only in case** (`task` vs `Task`) | **409** — comparison is case-insensitive |
| empty / 300-char name | 422 |
| non-hex colour | 422 |
| `is_dev_type: true` on create | 201, **stored as 1** |
| **`is_system: true` on create** | **201, stored as 0 — silently dropped → ISS-040** |
| rename | 200 |
| rename onto an existing name | 409 `task_type.duplicate` |
| flip `is_dev_type` | 200 |
| `is_system: true` on update | **422** |
| `id` change | 422 |
| delete an unused type | 204 |
| **delete "Task" (33 tasks use it)** | **409 `task_type.in_use`** ✓ |

**`task_type.system` can never fire in this workspace** — all 7 types have `is_system = 0`, and
`POST` refuses to set it. The guard exists for a state nothing creates (one more entry in ISS-010's
never-thrown list).

## 2. Tags — CRUD and guards

| case | result |
|---|---|
| valid create | 201 |
| no colour | 201 |
| **duplicate name** | **409 `tag.duplicate`** |
| **duplicate differing only in case** (`URGENT` vs `urgent`) | **409** |
| empty / 300-char name | 422 |
| bad colour | 422 |
| spaces inside the name | 201 — allowed |
| `"  TEST-p11-trim  "` | 201, stored **trimmed** ✓ |
| rename / recolour | 200 |
| rename onto an existing tag | 409 `tag.duplicate` |
| `id` change | 422 |
| delete unused | 204 |
| unknown id | 404 `tag.not_found` |

`tag.in_use` was **not** re-tested — P2 already proved it is not enforced (ISS-011): deleting a tag
that is attached to tasks succeeds and silently detaches it.

## 3. The sharpest comparison in this phase

Two sibling catalog resources, opposite behaviour on the same question:

```
DELETE a task type used by 33 tasks   -> 409 task_type.in_use     blocked
DELETE a tag attached to tasks        -> 204                      silently detached  (ISS-011)
```

Task types get it right. That makes ISS-011 a clear inconsistency rather than a design choice, and
it gives the fixing phase the pattern to copy.

## 4. `is_dev_type` — the phase's real finding

The engineering columns are **not** gated by `is_dev_type`. A task of a non-dev type accepted and
stored `story_points`, `branch_name`, `pr_url` and `bug_severity` exactly like a Bug — only
`sla_due_at` differed, and that is decided by the type *name*, not the flag. Full detail in
**ISS-039**.

## 5. Duplicate display names — the cross-phase question is now settled

Six named resources, tested end to end:

| resource | uniqueness enforced? |
|---|---|
| **statuses** (per list) | ✅ 409 `status.duplicate` |
| **task types** | ✅ 409 `task_type.duplicate` (case-insensitive) |
| **tags** | ✅ 409 `tag.duplicate` (case-insensitive) |
| roles | ❌ ISS-027 |
| spaces | ❌ ISS-033 |
| lists | ❌ ISS-035 |

**Three enforce, three do not** — and the three that do are the *catalog* resources, while the three
that do not are the *hierarchy/navigation* resources, which is exactly backwards from where a
duplicate name hurts most (the sidebar). The fixing phase has a working implementation to copy in
all three cases.

## 6. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `/settings/task-types` and `/settings/tags` pages | API-only phase | **P36** |
| Does the task drawer render the Git panel / bug badge on a non-dev task? (the visible half of ISS-039) | UI | **P35** |

## 7. Coverage vs the plan

4 of the 5 checklist lines executed; the UI line deferred. Permission gates
(`catalog.task_types`, `catalog.tags`) were confirmed ENFORCED in P4 and P5 and not re-tested.

**Evidence directory:** `testing/evidence/PHASE-11/` — 1 file.
