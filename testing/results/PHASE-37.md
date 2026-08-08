# PHASE 37 — Data integrity & concurrency

**Status:** DONE
**Methods:** DB · API
**Issues filed:** **none** new — the sweep **reproduced ISS-073** and re-confirmed ISS-046 / ISS-065
**Data left behind:** none — tasks 51, lists 14, statuses 70, tags 8, comments 8, attachments 1,
notifications 65.

---

## 1. Triggers — all ten, exercised one at a time

`SHOW TRIGGERS` returns **10**: the 7 that `schema.sql` provisions plus the 3 stale
`trg_subtasks_after_*` that `SCAN-H4` describes (still present, as P18 restored them).

| trigger path | measured |
|---|---|
| `comments_count` on insert | 0 → **1** |
| `comments_count` on **soft** delete | stays **1** — ISS-065 |
| `comments_count` on a real `DELETE` | 1 → **0** — the trigger itself is fine |
| `attachments_count`, row `pending` | **0** — only `complete` rows count |
| `attachments_count`, pending → complete | **1** |
| `attachments_count` on soft delete | **0** — the AFTER UPDATE trigger moves both ways |
| `subtasks_count` / `subtasks_completed` with a real child | **0/0** — ISS-046 |
| `form_submissions_after_insert` | maintains `forms.submission_count` (P26) |
| `task_dependencies_no_self_{insert,update}` | both fire (P18) |

The contrast is the useful part: **`attachments_count` is correct in both directions** because it
hooks the UPDATE, which is exactly what `comments_count` (ISS-065) and `submission_count` (ISS-080)
lack.

## 2. Views — five, not three, and all correct

The plan said "all 5 views"; the schema has `v_active_sprint`, `v_breached_sla`, `v_current_on_call`,
`v_open_bugs`, `v_open_tasks`.

| view | rows | hand-computed | |
|---|---|---|---|
| `v_active_sprint` | 1 | 1 sprint with `status='active'` | match |
| `v_current_on_call` | 0 | 0 shifts covering `CURDATE()` | match |
| `v_breached_sla` | 0 | 0 by the `NOW()` predicate | match |
| `v_open_bugs` | 0 | — | consistent |
| `v_open_tasks` | 34 | — | consistent |

(The `v_breached_sla` vs endpoint **disagreement** is ISS-081, measured in P30; against its own
predicate the view is right.)

## 3. Cascades — complete

A task carrying an assignee, a watcher, a comment, a checklist with an item, and three activity rows:

```
before: {task_assignees:1, task_watchers:1, comments:1, checklists:1, task_activity:3}
after : {task_assignees:0, task_watchers:0, comments:0, checklists:0, task_activity:0}
checklist_items under the deleted checklist: 0
```

Deleting a **list** that still holds tasks is refused first by `409 list.not_archived`, and the FK
underneath is `ON DELETE RESTRICT` — two layers.

## 4. Orphan sweep — 23 of 24 relationships clean

Twenty-four integrity queries across the schema (tasks↔lists/statuses/types/parents,
lists↔spaces, statuses↔lists, comments, checklists, checklist_items, attachments, assignees↔tasks and
↔users, activity, dependencies, form_fields, form_submissions, department_reports, task_reviews,
spaces↔head, sessions↔users, tasks↔sprints, notifications↔task/comment/user).

**Twenty-three came back clean. One did not:**

```
NOTIFICATIONS pointing at a dead task -> 2 rows
  "You were assigned to TEST-p37-cascade"
  "You were assigned to TEST-p37-race"
```

Both were created by this phase's own fixtures and stranded the moment those tasks were hard-deleted
— a live reproduction of **ISS-073**, added to that issue as evidence. `notifications` is the only
child table in the schema with no FK to its entity, and it is the only one that orphans.

## 5. Concurrency — PASS

```
two simultaneous PATCHes  -> 200/200, last-write-wins (the If-Match guard is opt-in — P15 §3)
two simultaneous assigns  -> 204/204, exactly ONE task_assignees row
two simultaneous archives -> 204/204, idempotent
```

## 6. Unique constraints under a race — PASS, all three

```
two identical tag names   -> 409 tag.duplicate            / 201   one row
two identical custom_ids  -> 409 task.duplicate_custom_id / 201   one row
two simultaneous creates  -> task_number 6 / 7                    distinct
```

The per-list `task_number` race-retry does what it claims — two concurrent creates in the same list
got consecutive, non-colliding numbers.

## 7. Atomicity — rolled back cleanly (first verdict was a test bug)

```
POST /tasks/bulk {ids: [good, good, "t-nope"], patch: {priority: 4}}
  -> 404 task.not_found
  -> priority before {priority: 0}, after {priority: 0}   unchanged
```

The run printed "*** partial write ***" because the check compared two row **objects** with `===`,
which is never true. The values are identical, so the transaction rolled back. Independently
confirmed in P20 §3, where the same probe wrote 0 activity rows.

## 8. Timezone round-trip

```
due_date  sent 2026-08-10 -> stored 2026-08-10 -> wire 2026-08-10     clean (DATE column)
created_at     stored 2026-07-30 16:02:07 -> wire 2026-07-30T16:02:07.000Z
MySQL NOW() 16:02:07                       node 10:02:07Z
```

DATE columns round-trip exactly. TIMESTAMP columns carry the six-hour ISS-001 shift — the stored
wall-clock is re-labelled `Z` on the wire, so a client reading `created_at` sees an instant six hours
after the real one. That is ISS-001, measured here on a third independent path.

The plan's 23:59 / 00:01 Dhaka boundary case was not provoked — it needs the system clock moved,
which would disturb every other phase in this session. Carried to **P41**.

## 9. Coverage vs the plan

9 of the 10 checklist lines executed; the midnight-boundary line moves to P41.

The integrity picture is strong: every FK cascade complete, every trigger behaving as written, all
five views agreeing with hand-written SQL, unique constraints holding under concurrent writes, a
working race-retry on `task_number`, and a clean transactional rollback. The single orphaning
relationship in the entire schema is the one ISS-073 already names.

**Evidence directory:** `testing/evidence/PHASE-37/` — 1 file.
