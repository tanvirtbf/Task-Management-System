# §6 — Lists

> Source: [API_DESIGN.md §6](../API_DESIGN.md#6-lists)

**8 endpoints.** Lists live inside spaces and hold tasks. They define the default task type and their own status workflow.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/spaces/:spaceId/lists` | Lists in one space | 🔐 | S | ✅ |
| 2 | GET | `/api/v1/lists` | Lists across the whole workspace | 🔐 | S | ✅ |
| 3 | GET | `/api/v1/lists/:id` | Read a single list | 🔐 | S | ✅ |
| 4 | POST | `/api/v1/lists` | Create a new list in a space | 👑 | M | ✅ |
| 5 | PATCH | `/api/v1/lists/:id` | Update name / description / icon / color / default task type | 👑 | S | ✅ |
| 6 | POST | `/api/v1/lists/:id/archive` | Soft-delete | 👑 | S | ✅ |
| 7 | POST | `/api/v1/lists/:id/unarchive` | Reverse #6 | 👑 | S | ✅ |
| 8 | DELETE | `/api/v1/lists/:id` | Hard-delete (must be archived + empty) | 🛡️ | M | ✅ |

## Dependencies

- §5 Spaces — `space_id` FK must already exist.
- §8 Task types — `default_task_type_id` FK (optional but commonly set).
- DB tables: `lists`, plus `tasks` (for emptiness check).

## Notes

- Hard delete refuses with `409 list.not_empty` if non-archived tasks reference it.
- Updating `default_task_type_id` doesn't change existing tasks — only the default for the next quick-create.
- Each mutation → `workspace_activity` row.
