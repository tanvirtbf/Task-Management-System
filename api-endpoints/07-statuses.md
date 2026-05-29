# §7 — Statuses

> Source: [API_DESIGN.md §7](../API_DESIGN.md#7-statuses)

**5 endpoints.** Per-list status workflows. Each status belongs to one of four groups (`not_started | active | done | closed`) and has a position for ordering.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/lists/:listId/statuses` | All statuses for a list, ordered by position | 🔐 | S | ☐ |
| 2 | POST | `/api/v1/lists/:listId/statuses` | Add a status to a list | 👑 | M | ☐ |
| 3 | PATCH | `/api/v1/statuses/:id` | Update name / color / group | 👑 | S | ☐ |
| 4 | DELETE | `/api/v1/statuses/:id` | Delete a status (must have no tasks referencing it) | 👑 | M | ☐ |
| 5 | PATCH | `/api/v1/lists/:listId/statuses/reorder` | Reorder statuses in bulk | 👑 | M | ☐ |

## Dependencies

- §6 Lists — `list_id` FK.
- DB table: `statuses`, plus `tasks` (FK check on delete).

## Notes

- Delete (#4) refuses with `409 status.in_use` if any task points at it.
- Reorder (#5) takes `[{id, position}]` and writes them all in one transaction.
- Every list must have at least one status in each of the 4 groups for the Board view to render — enforce in #4: deleting the last status of a group → `422 status.last_in_group`.
