# PHASE 09 — Lists

**Status:** PARTIAL (UI deferred — §7)
**Methods:** API · DB
**Issues filed:** ISS-035, ISS-036 (LOW)
**Data left behind:** none — lists 14, tasks 51, both at baseline.

> Already proven elsewhere: `list.create/edit/archive/delete` gates (P5 — all ENFORCED), owner-only
> `DELETE /lists/:id` (P4), and `GET /lists` ignoring `limit` (ISS-007).

---

## 1. Create — validation is thorough once the right field name is used

| body | result |
|---|---|
| valid | 201 |
| empty name / 300-char name | 422 |
| no `space_id` | 422 |
| unknown space | 404 `space.not_found` |
| `default_task_type_id` valid | 201, stored |
| `default_task_type_id: null` | 201, null |
| **`default_task_type_id: "tt-nope"`** | **422 `list.invalid_task_type`** ✓ |
| `default_task_type_id: ""` | 422 |
| **duplicate name in the same space** | **201 → ISS-035** |
| same name in a *different* space | 201 (fine) |
| `is_private: true` | 201 |

> **Test-method note.** The first run of this phase sent `task_type_id`. The real field is
> `default_task_type_id`, and `POST /lists` **silently ignores unknown keys** — so the list was
> created with a NULL type and 201, which briefly looked like "unknown task type is accepted". Once
> corrected, the validation is exactly right. Recorded because it is the same silent-drop behaviour
> as ISS-032, and because `PATCH` does the opposite (see §3).

## 2. Read

`GET /lists/:id` → `id, space_id, name, description, icon, color, position,
default_task_type_id, is_private, archived_at, created_by, created_at`. List and single-read shapes
match exactly. Unknown id → 404 `list.not_found`. `GET /spaces/sp-nope/lists` → 404
`space.not_found`. A space-scoped user reading a foreign list → **404 `list.not_found`** (no
existence oracle).

## 3. Update — narrow and strict, which is the right shape

| body | result |
|---|---|
| `name` / `description` / `icon` / `color` | 200 |
| `default_task_type_id` → another type | 200 |
| `default_task_type_id: "tt-nope"` | 422 `list.invalid_task_type` |
| `default_task_type_id: null` | 200 |
| `space_id` (move) | **422 → ISS-036** |
| `is_private` | **422 → ISS-036** |
| `id` alone | 422 |
| `{}` empty body | **422** |
| `{bogus:1}` unknown key only | **422** |

Two things stand out. First, `PATCH /lists` **rejects** a body with no recognised field, which is
stricter and better than `PATCH /workspace` (which returns 200 — §5 of PHASE-06). Second, `POST`
silently ignores unknown keys while `PATCH` refuses them — the two halves of the same resource
disagree.

`{name:"…", id:"l-hacked"}` returns 200 while `{id:"l-hacked"}` alone returns 422 — the id is
ignored either way (DB verified unchanged), so this is an inconsistency in the *response*, not a
mass-assignment hole.

## 4. Archive / delete — correct, and it proves ISS-034 is a bug

| step | result |
|---|---|
| archive | 204, idempotent |
| archived list hidden from `GET /lists` | ✓ |
| direct `GET` while archived | 200 |
| **`PATCH` while archived** | **409 `list.archived`** |
| create a task inside it | 409 `list.archived` |
| `DELETE` while not archived | 409 `list.not_archived` |
| `DELETE` archived + holding a task | 409 `list.not_empty` |
| after **soft**-deleting that task | still 409 `list.not_empty` |
| after **hard**-removing it | 204 |
| unarchive an already-deleted list | 404 `list.not_found` |

**Lists freeze on archive; spaces do not.** `PATCH` on an archived *list* is 409, while `PATCH` on an
archived *space* is 200 (ISS-034). Lists are the model of the intended behaviour, which turns
ISS-034 from a judgement call into a clear inconsistency.

Note the soft-delete detail: an archived task still counts toward `list.not_empty`, so a list cannot
be removed until its tasks are hard-deleted (`DELETE /tasks/:id?hard=true`, admin/owner). Defensible,
but it means "delete this list" is a two-role operation.

## 5. `GET /lists/:id/tasks`

Against the busiest real list (Eid Campaign 2026, 8 tasks):

| query | rows |
|---|---|
| none | 8 |
| `limit=2` | 2 — pagination `{next_cursor:"Mg", has_more:true, total_estimate:8}` |
| `status_group=done` | 3 — filter works |
| `priority=1` | 2 — filter works |
| `q=a` | 6 — filter works |
| `limit=0` | 422 |
| `assignee_id=me`, `sort=due_date`, `bogus=1` | 8 — silently ignored (ISS-014) |

Archived tasks are correctly excluded by default (0 archived in that list, so `include_archived`
made no difference — re-check in P16 once archived fixtures exist).

## 6. Cross-space isolation — CLEAN

`marketing.only@` was pointed at **every one of the 11 lists in the other 8 spaces**:
`GET /lists/:id/tasks` → **0 leaks**. Their own 3 Marketing lists return 8 / 3 / 4 tasks correctly.

> A first pass appeared to show a leak; the list picked as "foreign" (*Eid Campaign 2026*) is in fact
> a **Marketing** list, so the 200 was correct. Re-run properly against genuinely foreign lists
> before drawing any conclusion.

## 7. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| create-list modal, list page, breadcrumb, favourites | API-only phase | **P36** |
| `include_archived` on `/lists/:id/tasks` with real archived tasks | no archived tasks exist yet | **P16** |

## 8. Coverage vs the plan

5 of the 6 checklist lines executed; the UI line deferred. The phase's most useful output is not a
bug but a comparison: **lists get the archive/delete state machine right**, which makes the spaces
behaviour (ISS-034) demonstrably wrong rather than merely different.

**Evidence directory:** `testing/evidence/PHASE-09/` — 3 files.
