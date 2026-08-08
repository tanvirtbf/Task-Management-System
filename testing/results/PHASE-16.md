# PHASE 16 — Task lifecycle & deletion

**Status:** DONE
**Methods:** API · DB · CODE
**Issues filed:** ISS-050 (MEDIUM) · ISS-051 (LOW)
**Deferred item resolved:** `include_archived` on `/lists/:id/tasks` with real archived tasks
(from P9)
**Data left behind:** none — tasks 51, lists 14, statuses 70, 0 orphans.

---

## 1. Archive / unarchive — PASS

| step | result |
|---|---|
| archive | 204, **idempotent** |
| hidden from `GET /lists/:id/tasks` by default | ✓ |
| **`?include_archived=true` includes it** | ✓ — resolves the P9 deferral |
| direct `GET /tasks/:id` while archived | 200 |
| `PATCH` while archived | 409 `task.archived` |
| add an assignee while archived | 409 `task.archived` |
| **post a comment while archived** | **201 → ISS-051** |
| unarchive | 204, idempotent |
| `PATCH` after unarchive | 200 |

## 2. Soft vs hard delete — PASS on the server

```
DELETE /tasks/:id              -> 204   row remains, archived_at set, GET still 200
DELETE /tasks/:id  (again)     -> 204   idempotent
DELETE ?hard=true  as member   -> 403 auth.forbidden
DELETE ?hard=true  as owner    -> 204   row GONE
DELETE ?hard=true on a task that was never archived -> 204
```

The owner/admin gate on hard delete works (already seen in P4; re-confirmed).

The **client-side** picture is the problem — ISS-050.

## 3. Cascades on hard delete — PASS, complete

A task carrying an assignee, two watchers, a tag, a comment, a checklist, four activity rows and one
dependency:

```
before: {assignees:1, watchers:2, tags:1, comments:1, checklists:1, activity:4, deps:1, cfvalues:0, reviews:0}
after : {assignees:0, watchers:0, tags:0, comments:0, checklists:0, activity:0, deps:0, cfvalues:0, reviews:0}
```

Every child row is removed, and **the task on the other side of the dependency survives** — the
cascade does not over-reach.

## 4. Parent / child — PASS

| action | effect on the child |
|---|---|
| soft-delete the parent | child is **archived too** (cascade), and still points at the parent |
| hard-delete the parent | child is **deleted** (FK cascade) |

Note the second one is worth knowing operationally: hard-deleting a parent silently removes its
subtasks. That is consistent with the FK, but it means a single `?hard=true` can remove a subtree.

## 5. Dependencies — PASS

Hard-deleting a task that another task depended on removes the dependency row and leaves the
dependent task intact.

## 6. `SCAN-L5` — confirmed and sharpened

`tasksApi` exposes `archive` and `delete`; there is **no `unarchive`**, and **0 callers** anywhere in
the client. Since `DELETE /tasks/:id` is itself a soft delete, both UI actions are the same one-way
operation → **ISS-050**.

## 7. Environment note — subtask operations still 500 locally

Hard-deleting a **subtask** returns 500 on this database (the stale `trg_subtasks_after_delete`
trigger — `SCAN-H4`), as does moving one across statuses. Every cascade test in §3 therefore used
non-subtask fixtures. Production, provisioned from `schema.sql` with 7 triggers, is unaffected.

**P18 cannot be run properly until those three triggers are dropped from the dev database.**

## 8. Coverage vs the plan

All 7 checklist lines executed plus the P9 deferral. Server-side lifecycle behaviour is correct
throughout — idempotent transitions, a real archived-state guard on edits, complete and
well-bounded cascades, and a working hard-delete gate. Both findings are about the seam between that
correct server behaviour and what the client actually offers.

**Evidence directory:** `testing/evidence/PHASE-16/` — 1 file.
