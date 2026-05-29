# §20 — Sprints

> Source: [API_DESIGN.md §20](../API_DESIGN.md#20-sprints)

**9 endpoints.** Engineering-only. Sprint = a time-boxed window with committed story points. Tasks are added/removed from sprints, and Sprint Board UI groups by status.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/sprints` | All sprints, filterable by status | 🔐 | S | ☐ |
| 2 | GET | `/api/v1/sprints/active` | The single active sprint (or 404 if none) | 🔐 | S | ☐ |
| 3 | GET | `/api/v1/sprints/:id` | Read one sprint | 🔐 | S | ☐ |
| 4 | POST | `/api/v1/sprints` | Create a sprint (status = planned) | 👑 | M | ☐ |
| 5 | PATCH | `/api/v1/sprints/:id` | Update name / goal / dates / committed points | 👑 | S | ☐ |
| 6 | POST | `/api/v1/sprints/:id/start` | Transition planned → active (only one allowed) | 👑 | M | ☐ |
| 7 | POST | `/api/v1/sprints/:id/close` | Transition active → closed | 👑 | M | ☐ |
| 8 | POST | `/api/v1/sprints/:id/tasks` | Add tasks to the sprint | 🔐 | M | ☐ |
| 9 | DELETE | `/api/v1/sprints/:id/tasks/:taskId` | Remove a task from the sprint | 🔐 | S | ☐ |

## Dependencies

- §10 Tasks — `tasks.sprint_id` is the link.
- DB table: `sprints`. View `v_active_sprint` enforces the single-active invariant via `WHERE status = 'active'` (one row per workspace).

## Notes

- **#6 start**: must `422 sprint.another_active` if another sprint is already active. The view is a read helper, not an enforcement — do the check in code with a transaction.
- **#7 close**: snapshot the completed-points figure (sum of story points of tasks in done/closed status). Store on the sprint row for retrospective reporting.
- **#8 add tasks**: just sets `tasks.sprint_id`. Bulk-friendly — accept `{taskIds: string[]}`.
- All sprint mutations → `task_activity` for each affected task + a `workspace_activity` row for the sprint itself.
