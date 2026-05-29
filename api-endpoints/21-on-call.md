# §21 — On-call

> Source: [API_DESIGN.md §21](../API_DESIGN.md#21-on-call)

**4 endpoints.** Weekly on-call rotation for the engineering team. Each row in `on_call_shifts` is a week (Monday-start) with an assigned engineer.

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/on-call/current` | Who's on call right now | 🔐 | S | ☐ |
| 2 | GET | `/api/v1/on-call/schedule` | Range of upcoming shifts | 🔐 | S | ☐ |
| 3 | PUT | `/api/v1/on-call/:weekStart` | Assign an engineer to a week (upsert) | 👑 | S | ☐ |
| 4 | DELETE | `/api/v1/on-call/:weekStart` | Remove a shift | 👑 | S | ☐ |

## Dependencies

- DB table: `on_call_shifts`. View `v_current_on_call` filters on `CURDATE() BETWEEN week_start AND week_end`.
- §22 Engineering specials uses #1 to auto-assign the `report-bug` intake task.

## Notes

- `weekStart` must be a Monday (ISO date `YYYY-MM-DD`). Validate this in the URL param.
- **#3 PUT** is an upsert — easy with MySQL's `INSERT ... ON DUPLICATE KEY UPDATE` if the unique key is `(workspace_id, week_start)`.
- The view returns multiple rows if multiple shifts straddle today (e.g., a transition week) — pick the one whose `week_start` is most recent.
