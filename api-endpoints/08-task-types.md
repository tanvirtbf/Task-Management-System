# §8 — Task types

> Source: [API_DESIGN.md §8](../API_DESIGN.md#8-task-types)

**4 endpoints.** Workspace-wide task types (Task / Order / Complaint / Bug / Feature / Incident / Release / etc.). `is_dev_type` flag drives whether engineering-specific UI panels render.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/task-types` | List all task types in the workspace | 🔐 | S | ☐ |
| 2 | POST | `/api/v1/task-types` | Create a new task type | 👑 | M | ☐ |
| 3 | PATCH | `/api/v1/task-types/:id` | Update name / icon / color / `is_dev_type` | 👑 | S | ☐ |
| 4 | DELETE | `/api/v1/task-types/:id` | Delete a task type (must have no tasks referencing it) | 👑 | M | ☐ |

## Dependencies

- DB table: `task_types`, plus `tasks` (FK check on delete) and `lists` (default_task_type_id).

## Notes

- Delete refuses with `409 task_type.in_use` if any task or list still references it.
- `is_system` task types (the seeded ones) cannot be edited or deleted — return `403 task_type.system`.
- Each mutation → `workspace_activity` row.
