# §13 — Task activity

> Source: [API_DESIGN.md §13](../API_DESIGN.md#13-task-activity)

**1 endpoint.** Read-only feed of every status change, comment, attachment, assignment, etc. per task. Writes happen as side effects of other endpoints — there is no explicit "create activity" API.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/tasks/:id/activity` | Reverse-chronological activity feed for a task | 🔐 | M | ☐ |

## Dependencies

- §10 Tasks.
- DB table: `task_activity`. Rows are inserted by every mutating endpoint that touches a task (created in §10, §11, §14, §15, §16, §17, etc.).

## Notes

- Pagination by `internal_id` cursor — newest first.
- Support `?action=` filter (e.g., `?action=status_change`).
- Response should hydrate the `actor` user object (not just the id) so the UI doesn't have to make extra calls.
- This endpoint enforces the convention: every other endpoint that mutates a task is expected to write an activity row. Failing to do so will make the feed lossy — call this out in the implementation plan when you build §10 and friends.
