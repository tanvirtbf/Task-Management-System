# §12 — Subtasks and dependencies

> Source: [API_DESIGN.md §12](../API_DESIGN.md#12-subtasks-and-dependencies)

**3 endpoints.** Engineering-flavoured task graph: parent-child (subtasks) is on the task itself; cross-task blocks/blocked-by uses a separate join table.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/tasks/:id/dependencies` | Both incoming (blocked-by) and outgoing (blocks) | 🔐 | S | ☐ |
| 2 | POST | `/api/v1/task-dependencies` | Add a blocks-relationship | 🔐 | M | ☐ |
| 3 | DELETE | `/api/v1/task-dependencies/:id` | Remove one | 🔐 | S | ☐ |

## Dependencies

- §10 Tasks.
- DB table: `task_dependencies`. Trigger `trg_task_dependencies_no_self_*` already prevents self-loops at the DB layer.

## Notes

- **#2 create** must additionally check for cycles in the application layer — DB trigger only blocks self-loops, not multi-hop cycles. Return `422 dep.cycle` on detection.
- A blocked task should surface in the UI with a warning chip; the API just returns the data, the UI does the rendering.
- Subtasks (parent-child) are managed via `tasks.parent_task_id` — handled by the standard task create/update endpoints, no separate subtask endpoints needed.
- Each add/remove → `task_activity` row.
