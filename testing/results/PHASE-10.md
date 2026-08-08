# PHASE 10 — Statuses

**Status:** PARTIAL (UI deferred — §7)
**Methods:** API · DB
**Issues filed:** ISS-037, ISS-038 (LOW)
**Data left behind:** none — statuses back to **70** (14 lists × 5), lists 14, tasks 51.
This phase also cleaned up **85 orphan status rows left by earlier phases** — see §1.

---

## 1. Orphaned statuses — my earlier phases' fault, not the app's

The phase opened with **155 status rows for 14 lists** (expected 70). All 85 extras were created
today between 11:32 and 13:23 — during P5/P8/P9, where test lists were removed with **direct SQL**
(`DELETE FROM lists WHERE name LIKE …`). `statuses.scope_id` is polymorphic (`scope_type='list'`)
and therefore carries **no foreign key**, so a raw list delete cannot cascade.

The important question was whether the *application* leaks them too. It does not:

```
statuses 155 -> 160   after POST /lists          (+5 defaults)
DELETE /lists/:id via the API   -> 204
statuses 160 -> 155   cascade worked
```

All 85 orphans were removed and the count verified back at 70.

> Lesson for later phases: **tear down fixtures through the API**, not with raw SQL, or
> polymorphic children are silently left behind.

## 2. Default statuses

A new list is seeded with five, in order:

```
To Do[not_started] > In Progress[active] > In Review[active] > Done[done] > Closed[closed]
```

The real group vocabulary is **`not_started` / `active` / `done` / `closed`** — not
`todo`/`in_progress`. Both of those are correctly rejected with 422.

## 3. Create — validation PASS

| body | result |
|---|---|
| valid | 201 |
| `status_group: "todo"` / `"in_progress"` / `"bogus"` | 422 |
| no `status_group` | 422 |
| empty name | 422 |
| non-hex colour | 422 |
| **duplicate name in the same list** | **409 `status.duplicate`** ✓ |
| a second `not_started` | 201 — multiple statuses per group are allowed |

Note: statuses are the **one named resource that does enforce name uniqueness** — roles (ISS-027),
spaces (ISS-033) and lists (ISS-035) do not. Whatever rule the fixing phase picks, this endpoint
already has the right behaviour to copy.

New statuses are appended at the end (position 5 in a 5-status list).

## 4. Update — PASS

Rename, colour and moving a status to a different `status_group` all succeed. Rejected: unknown
group (422), `position` via PATCH (422 — position belongs to the reorder endpoint), and `scope_id`
(422 — a status cannot be moved to another list).

## 5. Delete guards — both correct

| case | result |
|---|---|
| delete a status while another exists in its group | 204 |
| **delete the last status in a group** | **422 `status.last_in_group`** |
| **delete a status a task is sitting on** | **409 `status.in_use`** |

## 6. Reorder

The body is a **bare array of `{id, position}`** (not `{status_ids:[…]}` — the first attempt at this
phase used the wrong shape and produced seven misleading 422s).

With the correct shape, validation is thorough:

| payload | result |
|---|---|
| full set, reversed | 200, applied |
| duplicate **id** | 422 with per-item detail |
| unknown id | 404 `status.not_found` |
| a status id from **another list** | 404 `status.not_found` |
| empty array / an object | 422 `Body must be a non-empty array of { id, position } items` |
| negative position | 422 |
| missing `position` | 422 |
| **partial set (1 of 5)** | **200 — leaves colliding positions** |
| **every item at position 0** | **200 — accepted** |

The last two are ISS-037: ids are checked for uniqueness, positions are not.

## 7. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| `/settings/statuses` page and inline status edit on a task | API-only phase | **P36** (settings) · **P35** (inline edit on the task drawer) |

## 8. Coverage vs the plan

All 6 checklist lines executed except the UI line. Both findings are LOW and interlocked: the
reorder endpoint has a real validation gap (ISS-037) but is currently unreachable because nothing
in the client calls it (ISS-038) — so they should be fixed together or not at all.

**Evidence directory:** `testing/evidence/PHASE-10/` — 3 files.
