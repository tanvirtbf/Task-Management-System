# §11 — Task membership (assignees · watchers · tags)

> Source: [API_DESIGN.md §11](../API_DESIGN.md#11-task-membership)

**6 endpoints.** Manage who's assigned to a task, who's watching it, and which tags are applied. All split out from the task PATCH because they're high-traffic on their own.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/v1/tasks/:id/assignees` | Add one or more assignees | 🔐 | S | ☐ |
| 2 | DELETE | `/api/v1/tasks/:id/assignees/:userId` | Remove one assignee | 🔐 | S | ☐ |
| 3 | POST | `/api/v1/tasks/:id/watchers/self` | Watch the task (current user) | 🔐 | S | ☐ |
| 4 | DELETE | `/api/v1/tasks/:id/watchers/self` | Stop watching | 🔐 | S | ☐ |
| 5 | POST | `/api/v1/tasks/:id/tags` | Apply one or more tags | 🔐 | S | ☐ |
| 6 | DELETE | `/api/v1/tasks/:id/tags/:tagId` | Remove one tag | 🔐 | S | ☐ |

## Dependencies

- §10 Tasks — the target task must exist.
- §9 Tags — the tags must exist.
- DB tables: `task_assignees`, `task_watchers`, `task_tags`.

## Notes

- All add/remove operations are idempotent — re-adding an existing membership returns 200 with the current state, doesn't error.
- Adding an assignee fires an `assigned` notification.
- Adding/removing should write a `task_activity` row.
- Watchers/self endpoints use `req.auth.sub` so callers don't pass their own id.
