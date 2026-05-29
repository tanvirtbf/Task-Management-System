# §26 — Workspace activity

> Source: [API_DESIGN.md §26](../API_DESIGN.md#27-workspace-activity)

**2 endpoints.** Read-only feed of workspace-level events (user invited, role changed, space/list created/archived, etc.) — distinct from per-task activity (§13).

## Endpoints

| # | Method | Path | Purpose | Auth | Size | Status |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/activity/recent` | Last N events for the home activity card | 🔐 | S | ☐ |
| 2 | GET | `/api/v1/activity` | Paginated full feed with filters | 🔐 | M | ☐ |

## Dependencies

- DB table: `workspace_activity`. Rows are inserted by every mutating endpoint that touches a workspace-level entity (§3, §4, §5, §6, §7, §8, §9, §17, §20, §22, §23).
- Tier 5 — recommended late since it depends on the writes from earlier categories.

## Notes

- Pagination by `internal_id DESC`.
- Filters: `?entity_type=` (one of `workspace|space|list|task_type|tag|custom_field|user|role|sprint`), `?actor_id=`, `?from=`, `?to=`.
- Hydrate `actor` user object in the response so the UI doesn't have to look it up.
- Must scope strictly by `workspace_id` from JWT — no cross-tenant leak.
