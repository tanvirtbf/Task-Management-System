# PHASE 14 — Task reading

**Status:** PARTIAL (UI deferred — §8)
**Methods:** API · DB
**Issues filed:** ISS-046 (MEDIUM)
**Data left behind:** none — tasks 51, lists 14, statuses 70, 0 orphans.

---

## 1. `GET /tasks/:idOrKey` — PASS

| lookup | result |
|---|---|
| internal id | 200 |
| `custom_id` | 200 |
| `custom_id` in the wrong case (`p14-aaa` for `P14-AAA`) | 200 — case-insensitive |
| unknown internal id / unknown key | 404 `task.not_found` |
| whitespace id | 422 |

**Collision precedence is correct.** Task B was given a `custom_id` exactly equal to task A's
*internal* id. Fetching that value returns **task A** — the internal-id match wins, matching the
documented `ORDER BY (id = ?) DESC`.

## 2. No existence oracle — PASS

A space-scoped user (`marketing.only@`) was pointed at a **real but invisible** task and at a
**fabricated** id:

```
real foreign task -> 404 task.not_found  "Task t-jp8hASKGzpXztQWl8c4NgA does not exist"
fabricated id     -> 404 task.not_found  "Task t-totally-made-up does not exist"
```

Same status, same code, same message shape. An outsider cannot tell a hidden task from a
non-existent one.

## 3. Serializer completeness — PASS

50 fields on the wire. The **only** DB column withheld is `internal_id` — correct, since it is the
pagination cursor primitive and not part of the public contract. Types are as documented (`priority`
number, `assignees`/`watchers`/`tags` arrays, absent values `null` rather than omitted).

## 4. `GET /tasks/my-work` — PASS, all five buckets correct

Buckets: `today, overdue, next, unscheduled, done`. Four fixtures assigned to the caller landed
exactly where they should:

| fixture | bucket |
|---|---|
| due **today** | `today` |
| due **5 days ago** | `overdue` |
| due **in 5 days** | `next` |
| **no due date** | `unscheduled` |

`?bucket=today` filters; `?bucket=bogus` → 422.

> Worth noting against ISS-001: bucketing is computed **app-side from the returned dates**, and it
> put every fixture in the right bucket. The 6-hour storage offset does not visibly break My Work,
> because the same offset applies to both sides of the comparison. It would matter at the
> midnight boundary — that specific case belongs to **P37**.

## 5. `GET /tasks/:id/subtasks` — endpoint PASS, counters FAIL

The endpoint is correct: a parent with one child returns it (200, 1 row), a leaf returns an empty
result, an unknown parent → 404.

But the parent's `subtasks_count` / `subtasks_completed` stayed **0** with two real children →
**ISS-046**, and it is production-affecting.

## 6. `SCAN-H4` now confirmed at the application layer

P1 proved the three stale dev-database triggers fail a raw SQL update. This phase hit them through
the **API**, on ordinary user actions:

```
PATCH /tasks/<subtask> {status_id:<Done>}   -> 500 internal
DELETE /tasks/<subtask>?hard=true           -> 500 internal
```

So on the local database, a user cannot move a subtask across statuses or delete one at all. This
is stronger than the scan's original statement (which was based on a rolled-back SQL probe) and
raises the practical urgency of dropping those three triggers before any subtask testing —
**P18 will be blocked by it**.

Production is unaffected: it was provisioned from `schema.sql`, which has 7 triggers, not 10.

## 7. Guest read — no field-level redaction

A guest reading a task sees **exactly the same 50 fields** as the owner. That is consistent with
P4's finding that the only redaction in the system is for flagged custom-field values — and with
ISS-042, which showed that flag cannot be set. Nothing new; recorded for completeness.

## 8. List reads

An empty list returns a correct envelope: `{"data":[],"pagination":{"next_cursor":null,
"has_more":false,"total_estimate":0}}`. Filters, sorting and pagination on `/lists/:id/tasks` were
covered in P9 §5 and are not repeated.

## 9. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| task drawer opening from list / board / calendar / search / inbox, and the `/t/:taskKey` deep link | API-only phase | **P35** |
| midnight-boundary bucketing under the ISS-001 offset | needs a timezone-controlled fixture | **P37** |

## 10. Coverage vs the plan

7 of the 8 checklist lines executed. Reading is in good shape — the lookup semantics, the
no-oracle behaviour and the My Work bucketing are all correct. The one real defect is that two
fields the API has always advertised have never been populated.

**Evidence directory:** `testing/evidence/PHASE-14/` — 2 files.
