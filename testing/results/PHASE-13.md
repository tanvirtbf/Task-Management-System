# PHASE 13 — Task creation

**Status:** PARTIAL (UI deferred — §10)
**Methods:** API · DB
**Issues filed:** ISS-044 (MEDIUM) · ISS-045 (LOW)
**Data left behind:** none — tasks 51, lists 14, statuses 70, 0 orphans.

---

## 1. Required fields — PASS

| case | result |
|---|---|
| minimum (`primary_list_id` + `name`) | 201 |
| no `primary_list_id` / no `name` / empty body | 422 with per-field detail |
| empty name, whitespace-only name | 422 `name is required` (trimmed before checking) |
| 600-char name | 422 `name must be at most 500 characters` |
| unknown list | 404 `list.not_found` |

## 2. Reference validation — four of five correct, one returns 500

| field | unknown value | verdict |
|---|---|---|
| `status_id` | 422 `task.invalid_status` | ✓ |
| a status belonging to **another list** | 422 `task.invalid_status` — *"is not a status of this list"* | ✓ scoped correctly |
| `task_type_id` | 422 `task.invalid_task_type` | ✓ |
| `assignees` | 422 `task.invalid_assignee` | ✓ |
| `tags` | 422 `task.invalid_tag` | ✓ |
| **`reviewer_id`** | **500 `internal`** | ✗ **ISS-044** |

A duplicate assignee (`[me, me]`) is accepted (201). A **guest as reviewer** is accepted — noted
inside ISS-044.

## 3. Dates — PASS

`start > due` → 422 `task.invalid_date_range`. Same-day start/due → 201. A due date in the past →
201 (backdating is legitimate). Malformed dates and `2027-02-30` → 422 with a clear message, so the
date parser is real rather than a regex.

## 4. `custom_id`

Explicit ids work; a duplicate → 409 `task.duplicate_custom_id`, **case-insensitively**
(`P13-001` vs `p13-001` both collide). Nothing is auto-generated — a task created without one gets
`custom_id: null` and only an internal `task_number`.

In the live database **3 of 51 tasks have a `custom_id`**. So the human-readable key that
`GET /tasks/:idOrKey` supports exists for almost nothing. Not filed as a bug — the field is
optional by design — but worth knowing before relying on `ORD-1024`-style references.

## 5. Scalars — PASS

`priority` accepts 0–4 and rejects 5 and `"high"` with an exact message. `is_milestone` and
`time_estimate_seconds` work; a negative estimate → 422. `story_points` is capped at 0–255 (999 →
422).

## 6. Recurrence — stored, validated, never acted on

`recurrence_pattern: "weekly"` with `recurrence_days: ["sun","tue"]` and an end date → 201 and
stored. `"monthly"` → 422 (only `none`/`daily`/`weekly` exist). A bad day name → 422 with the exact
allowed set.

The validation is careful; there is still **no generator job**, so a recurring task never repeats.
That is `SCAN-M3`'s neighbour and is already recorded — not re-filed.

## 7. Engineering fields

A full engineering payload on a Bug stores correctly, including a computed `sla_due_at`:
```
{"story_points":8,"branch_name":"feat/p13","pr_status":"open","bug_severity":"S1",
 "reporter_team":"cs","sla":"2026-07-31 07:49:43"}
```
Enum fields are properly constrained — `bug_severity:"S9"` → 422 listing S0–S3, `reporter_team`
→ 422 listing the allowed teams. The gap is `pr_url`, which is not URL-validated (**ISS-045**), and
the fact that none of these are gated by `is_dev_type` (ISS-039, filed in P11).

## 8. Hostile input — accepted and stored (rendering is P38's question)

`<script>alert(1)</script>`, `'; DROP TABLE tasks; --`, `../../etc/passwd` and an embedded null byte
all return 201 and are stored verbatim in `name`. No injection occurred — parameterised queries hold
— so the open question is purely whether any of them execute when rendered. Handed to **P38**.

## 9. Side effects of one create — PASS

Creating a task with an assignee produced exactly:

```
task_activity      +2   (task_created, assignee_added)
notifications      +1   (type "assigned", to the assignee)
task_watchers      +1   (the assignee is auto-watched)
workspace_activity +0   (task events live in task_activity, by design)
```

## 10. `POST /tasks/bulk` — a bulk **update**, not a bulk create

The endpoint takes `{ids, patch}`:

| case | result |
|---|---|
| valid ids + patch | 200 |
| empty `ids` | 422 |
| unknown id | 404 `task.not_found` |
| 1000 ids | 422 — the validator caps the array at **200** |
| no `patch` | 422 |

There is **no bulk create** endpoint; the plan's "bulk" line is satisfied by this bulk-patch.

## 11. Deferred (rule R10)

| item | why | moved to |
|---|---|---|
| quick-create input, create-task modal, create from a board column | API-only phase | **P35** |
| does a stored `<script>` name render? | dedicated pass | **P38** |

## 12. Coverage vs the plan

All 8 checklist lines executed except the UI line. Creation validation is, on the whole, the
strongest surface tested so far — precise per-field messages, correct scoping of status ids to their
list, case-insensitive `custom_id` uniqueness, and exact enum errors. The single 500 stands out
against that.

**Evidence directory:** `testing/evidence/PHASE-13/` — 1 file.
