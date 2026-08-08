# PHASE 20 — Task activity

**Status:** DONE
**Methods:** API · DB · CODE
**Issues filed:** ISS-060 (HIGH) · ISS-061, ISS-062 (MEDIUM)
**Issue extended:** ISS-049 (the bulk path's audit context)
**Data left behind:** none — tasks 51, lists 14, statuses 70, users 16 (15 active), 0 orphans.

---

## 1. `GET /tasks/:id/activity` — PASS on every mechanic

Twelve different changes were driven through one task, then the feed was read back.

**Envelope and hydration**

```
{data, pagination}                            correct
actor -> full User (10 keys), or null for a system row
context on status_changed -> {"from":"st-…","to":"st-…"}
context on task_updated   -> {"fields":["status_id"]}
```

**Ordering and pagination**

| probe | result |
|---|---|
| order | exactly `internal_id DESC` — matches the table row for row |
| `?limit=3` | 3 rows, `{next_cursor, has_more, total_estimate}` |
| page 2 via cursor | 3 rows, **0 overlap** with page 1 |
| walking every page | 12 rows in 3 pages = the table's 12 |
| `?action=status_changed` | filters correctly |
| `?action=<nonexistent>` | `[]`, not an error |
| `?limit=0 / -1 / abc` | 422 `validation.failed` |
| `?cursor=garbage` | 400 `pagination.invalid_cursor` |
| unknown task id | 404 `task.not_found` |

**Actor edge cases — all correct**

| actor state | result |
|---|---|
| active | hydrated |
| **deactivated** | still hydrated, and `status` reads `deactivated` (not stale) |
| invited, never active | hydrated, `status: "invited"` |
| **user row hard-deleted** | the activity row survives with `actor: null` — FK is SET NULL, history is not destroyed |
| system-written row (`actor_id` NULL) | `actor: null` on the wire |

## 2. Bulk operations — PASS, no row storm

`POST /tasks/bulk` (the key is `ids`, not `task_ids`):

```
3 tasks x 1 field   -> 200, +3 rows   exactly one per task
3 tasks x 3 fields  -> 200, +3 rows   one per task, NOT one per field
1 bad id in a batch -> 404, +0 rows   fail-atomic
```

The one weakness is what those rows *say* — `{"bulk":true}` and nothing more. Recorded as an update
to ISS-049 rather than a new issue, since it is the same audit-context defect the single PATCH path
already has.

## 3. Which task changes leave no trace — ISS-062

Measured one operation at a time:

```
create checklist  201  none        toggle item      200  +1 checklist_item_toggled
add item          201  none        rename item      200  +1 checklist_item_updated
delete item       204  none        delete checklist 204  none
```

Ticking a box is recorded; deleting the entire checklist is not.

## 4. `GET /activity/recent` and `GET /activity` — shape and limits PASS

| endpoint | shape | limit behaviour |
|---|---|---|
| `/activity/recent` | `{data}`, no pagination | default 20, `?limit=500` → **clamped to 50** |
| `/activity` | `{data, pagination}` | `?limit=500` → **clamped to 200** |

Filters: `entity_type` validated against the 9-value enum (`bogus` → 422) and correctly applied;
`actor_id`, `from`, `to` all work (`?to=2020-…` → 0 rows); `?from=notadate` → 422; a repeated
parameter (`?limit=2&limit=3`) → 422; `?cursor=garbage` → 400. `ip_address` is stored on
`workspace_activity` and correctly **not** serialized.

## 5. Who may read it — the phase's finding, ISS-060

The two feeds carry `authenticate` and a validator and nothing else. Every account — member,
space-scoped, **guest** — reads the identical 42 user-management rows: 12 `role_changed`,
10 `invited`, 5 `deactivated`, 4 `reactivated`, 1 `password_reset_requested`, each with the acting
user's email hydrated. The space-scoped user also reads 45 rows about spaces they cannot open.

## 6. UI, read at source

| surface | verdict |
|---|---|
| `RecentActivityCard` (Home) | works — its stale `switch` mostly falls through to a fallback that reads as English for the workspace vocabulary |
| `TaskActivitySection` (drawer) | **ISS-061** — 11 of 13 real action codes render as raw snake_case, 7 of its 9 cases are dead mock codes, and the only context it reads (`taskName`) is never sent, so "task updated" never says what changed |

## 7. Coverage vs the plan

All 6 checklist lines executed. Four probes in the first pass were malformed and were re-run rather
than reported: the bulk body used `task_ids` (the real key is `ids`), the multi-field bulk used
`is_milestone` (not an accepted bulk key), the deactivation used a `PATCH /users/:id/status` route
that does not exist (it is `POST /users/:id/deactivate`), and the checklist item used `name` (the
field is `text`). Each was corrected against the validator source and re-measured; the evidence
directory keeps all four passes.

The activity **engine** is solid — correct cursor pagination with no overlap, exact ordering, sane
filters, sensible clamps, and actor hydration that survives deactivation and even deletion of the
user. The findings are that anyone may read it (ISS-060), that part of it is never written
(ISS-062), and that the drawer renders it in the mock's language (ISS-061).

**Evidence directory:** `testing/evidence/PHASE-20/` — 4 files.
