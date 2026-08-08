# PHASE 17 — Task membership (assignees · watchers · tags)

**Status:** DONE
**Methods:** API · DB
**Issues filed:** ISS-052 (MEDIUM)
**Data left behind:** none — tasks 51, lists 14, tags 8, 0 orphans.

---

## 1. Assignees — PASS

| case | result |
|---|---|
| single / multiple | 204 |
| already assigned | 204, **idempotent** (count unchanged) |
| duplicate id in one payload | 204, deduplicated |
| unknown user | 422 `task.invalid_assignee` |
| an **invited** (not yet active) user | 422 `task.invalid_assignee` |
| empty array / no `user_ids` | 422 |
| 300 ids | 422 — the array is capped |
| remove an assigned user | 204 |
| remove them again | 204, idempotent |
| remove a user who was never assigned | 204 — a deliberate no-op, never a membership oracle |

**Auto-watch works and persists.** Assigning a user adds a watcher row; un-assigning them leaves the
watcher in place, exactly as the service documents.

## 2. Watchers — PASS

`POST` and `DELETE /tasks/:id/watchers/self` are both fully idempotent (204 either way, count
correct). The `watchers` array is on the wire.

## 3. Tags — PASS

Single and multiple adds work, re-adding is idempotent, an unknown tag → 422 `task.invalid_tag`, an
empty array → 422. Removing a tag → 204, removing it again → 204, removing an unknown tag → 204.

> A raw `{tagIds:[…]}` body returns 422, but that is **not** a client bug — the axios request
> interceptor decamelizes `tagIds` → `tag_ids` before the request leaves the browser. Only a
> hand-rolled caller bypassing the interceptor would hit it.

## 4. Notifications — PASS, and confirms SCAN-M2

Assigning two people, one of whom is the actor:

```
notifications for the assignee (arif)  : 1   type "assigned"
notifications for the ACTOR (owner)    : 0   never self-notified
email_sent_at                          : null
```

The self-exclusion rule works. `email_sent_at` stays null — an independent confirmation of
`SCAN-M2` (no notification email is ever sent).

## 5. Concurrency — PASS

Two simultaneous `POST /assignees` for the same user: `204 / 204`, and exactly **one**
`task_assignees` row. The row-lock the repository takes does its job.

## 6. Activity — PASS

Membership changes are audited with dedicated actions: `assignee_added`, `assignee_removed`,
`tag_added`, `tag_removed` — better granularity than the generic `task_updated` used for field
edits (ISS-049).

## 7. `updated_at` freshness — the finding

Adding an assignee and adding a tag both bump `updated_at`, which is correct in intent. But they
bump it **backwards by six hours**, because those paths write the column through Drizzle while
`POST`/`PATCH` let MySQL set it. Full write-up in **ISS-052**.

Adding a watcher does **not** bump `updated_at`. That is arguably right — watching is personal state
and does not change the task for anyone else — and is recorded rather than filed.

## 8. Coverage vs the plan

All 9 checklist lines executed. Membership is one of the better-behaved surfaces: correct
idempotency in both directions, real reference validation including the invited-user case, a
row-lock that survives a concurrent write, correct notification targeting, and per-action audit
rows. The only defect is the clock the timestamp lands on.

**Evidence directory:** `testing/evidence/PHASE-17/` — 2 files.
